import { handle, intParam, json } from "@/server/http";
import { deleteSemester, getSemesterView, updateSemester } from "@/server/semester";

type Ctx = { params: Promise<{ id: string }> };

export const GET = (_req: Request, ctx: Ctx) => handle(async () => json(getSemesterView(intParam((await ctx.params).id))));

/** Title, level, goal, weeks, hours per week, start date. */
export const PUT = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    updateSemester(id, await req.json());
    return json(getSemesterView(id));
  });

export const DELETE = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    deleteSemester(intParam((await ctx.params).id));
    return json({ ok: true });
  });
