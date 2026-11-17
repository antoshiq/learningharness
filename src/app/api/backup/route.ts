import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { backupPath, exportCopy, listBackups, restoreFrom } from "@/server/backup";
import { handle, json } from "@/server/http";

const MAX_UPLOAD = 512 * 1024 * 1024;

/** GET: download a fresh copy of the database. GET ?list=1: the saved copies in data/backups. */
export const GET = (req: Request) =>
  handle(async () => {
    if (new URL(req.url).searchParams.has("list")) return json({ backups: listBackups() });
    const { file, name } = await exportCopy();
    const data = fs.readFileSync(file);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    return new Response(data, {
      headers: {
        "content-type": "application/vnd.sqlite3",
        "content-disposition": `attachment; filename="${name}"`,
        "content-length": String(data.length),
        "cache-control": "no-store",
      },
    });
  });

/**
 * Restore. POST ?name=<saved copy> restores one of data/backups; otherwise the
 * request body is an uploaded database file.
 */
export const POST = (req: Request) =>
  handle(async () => {
    const name = new URL(req.url).searchParams.get("name");
    if (name) return json(await restoreFrom(backupPath(name)));

    const body = Buffer.from(await req.arrayBuffer());
    if (!body.length) throw new Error("Пустой файл");
    if (body.length > MAX_UPLOAD) throw new Error("Файл слишком большой");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-import-"));
    const file = path.join(dir, "upload.db");
    try {
      fs.writeFileSync(file, body);
      return json(await restoreFrom(file));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
