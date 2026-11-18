import { handle, intParam, json } from "@/server/http";
import { getSemesterView, pauseSemester, resumeSemester } from "@/server/semester";

type Ctx = { params: Promise<{ id: string }> };

/** {action: "pause" | "resume"}: freeze the calendar, or go on with it moved by the days of the pause. */
export const POST = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    const { action } = (await req.json()) as { action?: string };
    if (action === "pause") pauseSemester(id);
    else if (action === "resume") resumeSemester(id);
    else throw new Error("Неизвестное действие");
    return json(getSemesterView(id));
  });
