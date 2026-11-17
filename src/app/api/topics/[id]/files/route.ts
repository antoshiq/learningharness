import { handle, intParam, json } from "@/server/http";
import { addMaterials, deleteMaterial, listMaterials, type Upload } from "@/server/materials";

type Ctx = { params: Promise<{ id: string }> };

export const GET = (_req: Request, ctx: Ctx) => handle(async () => json({ files: listMaterials(intParam((await ctx.params).id)) }));

/** Attach more files to a topic: {uploads: [{name, content, base64?}]}. */
export const POST = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const { uploads } = (await req.json()) as { uploads?: Upload[] };
    return json({ files: await addMaterials(intParam((await ctx.params).id), Array.isArray(uploads) ? uploads : []) });
  });

export const DELETE = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    deleteMaterial(id, intParam(new URL(req.url).searchParams.get("file") ?? ""));
    return json({ files: listMaterials(id) });
  });
