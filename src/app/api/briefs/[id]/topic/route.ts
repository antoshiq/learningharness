import { briefToTopic } from "@/server/brief";
import { handle, intParam, json } from "@/server/http";

/** Turn an overview into a full topic to study with the tutor. */
export const POST = (_req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => json({ id: briefToTopic(intParam((await ctx.params).id)) }));
