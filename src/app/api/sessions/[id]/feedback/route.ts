import { getDb } from "@/server/db";
import type { StepFeedbackKind } from "@/server/db/schema";
import { addFeedback, sessionFeedback } from "@/server/feedback";
import { handle, intParam, json } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** Mark a step ("unclear", "too long", "a mistake"); the same mark again takes it back. */
export const POST = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    const { kind, text, comment } = (await req.json()) as { kind: StepFeedbackKind; text: string; comment?: string };
    addFeedback(getDb(), id, kind, String(text ?? ""), comment);
    return json({ feedback: sessionFeedback(getDb(), id) });
  });
