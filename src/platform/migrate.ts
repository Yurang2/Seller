import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { DesktopDatabase } from "./d1-shim";

export function migrate(db: DesktopDatabase, directory: string) {
  const sql = db.sqlite;
  sql.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)");
  for (const name of readdirSync(directory).filter(n => n.endsWith(".sql")).sort()) {
    const source = readFileSync(join(directory, name), "utf8");
    const hash = createHash("sha256").update(source).digest("hex");
    sql.transaction(() => {
      const existing = sql.prepare("SELECT sha256 FROM _migrations WHERE name=?").get(name) as { sha256: string } | undefined;
      if (existing) {
        if (existing.sha256 !== hash) throw new Error(`Applied migration changed: ${name}`);
        return;
      }
      for (const statement of source.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean))
        sql.exec(statement);
      sql.prepare("INSERT INTO _migrations VALUES (?, ?, ?)").run(name, hash, new Date().toISOString());
    })();
  }
}
