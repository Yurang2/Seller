import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Env } from "../api/env";
import { DesktopDatabase } from "./d1-shim";
import { FileBlobStore } from "./blob-store";
import { migrate } from "./migrate";

export function createDesktopEnv(dataDirectory: string, migrations: string) {
  mkdirSync(dataDirectory, { recursive: true });
  const DB = new DesktopDatabase(join(dataDirectory, "seller.sqlite"));
  try { migrate(DB, migrations); } catch (e) { DB.close(); throw e; }
  const env: Env = {
    DB, ATTACHMENTS: new FileBlobStore(join(dataDirectory, "attachments")),
    BACKUPS: new FileBlobStore(join(dataDirectory, "backups")),
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    APP_ENV: "desktop", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "",
  };
  return { env, db: DB, close: () => DB.close() };
}
