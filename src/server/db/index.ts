import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, ROOT } from "../paths";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const g = globalThis as unknown as { __tutorDb?: Db };

export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(ROOT, "drizzle") });
  return db;
}

/** One connection per server process (survives Next's per-route module instances). */
export function getDb(): Db {
  if (!g.__tutorDb) g.__tutorDb = openDb(path.join(DATA_DIR, "tutor.db"));
  return g.__tutorDb;
}

/** Close the shared connection (before the database file is replaced); the next getDb() reopens it. */
export function closeDb() {
  g.__tutorDb?.$client.close();
  g.__tutorDb = undefined;
}

export { schema };
