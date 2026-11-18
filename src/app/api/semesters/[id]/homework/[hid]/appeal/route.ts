import { handle, intParam, json } from "@/server/http";
import { appealHomework } from "@/server/semester/homework";

type Ctx = { params: Promise<{ id: string; hid: string }> };

/** {text}: dispute the grade once; the model reconsiders and may only raise it. */
export const POST = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const p = await ctx.params;
    const { text } = (await req.json()) as { text?: string };
    await appealHomework(intParam(p.id), intParam(p.hid), text ?? "");
    return json({ ok: true });
  });
