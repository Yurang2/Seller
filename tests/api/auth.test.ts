import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { beforeEach, it, expect } from "vitest";
import worker from "../../src/api/index";
import type { Env } from "../../src/api/env";
const bindings = env as unknown as Env & { TEST_MIGRATIONS: never[] };
// 바인딩은 beforeEach의 reset() 이후에 채워지므로 요청 시점에 읽는다.
const prod = () => ({
  ...bindings,
  APP_ENV: "production",
  AUTH_MODE: "passphrase",
  SESSION_SECRET: "test-session-secret-that-is-long-enough-0123456789",
});
const call = (path: string, init: RequestInit = {}, cookie = "") =>
  worker.fetch(
    new Request("http://seller.example" + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(init.headers ?? {}),
      },
    }),
    prod() as unknown as Env,
  );
const json = (o: unknown) => ({ method: "POST", body: JSON.stringify(o) });
beforeEach(async () => {
  await reset();
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
});
it("production requires login: setup once, login with cookie, lock after failures, logout invalidates", async () => {
  expect((await call("/api/v1/workspace")).status).toBe(401);
  const status = (await (await call("/api/v1/auth/status")).json()) as any;
  expect(status).toMatchObject({
    mode: "passphrase",
    configured: false,
    authenticated: false,
  });
  expect(
    (await call("/api/v1/auth/setup", json({ passphrase: "short" }))).status,
  ).toBe(400);
  const setup = await call(
    "/api/v1/auth/setup",
    json({ passphrase: "핑구 키링 장사 시작 2026" }),
  );
  expect(setup.status).toBe(200);
  const cookie = setup.headers.get("set-cookie")!.split(";")[0];
  expect(cookie.startsWith("seller_session=")).toBe(true);
  expect(setup.headers.get("set-cookie")).toContain("HttpOnly");
  expect(
    (
      await call(
        "/api/v1/auth/setup",
        json({ passphrase: "다시 설정 시도 12345" }),
      )
    ).status,
  ).toBe(409);
  expect((await call("/api/v1/workspace", {}, cookie)).status).toBe(200);
  expect(
    (
      await call(
        "/api/v1/workspace",
        {},
        "seller_session=1.9999999999999.x.forged",
      )
    ).status,
  ).toBe(401);
  for (let i = 0; i < 5; i++)
    expect(
      (await call("/api/v1/auth/login", json({ passphrase: "틀린 문구" })))
        .status,
    ).toBe(401);
  expect(
    (
      await call(
        "/api/v1/auth/login",
        json({ passphrase: "핑구 키링 장사 시작 2026" }),
      )
    ).status,
  ).toBe(429);
  expect((await call("/api/v1/auth/logout", json({}), cookie)).status).toBe(
    200,
  );
  expect((await call("/api/v1/workspace", {}, cookie)).status).toBe(401);
});
it("desktop/development bypass never applies in production and cross-origin login is rejected", async () => {
  expect(
    (
      await call("/api/v1/workspace", {
        headers: { Origin: "http://evil.example" },
      })
    ).status,
  ).toBe(401);
  const res = await call("/api/v1/auth/setup", {
    ...json({ passphrase: "핑구 키링 장사 시작 2026" }),
    headers: { Origin: "http://evil.example" },
  });
  expect(res.status).toBe(403);
});
