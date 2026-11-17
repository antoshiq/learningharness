import { eq } from "drizzle-orm";
import { getBrief } from "@/server/brief";
import { getDb, schema } from "@/server/db";
import { handle, intParam, json } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    const b = getBrief(intParam((await ctx.params).id));
    return b ? json(b) : json({ error: "Экскурс не найден" }, 404);
  });

export const DELETE = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    getDb()
      .delete(schema.briefs)
      .where(eq(schema.briefs.id, intParam((await ctx.params).id)))
      .run();
    return json({ ok: true });
  });
