import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute, extname } from "node:path";
import api from "../api/index";
import type { Env } from "../api/env";

export function isAppUrl(value: string) {
  try { const u = new URL(value); return u.protocol === "app:" && u.host === "seller" && !u.username && !u.password; }
  catch { return false; }
}
const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
export function createDesktopApp(clientDirectory: string) {
  const root = resolve(clientDirectory);
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      if (!isAppUrl(request.url)) return new Response("Forbidden", { status: 403 });
      const initiator = (request as Request & { initiatorOrigin?: string }).initiatorOrigin;
      if (initiator !== undefined && !isAppUrl(initiator)) return new Response("Forbidden", { status: 403 });
      const origin = request.headers.get("Origin");
      if (origin && origin !== "app://seller") return new Response("Forbidden", { status: 403 });
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        // WHATWG URL.origin is "null" for custom schemes in Node. The shell
        // validates the real origin above before adapting to Hono's check.
        const headers = new Headers(request.headers);
        if (origin) headers.set("Origin", url.origin);
        return api.fetch(new Request(request, { headers }), env);
      }
      if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
      let path: string;
      try { path = decodeURIComponent(url.pathname); } catch { return new Response("Bad path", { status: 400 }); }
      if (path.includes("\\") || path.includes("\0") || path.includes(":")) return new Response("Bad path", { status: 400 });
      let file = resolve(root, "." + path);
      const rel = relative(root, file);
      if (rel.startsWith("..") || isAbsolute(rel)) return new Response("Forbidden", { status: 403 });
      if (!extname(file)) file = resolve(root, "index.html");
      try {
        const bytes = await readFile(file);
        return new Response(request.method === "HEAD" ? null : bytes, { headers: {
          "Content-Type": mime[extname(file)] ?? "application/octet-stream",
          "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'",
          "X-Content-Type-Options": "nosniff",
        } });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return new Response("Not found", { status: 404 });
        throw e;
      }
    },
  };
}
