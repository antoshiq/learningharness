import fs from "node:fs";
import { Readable } from "node:stream";
import { bookFilePath } from "@/server/book-read";
import { getDb, schema } from "@/server/db";
import { handle, intParam, json } from "@/server/http";
import { eq } from "drizzle-orm";

type Ctx = { params: Promise<{ id: string }> };

/** The original file, streamed: the browser renders PDF pages itself, the server only reads from disk. */
export const GET = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    const b = getDb().select({ file: schema.books.file, format: schema.books.format }).from(schema.books).where(eq(schema.books.id, id)).get();
    const file = bookFilePath(b?.file ?? null);
    if (!b || !file) return json({ error: "Исходного файла нет" }, 404);
    const size = fs.statSync(file).size;
    return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
      headers: {
        "content-type": b.format === "pdf" ? "application/pdf" : "text/plain; charset=utf-8",
        "content-length": String(size),
        "cache-control": "private, max-age=86400",
      },
    });
  });
