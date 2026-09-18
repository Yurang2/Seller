import { mkdir, readFile, writeFile, rename, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import { exportArchive } from "../api/exporters/archive";
import type { Env } from "../api/env";

type BackupState = { fingerprint?: string; lastFile?: string; failedAt?: string; error?: string };
export async function readBackupState(dataDirectory: string): Promise<BackupState> {
  try { return JSON.parse(await readFile(join(dataDirectory, "backup-state.json"), "utf8")); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    return { error: "지난 백업 상태를 읽지 못했습니다. 백업 폴더를 확인해주세요." };
  }
}
async function atomicWrite(file: string, bytes: string | Uint8Array) {
  const temp = file + "." + randomUUID() + ".tmp";
  try { await writeFile(temp, bytes, { flag: "wx" }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}
export async function backupOnClose(env: Env, dataDirectory: string, backupDirectory: string, now = new Date()) {
  const state = await readBackupState(dataDirectory);
  try {
    const bytes = await exportArchive(env);
    const contents = unzipSync(bytes);
    const hash = createHash("sha256");
    // ZIP/manifest timestamps do not represent data changes.
    for (const key of Object.keys(contents).filter(k => k !== "manifest.json").sort())
      hash.update(key).update(contents[key]);
    const fingerprint = hash.digest("hex");
    if (state.fingerprint === fingerprint && state.lastFile && !state.error) {
      try { await stat(join(backupDirectory, state.lastFile)); return { status: "unchanged" as const, file: state.lastFile }; }
      catch { /* Missing backup is recreated. */ }
    }
    await mkdir(backupDirectory, { recursive: true });
    // Repeated closes within a minute atomically refresh that minute's snapshot.
    const p = (v: number) => String(v).padStart(2, "0");
    const name = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}.zip`;
    await atomicWrite(join(backupDirectory, name), bytes);
    const files = (await readdir(backupDirectory)).filter(n => /^\d{4}-\d{2}-\d{2}_\d{4}\.zip$/.test(n));
    const dated = await Promise.all(files.map(async name => ({ name, time: (await stat(join(backupDirectory, name))).mtimeMs })));
    dated.sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
    for (const old of dated.slice(30)) await rm(join(backupDirectory, old.name));
    await atomicWrite(join(dataDirectory, "backup-state.json"), JSON.stringify({ fingerprint, lastFile: name }));
    return { status: "saved" as const, file: name };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    try { await atomicWrite(join(dataDirectory, "backup-state.json"), JSON.stringify({ ...state, failedAt: now.toISOString(), error })); }
    catch (stateError) { console.error("Could not persist backup failure", stateError); }
    return { status: "failed" as const, error };
  }
}
