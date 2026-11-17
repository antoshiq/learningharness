// Backups of the learning database: download, restore from a file, and the
// automatic copies the launcher makes on every start (data/backups/auto-*.db).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { closeDb, getDb } from "./db";
import { DATA_DIR } from "./paths";
import { anyRunning } from "./agent/run";

export const BACKUP_DIR = path.join(DATA_DIR, "backups");
const DB_FILE = () => path.join(DATA_DIR, "tutor.db");
const NAME_RE = /^[\w.-]+\.db$/;
const REQUIRED = ["topics", "nodes", "sessions", "attempts", "parking", "usage"];

export interface BackupInfo {
  name: string;
  size: number;
  at: number;
  auto: boolean;
}

const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}-${String(d.getMinutes()).padStart(2, "0")}-${String(d.getSeconds()).padStart(2, "0")}`;

/** Consistent copy of the live database (works while the app is writing). */
export async function snapshot(file: string): Promise<void> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await getDb().$client.backup(file);
}

/** A temporary copy for download; the caller deletes it. */
export async function exportCopy(): Promise<{ file: string; name: string }> {
  const name = `tutor-${stamp()}.db`;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tutor-export-")), name);
  await snapshot(file);
  return { file, name };
}

export function listBackups(): BackupInfo[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((n) => NAME_RE.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, size: st.size, at: st.mtimeMs, auto: name.startsWith("auto-") };
    })
    .sort((a, b) => b.at - a.at);
}

/** Refuse anything that is not a readable database of this app. */
function validate(file: string) {
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const check = db.pragma("quick_check", { simple: true });
    if (check !== "ok") throw new Error("Файл базы повреждён");
    const tables = new Set((db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((r) => r.name));
    const missing = REQUIRED.filter((t) => !tables.has(t));
    if (missing.length) throw new Error("Это не резервная копия репетитора: нет таблиц " + missing.join(", "));
  } catch (e) {
    if (e instanceof Error && /file is not a database|SQLITE_NOTADB/i.test(e.message)) throw new Error("Это не файл базы данных SQLite");
    throw e;
  } finally {
    db?.close();
  }
}

/**
 * Replace the live database with `source`. The current data is saved to
 * data/backups/before-restore-*.db first, so a restore can always be undone.
 */
export async function restoreFrom(source: string): Promise<{ savedAs: string }> {
  if (anyRunning()) throw new Error("Сейчас идёт ход репетитора. Дождись его окончания и повтори.");
  validate(source);
  const savedAs = `before-restore-${stamp()}.db`;
  await snapshot(path.join(BACKUP_DIR, savedAs));

  const tmp = DB_FILE() + ".restore";
  fs.copyFileSync(source, tmp);
  closeDb();
  for (const ext of ["-wal", "-shm"]) fs.rmSync(DB_FILE() + ext, { force: true });
  fs.renameSync(tmp, DB_FILE());
  // Reopening runs migrations, so a backup from an older version is upgraded.
  getDb();
  return { savedAs };
}

export function backupPath(name: string): string {
  if (!NAME_RE.test(name)) throw new Error("Некорректное имя копии");
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) throw new Error("Копия не найдена");
  return file;
}
