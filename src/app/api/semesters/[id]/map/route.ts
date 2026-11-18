import { getSemesterRow } from "@/server/semester";
import { courseMap } from "@/server/semester/modules";
import { handle, intParam, json } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** Every module and idea of the semester with its level of knowing, for the course map. */
export const GET = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    const s = getSemesterRow(id);
    return json({ title: s.title, ...courseMap(id) });
  });
