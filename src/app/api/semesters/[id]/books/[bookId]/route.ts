import { handle, intParam, json } from "@/server/http";
import { bookOutline, removeBook, setBookRole } from "@/server/semester";

type Ctx = { params: Promise<{ id: string; bookId: string }> };

/** The book's sections, for adding them to the program by hand. */
export const GET = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    const p = await ctx.params;
    return json({ sections: bookOutline(intParam(p.id), intParam(p.bookId)) });
  });

export const PATCH = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const p = await ctx.params;
    const { role } = (await req.json()) as { role?: string };
    setBookRole(intParam(p.id), intParam(p.bookId), role ?? "");
    return json({ ok: true });
  });

export const DELETE = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    const p = await ctx.params;
    removeBook(intParam(p.id), intParam(p.bookId));
    return json({ ok: true });
  });
