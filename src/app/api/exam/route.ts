import { buildExam } from "@/server/exam";
import { handle, json } from "@/server/http";

/** Put together an exam for a topic: {topicId, count, generate}. */
export const POST = (req: Request) =>
  handle(async () => {
    const b = (await req.json()) as { topicId?: number; count?: number; generate?: boolean };
    const count = Math.max(3, Math.min(50, Math.round(Number(b.count) || 15)));
    return json(await buildExam(Number(b.topicId), count, b.generate !== false));
  });
