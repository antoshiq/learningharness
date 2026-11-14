import { isRunning, runTurn } from "@/server/agent/run";
import { handle, intParam, json, sse } from "@/server/http";
import type { TurnInput } from "@/lib/types";

export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    const input = (await req.json()) as TurnInput;
    if (isRunning(id)) return json({ error: "В этой сессии уже идёт ход" }, 409);
    return sse((emit) => runTurn(id, input, emit));
  });
