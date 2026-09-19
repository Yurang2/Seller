import { Hono } from "hono";
import { z } from "zod";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "./env";
import { AppError } from "./errors";
// 혼자 쓰는 앱의 로그인: 비밀문구 하나 + 서명된 세션 쿠키.
// 비밀문구는 PBKDF2 해시로만 저장하고, 세션은 SESSION_SECRET(Worker secret)으로 서명한다.
const COOKIE = "seller_session";
const SESSION_DAYS = 30;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
// Cloudflare Workers의 WebCrypto는 PBKDF2 반복 100,000회를 상한으로 둔다(초과 시 NotSupportedError).
const ITERATIONS = 100_000;
const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function pbkdf2(pass: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(pass.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
}
async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64(await crypto.subtle.sign("HMAC", key, enc.encode(data)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
type Row = Record<string, any>;
async function setting(db: D1Database, key: string): Promise<Row | null> {
  const r = await db
    .prepare("SELECT value_json FROM settings WHERE key=?")
    .bind(key)
    .first<{ value_json: string }>();
  return r ? JSON.parse(r.value_json) : null;
}
async function putSetting(db: D1Database, key: string, value: unknown) {
  await db
    .prepare(
      "INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
    )
    .bind(key, JSON.stringify(value), new Date().toISOString())
    .run();
}
export async function isConfigured(db: D1Database) {
  return !!(await setting(db, "auth_passphrase"));
}
async function issueSession(c: any, db: D1Database) {
  const secret = c.env.SESSION_SECRET as string | undefined;
  if (!secret || secret.length < 32)
    throw new AppError(
      400,
      "SERVER_NOT_READY",
      "SESSION_SECRET이 설정되지 않았습니다.",
    );
  const version =
    ((await setting(db, "auth_session_version")) as number | null) ?? 1;
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const nonce = b64(crypto.getRandomValues(new Uint8Array(16)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const body = `${version}.${exp}.${nonce}`;
  const token = `${body}.${await hmac(secret, body)}`;
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}
export async function hasValidSession(c: any) {
  const secret = c.env.SESSION_SECRET as string | undefined;
  const token = getCookie(c, COOKIE);
  if (!secret || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [version, exp, nonce, sig] = parts;
  if (!equal(sig, await hmac(secret, `${version}.${exp}.${nonce}`)))
    return false;
  if (Number(exp) < Date.now()) return false;
  const current =
    ((await setting(c.env.DB, "auth_session_version")) as number | null) ?? 1;
  return Number(version) === current;
}
export const authRoutes = new Hono<AppEnv>();
const passSchema = z.object({ passphrase: z.string().min(12).max(200) });
authRoutes.get("/auth/status", async (c) =>
  c.json({
    mode: c.env.AUTH_MODE ?? "passphrase",
    configured: await isConfigured(c.env.DB),
    authenticated: await hasValidSession(c),
  }),
);
authRoutes.post("/auth/setup", async (c) => {
  if (await isConfigured(c.env.DB))
    throw new AppError(
      409,
      "ALREADY_CONFIGURED",
      "비밀문구가 이미 설정돼 있습니다. 로그인하세요.",
    );
  const { passphrase } = passSchema.parse(await c.req.json());
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await putSetting(c.env.DB, "auth_passphrase", {
    salt: b64(salt),
    hash: b64(await pbkdf2(passphrase, salt, ITERATIONS)),
    iterations: ITERATIONS,
    set_at: new Date().toISOString(),
  });
  await putSetting(c.env.DB, "auth_session_version", 1);
  await issueSession(c, c.env.DB);
  return c.json({ ok: true });
});
authRoutes.post("/auth/login", async (c) => {
  const stored = await setting(c.env.DB, "auth_passphrase");
  if (!stored)
    throw new AppError(409, "NOT_CONFIGURED", "먼저 비밀문구를 설정하세요.");
  const lock = (await setting(c.env.DB, "auth_lock")) ?? {
    failed: 0,
    lock_until: 0,
  };
  if (lock.lock_until > Date.now())
    throw new AppError(
      429,
      "LOCKED",
      `틀린 시도가 많아 ${Math.ceil((lock.lock_until - Date.now()) / 60000)}분 동안 잠겼습니다.`,
    );
  const { passphrase } = z
    .object({ passphrase: z.string().min(1).max(200) })
    .parse(await c.req.json());
  const hash = b64(
    await pbkdf2(passphrase, fromB64(stored.salt), stored.iterations),
  );
  if (!equal(hash, stored.hash)) {
    const failed =
      (lock.lock_until > 0 && lock.lock_until <= Date.now() ? 0 : lock.failed) +
      1;
    await putSetting(c.env.DB, "auth_lock", {
      failed,
      lock_until: failed >= MAX_FAILS ? Date.now() + LOCK_MINUTES * 60000 : 0,
    });
    throw new AppError(
      401,
      "WRONG_PASSPHRASE",
      failed >= MAX_FAILS
        ? `틀린 시도 ${failed}회. ${LOCK_MINUTES}분 동안 잠깁니다.`
        : `비밀문구가 틀렸습니다. (${MAX_FAILS - failed}회 남음)`,
    );
  }
  await putSetting(c.env.DB, "auth_lock", { failed: 0, lock_until: 0 });
  await issueSession(c, c.env.DB);
  return c.json({ ok: true });
});
authRoutes.post("/auth/logout", async (c) => {
  const version =
    ((await setting(c.env.DB, "auth_session_version")) as number | null) ?? 1;
  await putSetting(c.env.DB, "auth_session_version", version + 1);
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});
