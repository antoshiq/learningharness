import { handle, intParam, json } from "@/server/http";
import { buildAssessment } from "@/server/semester/modules";
import type { AssessmentKind } from "@/server/db/schema";

type Ctx = { params: Promise<{ id: string }> };

/** Questions for a checkpoint, the placement test, or the midterm/final: {kind, moduleId}. */
export const POST = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    const b = (await req.json()) as { kind?: AssessmentKind; moduleId?: number | null };
    return json(await buildAssessment(id, b.kind ?? "checkpoint", b.moduleId ?? null));
  });
