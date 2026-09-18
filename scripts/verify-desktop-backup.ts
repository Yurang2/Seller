import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDesktopEnv } from "../src/platform/desktop-env";
import { exportArchive, restoreArchive } from "../src/api/exporters/archive";
import { compareArchives } from "../src/platform/verify-archive";

const file = process.argv[2];
if (!file) throw new Error("사용법: pnpm desktop:backup:verify <백업 ZIP 경로>");
const bytes = new Uint8Array(await readFile(resolve(file)));
const root = await mkdtemp(join(tmpdir(), "seller-desktop-verify-"));
const target = createDesktopEnv(root, resolve("migrations"));
try {
  const preview = await restoreArchive(target.env, bytes, false);
  await restoreArchive(target.env, bytes, true, preview.archive_hash);
  const report = {
    verified_at: new Date().toISOString(), archive_hash: preview.archive_hash,
    ...compareArchives(bytes, await exportArchive(target.env)),
    method: "ZIP → independent empty SQLite/files → export → exact records, original audit history and attachment bytes comparison",
  };
  await mkdir("work", { recursive: true });
  await writeFile("work/desktop-backup-verification.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { target.close(); await rm(root, { recursive: true, force: true }); }
