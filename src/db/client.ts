import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;
/** A Drizzle handle inside a transaction. Same API as DB for our purposes. */
export type Tx = DB;

export interface OpenedDb {
  db: DB;
  sqlite: Database.Database;
  file: string;
}

/**
 * Where the database lives. The desktop app passes ASCEND_DATA_DIR
 * (~/Library/Application Support/ASCEND). Development falls back to ./data.
 */
export function dataDir(): string {
  if (process.env.ASCEND_DATA_DIR) return process.env.ASCEND_DATA_DIR;
  if (process.env.NODE_ENV === "test") return path.join(os.tmpdir(), "ascend-test");
  return path.join(process.cwd(), "data");
}

export function migrationsDir(): string {
  if (process.env.ASCEND_MIGRATIONS_DIR) return process.env.ASCEND_MIGRATIONS_DIR;
  return path.join(process.cwd(), "drizzle");
}

export function openDb(file?: string): OpenedDb {
  const target = file ?? path.join(dataDir(), "ascend.db");
  if (target !== ":memory:") fs.mkdirSync(path.dirname(target), { recursive: true });
  const sqlite = new Database(target);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsDir() });
  return { db, sqlite, file: target };
}

let shared: OpenedDb | undefined;

/** The app-wide connection, opened lazily. */
export function getDb(): DB {
  if (!shared) shared = openDb();
  return shared.db;
}
