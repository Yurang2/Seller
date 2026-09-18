import Sqlite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { registerDesktopOrm, type DesktopOrm } from "./orm";

function result<T>(results: T[], changes = 0, lastRowId = 0): D1Result<T> {
  return { success: true, results, meta: {
    duration: 0, size_after: 0, rows_read: results.length,
    rows_written: changes, last_row_id: lastRowId, changed_db: changes > 0, changes,
  } };
}
class Statement implements D1PreparedStatement {
  constructor(readonly owner: DesktopDatabase, readonly sql: string, readonly values: unknown[] = []) {}
  bind(...values: unknown[]) {
    return new Statement(this.owner, this.sql, values.map(v => v === undefined ? null : v));
  }
  private native() { return this.owner.sqlite.prepare(this.sql); }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.native().get(...this.values) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (column !== undefined && !(column in row)) throw new Error(`Unknown column: ${column}`);
    return (column === undefined ? row : row[column]) as T;
  }
  execute<T>(): D1Result<T> {
    const stmt = this.native();
    if (stmt.reader) return result(stmt.all(...this.values) as T[]);
    const info = stmt.run(...this.values);
    return result<T>([], info.changes, Number(info.lastInsertRowid));
  }
  async all<T = Record<string, unknown>>() { return this.execute<T>(); }
  async run<T = Record<string, unknown>>() { return this.execute<T>(); }
  async raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  async raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const stmt = this.native();
    const rows = stmt.raw().all(...this.values) as T[];
    return options?.columnNames ? [stmt.columns().map(c => c.name), ...rows] : rows;
  }
}

export class DesktopDatabase implements D1Database {
  readonly sqlite: Sqlite.Database;
  constructor(filename: string) {
    this.sqlite = new Sqlite(filename);
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("busy_timeout = 5000");
    const native = drizzle(this.sqlite);
    const orm: DesktopOrm = Object.assign(native, {
      batch: async (writes: readonly { }[]) => {
        // Drizzle's sync run() must execute inside the native transaction;
        // awaiting thenables here would commit before the writes run.
        this.sqlite.transaction(() => {
          for (const write of writes) {
            if (!("run" in write) || typeof write.run !== "function")
              throw new Error("Desktop ORM batch only accepts write queries");
            write.run();
          }
        })();
      },
    });
    registerDesktopOrm(this, orm);
  }
  prepare(sql: string) { return new Statement(this, sql); }
  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return this.sqlite.transaction(() => statements.map(stmt => {
      if (!(stmt instanceof Statement) || stmt.owner !== this)
        throw new Error("A batch must use statements from the same database");
      return stmt.execute<T>();
    }))();
  }
  async exec(sql: string): Promise<D1ExecResult> {
    this.sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }
  withSession(): D1DatabaseSession {
    return { prepare: this.prepare.bind(this), batch: this.batch.bind(this), getBookmark: () => null };
  }
  async dump(): Promise<ArrayBuffer> { return Uint8Array.from(this.sqlite.serialize()).buffer; }
  close() { this.sqlite.close(); }
}
