import { it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createDesktopEnv } from "../../src/platform/desktop-env";
import { createDesktopApp } from "../../src/platform/desktop-app";

it("serves the SPA and API without a listener, accepts app origin, rejects foreign origin and traversal", async () => {
  const root = mkdtempSync(join(tmpdir(), "seller-protocol-"));
  const storage = createDesktopEnv(join(root, "data"), resolve("migrations"));
  try {
    writeFileSync(join(root, "index.html"), "<h1>Seller</h1>");
    const app = createDesktopApp(root);
    expect(await (await app.fetch(new Request("app://seller/settings"), storage.env)).text()).toContain("Seller");
    const call = (url: string, headers: Record<string, string> = {}) => app.fetch(new Request(url, { headers }), storage.env);
    expect((await call("app://seller/api/v1/health")).status).toBe(200);
    expect((await app.fetch(new Request("app://seller/api/v1/seed", { method: "POST", headers: { Origin: "app://seller" } }), storage.env)).status).toBe(200);
    for (const url of ["app://evil/api/v1/health", "app://seller/%2e%2e%2fsecret.txt", "app://seller/a%5c..%5csecret.txt"])
      expect((await call(url)).status).toBeGreaterThanOrEqual(400);
    expect((await call("app://seller/api/v1/health", { Origin: "https://evil.example" })).status).toBe(403);
    expect((await call("app://seller/api/v1/not-found")).status).toBe(404);
  } finally { storage.close(); rmSync(root, { recursive: true, force: true }); }
});
