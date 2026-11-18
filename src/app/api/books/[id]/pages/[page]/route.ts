import { pageText } from "@/server/book-read";
import { handle, intParam, json } from "@/server/http";

type Ctx = { params: Promise<{ id: string; page: string }> };

/** The stored text of a page: for text books, and when the original file is missing. */
export const GET = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    const p = await ctx.params;
    return json({ text: pageText(intParam(p.id), intParam(p.page)) });
  });
