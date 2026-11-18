import { handle, intParam, json } from "@/server/http";
import { getSemesterView, reschedule } from "@/server/semester";

type Ctx = { params: Promise<{ id: string }> };

/** {days, weeks}: move the calendar by days and/or change the number of weeks. */
export const POST = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    reschedule(id, (await req.json()) as { days?: number; weeks?: number });
    return json(getSemesterView(id));
  });
