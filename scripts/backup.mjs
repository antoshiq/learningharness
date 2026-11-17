// Automatic copy of the learning database, made by the launcher before the
// server starts: data/backups/auto-<date>.db, the newest five are kept.
import fs from "node:fs";
import path from "node:path";

const KEEP = 5;

const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}-${String(d.getMinutes()).padStart(2, "0")}-${String(d.getSeconds()).padStart(2, "0")}`;

/** Never throws: a failed backup must not keep the app from starting. */
export async function autoBackup(dataDir) {
  const db = path.join(dataDir, "tutor.db");
  if (!fs.existsSync(db)) return null;
  const dir = path.join(dataDir, "backups");
  try {
    fs.mkdirSync(dir, { recursive: true });
    const { default: Database } = await import("better-sqlite3");
    // The online backup API also picks up changes still sitting in the WAL file.
    const src = new Database(db, { fileMustExist: true });
    const file = path.join(dir, `auto-${stamp()}.db`);
    try {
      await src.backup(file);
    } finally {
      src.close();
    }
    const old = fs
      .readdirSync(dir)
      .filter((n) => /^auto-.*\.db$/.test(n))
      .sort()
      .reverse()
      .slice(KEEP);
    for (const n of old) fs.rmSync(path.join(dir, n), { force: true });
    return file;
  } catch (e) {
    console.warn(`Не удалось сделать резервную копию базы: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
