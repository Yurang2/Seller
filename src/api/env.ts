export interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  BACKUPS: R2Bucket;
  ASSETS: Fetcher;
  APP_ENV: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ENCRYPTION_KEY?: string;
}
export type AppEnv = { Bindings: Env; Variables: { actor: string } };
