import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { DesktopDatabase } from "../../src/platform/d1-shim";
import { FileBlobStore } from "../../src/platform/blob-store";
import { migrate } from "../../src/platform/migrate";
import worker from "../../src/api/index";

describe("desktop binding contract", () => {
  it("keeps null, results, undefined binding and atomic batch semantics", async () => {
    const db = new DesktopDatabase(":memory:");
    try {
      await db.prepare("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)").run();
      expect(await db.prepare("SELECT * FROM sample").first()).toBeNull();
      await db.prepare("INSERT INTO sample VALUES (?, ?)").bind(1, undefined).run();
      expect((await db.prepare("SELECT * FROM sample").all()).results).toEqual([{ id: 1, value: null }]);
      await expect(db.batch([
        db.prepare("INSERT INTO sample VALUES (2, 'rollback')"),
        db.prepare("INSERT INTO sample VALUES (1, 'duplicate')"),
      ])).rejects.toThrow();
      expect(await db.prepare("SELECT * FROM sample WHERE id=2").first()).toBeNull();
    } finally { db.close(); }
  });
  it("migrates only once, rejects edited history and rolls back a failing migration", async () => {
    const root = mkdtempSync(join(tmpdir(), "seller-migrate-"));
    const db = new DesktopDatabase(join(root, "seller.sqlite"));
    try {
      migrate(db, resolve("migrations"));
      migrate(db, resolve("migrations"));
      expect(await db.prepare("SELECT count(*) n FROM _migrations").first("n")).toBe(4);
      const dir = join(root, "migration"); mkdirSync(dir);
      writeFileSync(join(dir, "0004_fail.sql"), "CREATE TABLE rolled_back(id); --> statement-breakpoint INVALID SQL;");
      expect(() => migrate(db, dir)).toThrow();
      expect(await db.prepare("SELECT name FROM sqlite_master WHERE name='rolled_back'").first()).toBeNull();
      writeFileSync(join(dir, "0001_core.sql"), "SELECT 1;");
      expect(() => migrate(db, dir)).toThrow("Applied migration changed");
    } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it("roundtrips binary and stream blobs and rejects escaping keys", async () => {
    const root = mkdtempSync(join(tmpdir(), "seller-blobs-"));
    try {
      const store = new FileBlobStore(root);
      const bytes = new Uint8Array([0, 1, 128, 255]);
      await store.put("attachments/example", new Response(bytes).body!);
      expect(new Uint8Array(await (await store.get("attachments/example"))!.arrayBuffer())).toEqual(bytes);
      expect(new Uint8Array(await new Response((await store.get("attachments/example"))!.body).arrayBuffer())).toEqual(bytes);
      await store.delete("attachments/example");
      expect(await store.get("attachments/example")).toBeNull();
      for (const key of ["../outside", "/absolute", "a/../b", "C:\\secret", "a:stream"])
        await expect(store.put(key, "bad")).rejects.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("allows desktop authentication only for the app or loopback address", async () => {
    const db = new DesktopDatabase(":memory:");
    try {
      const env = { DB: db, APP_ENV: "desktop", ACCESS_AUD: "", ACCESS_TEAM_DOMAIN: "" };
      for (const url of ["app://seller", "http://localhost", "http://127.0.0.1", "http://[::1]"])
        expect((await worker.fetch(new Request(`${url}/api/v1/health`), env as never)).status).toBe(200);
      for (const url of ["https://evil.example", "app://evil", "https://localhost.evil.example"])
        expect((await worker.fetch(new Request(`${url}/api/v1/health`), env as never)).status).toBe(401);
    } finally { db.close(); }
  });
});
