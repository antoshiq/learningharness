import { handle, intParam, json } from "@/server/http";
import { getHomework, homeworkModuleTitles, submitHomework } from "@/server/semester/homework";
import { getSemesterRow } from "@/server/semester";

type Ctx = { params: Promise<{ id: string; hid: string }> };

const view = (semesterId: number, id: number) => {
  const h = getHomework(semesterId, id);
  const sem = getSemesterRow(semesterId);
  return { ...h, semester: { id: sem.id, title: sem.title }, modules: homeworkModuleTitles(h.moduleIds) };
};

export const GET = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    const p = await ctx.params;
    return json(view(intParam(p.id), intParam(p.hid)));
  });

/** Submit an answer: {answer}. It is graded against the rubric right away. */
export const POST = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const p = await ctx.params;
    const { answer } = (await req.json()) as { answer?: string };
    await submitHomework(intParam(p.id), intParam(p.hid), answer ?? "");
    return json(view(intParam(p.id), intParam(p.hid)));
  });
