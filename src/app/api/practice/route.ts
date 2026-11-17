import type { AnswerPayload, SelfGrade } from "@/lib/types";
import { handle, json } from "@/server/http";
import { openMistakes, recordDrill, reviewQueue } from "@/server/practice";

/** GET ?mode=review|mistakes[&topic=ID]: the questions to practise now. */
export const GET = (req: Request) =>
  handle(() => {
    const url = new URL(req.url);
    const topic = Number(url.searchParams.get("topic")) || undefined;
    if (url.searchParams.get("mode") === "mistakes") return json({ items: openMistakes(topic), tutorOnly: [] });
    return json(reviewQueue(topic));
  });

/** POST one answer: graded, saved, and applied to the idea's review schedule. */
export const POST = (req: Request) =>
  handle(async () => {
    const b = (await req.json()) as { attemptId?: number; mode?: string; answer?: AnswerPayload; selfGrade?: SelfGrade };
    if (!b.answer || typeof b.answer !== "object") throw new Error("Нет ответа");
    const selfGrade = b.selfGrade && ["correct", "partial", "wrong"].includes(b.selfGrade) ? b.selfGrade : undefined;
    return json(recordDrill({ attemptId: Number(b.attemptId), mode: b.mode === "mistakes" || b.mode === "exam" ? b.mode : "review", answer: b.answer, selfGrade }));
  });
