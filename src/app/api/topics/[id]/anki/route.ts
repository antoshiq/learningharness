import { ankiExport } from "@/server/anki";
import { handle, intParam } from "@/server/http";

/** Download the topic's questions and cards as an Anki import file. */
export const GET = (_req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { name, body } = ankiExport(intParam((await ctx.params).id));
    return new Response(body, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="anki.txt"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "cache-control": "no-store",
      },
    });
  });
