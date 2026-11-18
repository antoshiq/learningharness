import { handle, intParam, json } from "@/server/http";
import { getSemesterView, startPreparation } from "@/server/semester";

type Ctx = { params: Promise<{ id: string }> };

/** Read the books and build the program in the background. {rebuild: true} rebuilds a draft program from scratch. */
export const POST = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    const { rebuild } = (await req.json().catch(() => ({}))) as { rebuild?: boolean };
    startPreparation(id, !!rebuild);
    return json(getSemesterView(id));
  });
