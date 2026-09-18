import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll } from "vitest";
import { DesktopDatabase } from "../../src/platform/d1-shim";
import { FileBlobStore } from "../../src/platform/blob-store";
import { migrate } from "../../src/platform/migrate";

let root: string | undefined;
const databases: DesktopDatabase[] = [];
export const env = { APP_ENV: "desktop", ACCESS_AUD: "", ACCESS_TEAM_DOMAIN: "", TEST_MIGRATIONS: [] } as Record<string, unknown>;
function clean() {
  for (const db of databases.splice(0)) db.close();
  if (root) rmSync(root, { recursive: true, force: true });
}
export async function reset() {
  clean();
  root = mkdtempSync(join(tmpdir(), "seller-api-"));
  for (const key of ["DB", "RESTORED_DB"]) {
    const db = new DesktopDatabase(join(root, `${key}.sqlite`));
    databases.push(db);
    env[key] = db;
  }
  for (const key of ["ATTACHMENTS", "BACKUPS", "RESTORED_ATTACHMENTS"])
    env[key] = new FileBlobStore(join(root, key));
}
export async function applyD1Migrations(db: DesktopDatabase) {
  migrate(db, resolve("migrations"));
}
afterAll(clean);
