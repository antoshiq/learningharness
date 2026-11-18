import { handle, json } from "@/server/http";
import { listOral, startOral } from "@/server/oral";

/** Past oral exams of a topic: ?topic=ID. */
export const GET = (req: Request) =>
  handle(() => {
    const topic = Number(new URL(req.url).searchParams.get("topic"));
    return json({ exams: listOral(topic) });
  });

/** Start an oral exam on a topic: {topicId}. The answer holds the examiner's first question. */
export const POST = (req: Request) =>
  handle(async () => {
    const { topicId } = (await req.json()) as { topicId?: number };
    return json(await startOral(Number(topicId)));
  });
