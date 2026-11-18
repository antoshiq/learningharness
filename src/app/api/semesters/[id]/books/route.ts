import { handle, intParam, json } from "@/server/http";
import { addBook, getSemesterView, startPreparation } from "@/server/semester";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Upload one book as the raw request body: ?name=…&role=main|problems|lectures|extra.
 * One file per request, so a large textbook does not have to travel as base64 JSON.
 * In an active semester the new book is read right away.
 */
export const POST = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    const url = new URL(req.url);
    const name = url.searchParams.get("name") ?? "книга";
    const role = url.searchParams.get("role") ?? "main";
    const data = new Uint8Array(await req.arrayBuffer());
    if (!data.length) throw new Error("Пустой файл");
    const bookId = await addBook(id, name, role, data);
    const view = getSemesterView(id);
    if (view.status === "active" || view.status === "finished") startPreparation(id);
    return json({ bookId });
  });
