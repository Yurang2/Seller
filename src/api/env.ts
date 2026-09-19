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
  AUTH_MODE?: string;
  SESSION_SECRET?: string;
  // 재확인 알림(선택): Resend API 키(secret)와 받을 주소(var). 둘 다 있을 때만 이메일을 보낸다.
  RESEND_API_KEY?: string;
  DIGEST_EMAIL?: string;
}
export type AppEnv = { Bindings: Env; Variables: { actor: string } };
