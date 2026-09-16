// Local-only acceptance check. No remote Cloudflare resources are read or written.
import { getPlatformProxy } from "wrangler";
import { loadEnv } from "vite";
import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import type { Env } from "../src/api/env";
import { exportArchive, restoreArchive } from "../src/api/exporters/archive";
import { listRecords, saveRecord } from "../src/api/services/records";
const local = loadEnv("development", process.cwd(), "SELLER_");
const sourcePath = resolve(
  local.SELLER_LOCAL_STATE_DIR ?? ".wrangler/state",
  "v3",
);
const destinationPath = await mkdtemp(
  join(tmpdir(), "seller-restore-verification-"),
);
const source = await getPlatformProxy<Env>({
  configPath: "wrangler.jsonc",
  persist: { path: sourcePath },
});
const dest = await getPlatformProxy<Env>({
  configPath: "wrangler.jsonc",
  persist: { path: destinationPath },
});
try {
  console.log("검증용 빈 DB 마이그레이션");
  const migrations = (await readdir("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of migrations) {
    const sql = await readFile(join("migrations", f), "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    await dest.env.DB.batch(statements.map((s) => dest.env.DB.prepare(s)));
  }
  const empty = await dest.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM products",
  ).first<{ n: number }>();
  if (empty?.n !== 0) throw new Error("Verification target is not empty");
  console.log("현재 로컬 기록 내보내기");
  const bytes = await exportArchive(source.env);
  console.log("복원 미리보기");
  const preview = await restoreArchive(dest.env, bytes, false);
  console.log("독립 DB 복원 적용");
  await restoreArchive(dest.env, bytes, true, preview.archive_hash);
  console.log("복원 결과 비교");
  const restored = unzipSync(await exportArchive(dest.env)),
    original = unzipSync(bytes);
  const manifest = JSON.parse(strFromU8(original["manifest.json"]));
  let verifiedRecords = 0;
  for (const table of Object.keys(manifest.counts)) {
    if (table === "activity_log") continue; // Restore adds its own before/after audit, while original logs remain.
    const expected = JSON.parse(strFromU8(original[`entities/${table}.json`])),
      actual = JSON.parse(strFromU8(restored[`entities/${table}.json`]));
    const sorted = (rows: any[]) =>
      rows
        .map((r) =>
          JSON.stringify(
            Object.fromEntries(
              Object.entries(r).sort(([a], [b]) => a.localeCompare(b)),
            ),
          ),
        )
        .sort();
    if (JSON.stringify(sorted(expected)) !== JSON.stringify(sorted(actual)))
      throw new Error(`Roundtrip mismatch: ${table}`);
    verifiedRecords += expected.length;
  }
  const attachmentRows = JSON.parse(
    strFromU8(original["attachments/manifest.json"]),
  );
  for (const a of attachmentRows) {
    if (
      Buffer.compare(
        Buffer.from(original[a.path]),
        Buffer.from(restored[a.path]),
      ) !== 0
    )
      throw new Error("Attachment byte mismatch");
  }
  const originalLogs = JSON.parse(
    strFromU8(original["entities/activity_log.json"]),
  );
  const restoredLogs = JSON.parse(
    strFromU8(restored["entities/activity_log.json"]),
  );
  if (
    originalLogs.some(
      (r: any) =>
        !restoredLogs.some(
          (a: any) => a.id === r.id && JSON.stringify(a) === JSON.stringify(r),
        ),
    )
  )
    throw new Error("Original audit history mismatch");
  const report = {
    verified_at: new Date().toISOString(),
    archive_hash: preview.archive_hash,
    verified_records: verifiedRecords,
    attachments: attachmentRows.length,
    original_activity_logs: originalLogs.length,
    result: "passed",
    method:
      "ZIP export → independent empty local D1/R2 → export → exact rows and attachment bytes comparison",
  };
  await mkdir("work", { recursive: true });
  await writeFile(
    "work/backup-verification.json",
    JSON.stringify(report, null, 2),
  );
  const item = (await listRecords(source.env.DB, "readiness_items")).find(
    (r) => r.key === "backup_verified",
  );
  if (item)
    await saveRecord(
      source.env.DB,
      "readiness_items",
      { id: item.id, status: "done", notes: JSON.stringify(report) },
      "독립된 빈 로컬 D1/R2의 실제 복원·행별·첨부 바이트 비교 통과",
      "user",
      true,
    );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await source.dispose();
  await dest.dispose();
}
