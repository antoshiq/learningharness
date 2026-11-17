import { expandThesis } from "@/server/brief";
import { handle, intParam, sse } from "@/server/http";

/** Open one thesis of an overview in more depth (cached after the first time). */
export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    const { thesis } = (await req.json()) as { thesis?: string };
    if (!thesis?.trim()) throw new Error("Пустой тезис");
    return sse((emit) => expandThesis(id, thesis, emit));
  });
