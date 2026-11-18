import { handle, intParam, json } from "@/server/http";
import { approveProgram, getSemesterView } from "@/server/semester";

type Ctx = { params: Promise<{ id: string }> };

export const POST = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    approveProgram(id);
    return json(getSemesterView(id));
  });
