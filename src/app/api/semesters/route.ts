import { handle, json } from "@/server/http";
import { createSemester, listSemesters } from "@/server/semester";

export const GET = () => handle(() => json({ semesters: listSemesters() }));

/** A new semester; books are uploaded next, then preparation is started. */
export const POST = (req: Request) =>
  handle(async () => {
    const id = createSemester(await req.json());
    return json({ id });
  });
