import { handle, intParam, json } from "@/server/http";
import { getSessionView } from "@/server/sessions";

export const GET = (_req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const view = getSessionView(intParam((await ctx.params).id));
    return view ? json(view) : json({ error: "Сессия не найдена" }, 404);
  });
