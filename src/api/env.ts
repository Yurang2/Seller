import type { BlobStore } from "../platform/storage";
export interface Env {
  DB: D1Database;
  ATTACHMENTS: BlobStore;
  BACKUPS: BlobStore;
  ASSETS: Pick<Fetcher, "fetch">;
  APP_ENV: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ENCRYPTION_KEY?: string;
}
export type AppEnv = { Bindings: Env; Variables: { actor: string } };
