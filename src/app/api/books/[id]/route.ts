import { bookInfo } from "@/server/book-read";
import { handle, intParam, json } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** A book for the page viewer: name, pages, sections, whether the original file is there. */
export const GET = (_req: Request, ctx: Ctx) => handle(async () => json(bookInfo(intParam((await ctx.params).id))));
