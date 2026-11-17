import { handle, json } from "@/server/http";
import { listExplanations, reviewExplanation } from "@/server/explain";

export const GET = (req: Request) =>
  handle(() => {
    const topic = Number(new URL(req.url).searchParams.get("topic"));
    if (!topic) throw new Error("Не указана тема");
    return json({ explanations: listExplanations(topic) });
  });

/** {topicId, nodeKey?|concept?, text} starts an explanation; {id, text} answers its follow-up question. */
export const POST = (req: Request) =>
  handle(async () => {
    const b = (await req.json()) as { id?: number; topicId?: number; nodeKey?: string; concept?: string; text?: string };
    return json(await reviewExplanation({ id: b.id ? Number(b.id) : undefined, topicId: b.topicId, nodeKey: b.nodeKey, concept: b.concept, text: b.text ?? "" }));
  });
