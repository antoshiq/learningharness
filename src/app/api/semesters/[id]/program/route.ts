import { handle, intParam, json } from "@/server/http";
import { getSemesterView, saveProgram, type ModuleEdit } from "@/server/semester";

type Ctx = { params: Promise<{ id: string }> };

/** Save the edited draft program: {modules: [{part, title, summary, hours, sections: [{title, summary, refs}]}]}. */
export const PUT = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    const { modules } = (await req.json()) as { modules: ModuleEdit[] };
    saveProgram(id, modules);
    return json(getSemesterView(id));
  });
