import { getDb } from "@/server/db";
import { handle, intParam, json } from "@/server/http";
import { deleteTheory, topicTheory } from "@/server/theory";

type Ctx = { params: Promise<{ id: string }> };

/** The topic's theory from lessons, by idea of the plan. */
export const GET = (_req: Request, ctx: Ctx) => handle(async () => json({ nodes: topicTheory(getDb(), intParam((await ctx.params).id)) }));

/** Remove one explanation (a wrong or useless one). */
export const DELETE = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const topicId = intParam((await ctx.params).id);
    const id = intParam(new URL(req.url).searchParams.get("entry") ?? "");
    deleteTheory(getDb(), topicId, id);
    return json({ nodes: topicTheory(getDb(), topicId) });
  });
