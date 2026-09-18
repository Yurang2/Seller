import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppEnv } from "./env";
const keysets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export const auth = createMiddleware<AppEnv>(async (c, next) => {
  const url = new URL(c.req.url);
  const local = (url.protocol === "app:" && url.host === "seller") ||
    (["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  if (c.env.APP_ENV === "desktop" && local) {
    c.set("actor", "user");
    return next();
  }
  if (c.env.APP_ENV === "development") {
    c.set("actor", "user");
    return next();
  }
  const token = c.req.header("Cf-Access-Jwt-Assertion");
  if (
    !token ||
    !c.env.ACCESS_AUD ||
    !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(c.env.ACCESS_TEAM_DOMAIN)
  )
    return c.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Cloudflare Access 로그인이 필요합니다.",
          details: null,
        },
      },
      401,
    );
  try {
    const issuer = `https://${c.env.ACCESS_TEAM_DOMAIN}`;
    if (!keysets.has(issuer))
      keysets.set(
        issuer,
        createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),
      );
    await jwtVerify(token, keysets.get(issuer)!, {
      issuer,
      audience: c.env.ACCESS_AUD,
    });
    c.set("actor", "user");
  } catch {
    return c.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Access 인증을 확인할 수 없습니다.",
          details: null,
        },
      },
      401,
    );
  }
  return next();
});
