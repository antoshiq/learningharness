import { handle, json } from "@/server/http";
import { transcribePhotos } from "@/server/vision";

/** Photos of a solution to text: {photos: base64[], context?: the task}. The learner checks the text before sending it. */
export const POST = (req: Request) =>
  handle(async () => {
    const b = (await req.json()) as { photos?: string[]; context?: string };
    const photos = (Array.isArray(b.photos) ? b.photos : []).map((p) => Buffer.from(String(p).replace(/^data:[^,]*,/, ""), "base64"));
    return json(await transcribePhotos(photos, typeof b.context === "string" ? b.context : ""));
  });
