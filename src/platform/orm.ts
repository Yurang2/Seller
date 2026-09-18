import { drizzle as workersDrizzle } from "drizzle-orm/d1";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { BatchItem } from "drizzle-orm/batch";

export type DesktopOrm = BetterSQLite3Database & {
  batch(writes: readonly BatchItem<"sqlite">[]): Promise<void>;
};
// Desktop registers its driver at the binding boundary. No native dependency
// is imported into the Workers runtime graph.
const desktopDrivers = new WeakMap<D1Database, DesktopOrm>();
export function registerDesktopOrm(db: D1Database, orm: DesktopOrm) {
  desktopDrivers.set(db, orm);
}
export function drizzle(db: D1Database) {
  return desktopDrivers.get(db) ?? workersDrizzle(db);
}
