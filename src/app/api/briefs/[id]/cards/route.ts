import { makeCards } from "@/server/cards";
import { handle, intParam, json } from "@/server/http";

/** Make review cards from an overview (it becomes a topic if it is not one yet). */
export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { count } = (await req.json().catch(() => ({}))) as { count?: number };
    const n = Math.max(3, Math.min(30, Math.round(Number(count) || 10)));
    return json(await makeCards({ briefId: intParam((await ctx.params).id) }, n));
  });
