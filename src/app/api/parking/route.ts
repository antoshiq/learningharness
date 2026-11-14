import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { handle, json } from "@/server/http";

export const POST = (req: Request) =>
  handle(async () => {
    const b = (await req.json()) as { topicId: number; sessionId?: number; text?: string };
    const text = (b.text ?? "").trim();
    if (!text) throw new Error("Пустая запись");
    const row = getDb()
      .insert(schema.parking)
      .values({ topicId: Number(b.topicId), sessionId: b.sessionId ?? null, text: text.slice(0, 1000), createdAt: Date.now() })
      .returning()
      .get();
    return json(row);
  });

export const PATCH = (req: Request) =>
  handle(async () => {
    const b = (await req.json()) as { id: number; done?: boolean; remove?: boolean };
    const db = getDb();
    if (b.remove) db.delete(schema.parking).where(eq(schema.parking.id, Number(b.id))).run();
    else db.update(schema.parking).set({ done: !!b.done }).where(eq(schema.parking.id, Number(b.id))).run();
    return json({ ok: true });
  });
