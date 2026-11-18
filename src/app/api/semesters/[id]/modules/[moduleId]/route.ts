import { handle, intParam, json } from "@/server/http";
import { moduleRow, prepareModule } from "@/server/semester/modules";

type Ctx = { params: Promise<{ id: string; moduleId: string }> };

/** Prepare a module now (its ideas and topic); answers with the topic to open. */
export const POST = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    const p = await ctx.params;
    const m = moduleRow(intParam(p.moduleId));
    if (m.semesterId !== intParam(p.id)) throw new Error("Модуль не из этого семестра");
    return json({ topicId: await prepareModule(m.id) });
  });
