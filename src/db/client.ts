import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

/** Drizzle database handle typed with the full schema. */
export type Db = BetterSQLite3Database<typeof schema>;

export interface OpenDbResult {
  db: Db;
  sqlite: Database.Database;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Package root = nearest ancestor of this module that contains package.json.
 * Works both from `src/` (tsx) and from `dist/` (built output).
 */
export function packageRoot(): string {
  let dir = HERE;
  for (;;) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate package root (package.json) above ${HERE}`);
    }
    dir = parent;
  }
}

/** Absolute path of the generated migrations folder. */
export function migrationsFolder(): string {
  return path.join(packageRoot(), "drizzle");
}

/**
 * Open (or create) the SQLite database.
 * WAL is only enabled for file-backed databases; `:memory:` does not support it.
 */
export function openDb(dbPath: string): OpenDbResult {
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (dir !== "" && dir !== ".") mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  if (dbPath !== ":memory:") sqlite.pragma("journal_mode = WAL");

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

/** Apply all pending migrations from the package's `drizzle/` folder. */
export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: migrationsFolder() });
}
