import { handle, intParam, json } from "@/server/http";
import { createHomework } from "@/server/semester/homework";

type Ctx = { params: Promise<{ id: string }> };

/** This week's homework: written once, then returned as is. */
export const POST = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    const h = await createHomework(intParam((await ctx.params).id));
    return json({ id: h.id });
  });
