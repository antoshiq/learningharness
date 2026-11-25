import { handle, intParam, json, sse } from "@/server/http";
import { addMaterials, deleteMaterial, listMaterials, type Upload } from "@/server/materials";

type Ctx = { params: Promise<{ id: string }> };

export const GET = (_req: Request, ctx: Ctx) => handle(async () => json({ files: listMaterials(intParam((await ctx.params).id)) }));

/** Attach more files to a topic: {uploads: [{name, content, base64?}], skipVision?, stream?}. */
export const POST = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    const { uploads, skipVision, stream } = (await req.json()) as { uploads?: Upload[]; skipVision?: boolean; stream?: boolean };
    const list = Array.isArray(uploads) ? uploads : [];
    if (stream) {
      return sse(async (emit) => {
        await addMaterials(id, list, { skipVision: !!skipVision, onProgress: (text) => emit({ type: "status", text }) });
      });
    }
    return json({ files: await addMaterials(id, list, { skipVision: !!skipVision }) });
  });

export const DELETE = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    deleteMaterial(id, intParam(new URL(req.url).searchParams.get("file") ?? ""));
    return json({ files: listMaterials(id) });
  });
