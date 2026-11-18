import { handle, intParam, json } from "@/server/http";
import { answerOral, finishOral, getOral } from "@/server/oral";

type Ctx = { params: Promise<{ id: string }> };

export const GET = (_req: Request, ctx: Ctx) => handle(async () => json(getOral(intParam((await ctx.params).id))));

/** {answer} — the next answer; {finish: true} — end now and grade. */
export const POST = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    const b = (await req.json()) as { answer?: string; finish?: boolean };
    return json(b.finish ? await finishOral(id) : await answerOral(id, b.answer ?? ""));
  });
