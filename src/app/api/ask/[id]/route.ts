import { deleteChat, getChat } from "@/server/ask";
import { handle, intParam, json } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    const c = getChat(intParam((await ctx.params).id));
    return c ? json(c) : json({ error: "Разговор не найден" }, 404);
  });

export const DELETE = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    deleteChat(intParam((await ctx.params).id));
    return json({ ok: true });
  });
