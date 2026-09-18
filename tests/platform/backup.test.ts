import { it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createDesktopEnv } from "../../src/platform/desktop-env";
import { backupOnClose, readBackupState } from "../../src/platform/backup";
import { seedResearch } from "../../src/api/importers/research";
import { saveAttachment } from "../../src/api/services/attachments";
import { exportArchive, restoreArchive } from "../../src/api/exporters/archive";
import { compareArchives } from "../../src/platform/verify-archive";

it("persists seed across restart and restores shutdown ZIP with evidence into a fresh installation", async () => {
  const root = mkdtempSync(join(tmpdir(), "seller-backup-"));
  const data = join(root, "data"), backups = join(root, "backups");
  let source = createDesktopEnv(data, resolve("migrations"));
  const target = createDesktopEnv(join(root, "fresh"), resolve("migrations"));
  try {
    await seedResearch(source.env.DB);
    const form = new FormData();
    form.set("file", new File([new Uint8Array([0, 255, 24, 77])], "evidence.png", { type: "image/png" }));
    form.set("owner_type", "research"); form.set("owner_id", "01K56VQK6NXWSVK11FSKETC6K9");
    await saveAttachment(source.env, form, "user");
    const original = await exportArchive(source.env);
    const saved = await backupOnClose(source.env, data, backups);
    expect(saved.status).toBe("saved");
    source.close(); source = createDesktopEnv(data, resolve("migrations"));
    expect(await source.env.DB.prepare("SELECT count(*) n FROM products").first("n")).toBe(4);
    expect(compareArchives(original, await exportArchive(source.env)).result).toBe("passed");
    expect((await backupOnClose(source.env, data, backups)).status).toBe("unchanged");
    const file = readdirSync(backups).find(n => n.endsWith(".zip"))!;
    const bytes = new Uint8Array(readFileSync(join(backups, file)));
    const preview = await restoreArchive(target.env, bytes, false);
    await restoreArchive(target.env, bytes, true, preview.archive_hash);
    const report = compareArchives(bytes, await exportArchive(target.env));
    expect(report.result).toBe("passed"); expect(report.attachments).toBe(1);
    expect(report.verified_records).toBeGreaterThan(100);
  } finally { source.close(); target.close(); rmSync(root, { recursive: true, force: true }); }
});

it("remembers failures for next launch, retries unchanged data, and retains only 30 managed ZIPs", async () => {
  const root = mkdtempSync(join(tmpdir(), "seller-retention-"));
  const data = join(root, "data"), backups = join(root, "backups");
  const source = createDesktopEnv(data, resolve("migrations"));
  try {
    const blocked = join(root, "not-a-directory"); writeFileSync(blocked, "file");
    expect((await backupOnClose(source.env, data, blocked)).status).toBe("failed");
    expect((await readBackupState(data)).error).toBeTruthy();
    expect((await backupOnClose(source.env, data, backups)).status).toBe("saved");
    expect((await readBackupState(data)).error).toBeUndefined();
    writeFileSync(join(backups, "user-manual.zip"), "keep");
    for (let i = 0; i < 31; i++) {
      await source.env.DB.prepare("INSERT OR REPLACE INTO settings (key,value_json,updated_at) VALUES ('test',?,'2026-09-19T00:00:00Z')").bind(String(i)).run();
      expect((await backupOnClose(source.env, data, backups, new Date(2026, 8, 20, 1, i))).status).toBe("saved");
    }
    expect(readdirSync(backups).filter(n => /^\d{4}-/.test(n))).toHaveLength(30);
    expect(readFileSync(join(backups, "user-manual.zip"), "utf8")).toBe("keep");
  } finally { source.close(); rmSync(root, { recursive: true, force: true }); }
});
