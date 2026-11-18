import { handle, intParam, json } from "@/server/http";
import { recordAssessment, type AssessmentResult } from "@/server/semester/modules";

type Ctx = { params: Promise<{ id: string }> };

/** A finished exam goes into the grade book: {kind, moduleId, score, details}. */
export const POST = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    return json(recordAssessment(id, (await req.json()) as AssessmentResult));
  });
