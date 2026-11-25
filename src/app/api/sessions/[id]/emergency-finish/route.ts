import { emergencyFinishSession } from "@/server/agent/run";
import { handle, intParam, json } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** Immediately close a session locally without sending a request to the model. */
export const POST = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    const summary = emergencyFinishSession(id);
    return json({ ok: true, summary });
  });
