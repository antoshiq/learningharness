import { handle, intParam, json } from "@/server/http";
import { deletePlan, getPlan, updatePlan } from "@/server/studyplan";

type Ctx = { params: Promise<{ id: string }> };

export const GET = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    const p = getPlan(intParam((await ctx.params).id));
    return p ? json(p) : json({ error: "План не найден" }, 404);
  });

export const PUT = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    updatePlan(id, await req.json());
    return json(getPlan(id));
  });

export const DELETE = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    deletePlan(intParam((await ctx.params).id));
    return json({ ok: true });
  });
