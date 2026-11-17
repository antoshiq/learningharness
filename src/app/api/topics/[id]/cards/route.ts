import { makeCards, topicCards } from "@/server/cards";
import { handle, intParam, json } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = (_req: Request, ctx: Ctx) => handle(async () => json({ cards: topicCards(intParam((await ctx.params).id)) }));

/** Make review cards from the topic's cheat sheet. */
export const POST = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const { count } = (await req.json().catch(() => ({}))) as { count?: number };
    const n = Math.max(3, Math.min(30, Math.round(Number(count) || 10)));
    return json(await makeCards({ topicId: intParam((await ctx.params).id) }, n));
  });
