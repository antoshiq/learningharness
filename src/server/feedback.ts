// The learner's marks on lesson steps: "unclear", "too long", "a mistake in
// the explanation". The tutor gets them with the learner's next action, and
// they stay as a log of where the prompts teach badly.
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./db";
import { schema } from "./db";
import { STATE_PREFIX } from "./agent/state";
import { excerptOf, FEEDBACK_KINDS, FEEDBACK_LABEL, type StepFeedbackKind } from "@/lib/feedback";

export function addFeedback(db: Db, sessionId: number, kind: StepFeedbackKind, text: string, comment?: string) {
  if (!FEEDBACK_KINDS.includes(kind)) throw new Error("Неизвестный отзыв");
  const session = db.select({ topicId: schema.sessions.topicId }).from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
  if (!session) throw new Error("Сессия не найдена");
  const excerpt = excerptOf(text);
  if (!excerpt) throw new Error("Пустой шаг");
  // Pressing the same mark again takes it back.
  const same = db
    .select({ id: schema.stepFeedback.id, delivered: schema.stepFeedback.delivered })
    .from(schema.stepFeedback)
    .where(and(eq(schema.stepFeedback.sessionId, sessionId), eq(schema.stepFeedback.kind, kind), eq(schema.stepFeedback.excerpt, excerpt)))
    .get();
  if (same && !same.delivered) {
    db.delete(schema.stepFeedback).where(eq(schema.stepFeedback.id, same.id)).run();
    return;
  }
  if (same) return;
  db.insert(schema.stepFeedback)
    .values({ sessionId, topicId: session.topicId, kind, excerpt, comment: comment?.trim().slice(0, 1000) || null, createdAt: Date.now() })
    .run();
}

/** Marks of a session (to show them on the steps). */
export function sessionFeedback(db: Db, sessionId: number): { excerpt: string; kind: StepFeedbackKind }[] {
  return db
    .select({ excerpt: schema.stepFeedback.excerpt, kind: schema.stepFeedback.kind })
    .from(schema.stepFeedback)
    .where(eq(schema.stepFeedback.sessionId, sessionId))
    .all();
}

const ADVICE: Record<StepFeedbackKind, string> = {
  unclear: "объясни это место иначе — проще, с другим примером или по шагам — прежде чем идти дальше",
  too_long: "дальше объясняй короче и плотнее",
  wrong: "перепроверь это место; если там ошибка, прямо скажи ученику, в чём она, и дай верное объяснение",
};

/** Marks not yet passed to the tutor, as a hidden text block; marks them delivered. */
export function takeFeedback(db: Db, sessionId: number): string | null {
  const rows = db
    .select()
    .from(schema.stepFeedback)
    .where(and(eq(schema.stepFeedback.sessionId, sessionId), eq(schema.stepFeedback.delivered, false)))
    .all();
  if (!rows.length) return null;
  db.update(schema.stepFeedback).set({ delivered: true }).where(and(eq(schema.stepFeedback.sessionId, sessionId), eq(schema.stepFeedback.delivered, false))).run();
  const lines = rows.map((r) => `- «${r.excerpt}…» — ${FEEDBACK_LABEL[r.kind]}${r.comment ? ` (ученик пишет: ${r.comment})` : ""}: ${ADVICE[r.kind]}.`);
  return `${STATE_PREFIX} Ученик отметил прошлые шаги. Учти это сразу:\n${lines.join("\n")}`;
}

export interface FeedbackLogItem {
  id: number;
  kind: StepFeedbackKind;
  excerpt: string;
  comment: string | null;
  sessionId: number;
  topicId: number | null;
  topicTitle: string | null;
  createdAt: number;
}

/** The log for the stats page, newest first. */
export function feedbackLog(db: Db, limit = 50): { counts: Record<StepFeedbackKind, number>; items: FeedbackLogItem[] } {
  const items = db
    .select({
      id: schema.stepFeedback.id,
      kind: schema.stepFeedback.kind,
      excerpt: schema.stepFeedback.excerpt,
      comment: schema.stepFeedback.comment,
      sessionId: schema.stepFeedback.sessionId,
      topicId: schema.stepFeedback.topicId,
      topicTitle: schema.topics.title,
      createdAt: schema.stepFeedback.createdAt,
    })
    .from(schema.stepFeedback)
    .leftJoin(schema.topics, eq(schema.topics.id, schema.stepFeedback.topicId))
    .orderBy(desc(schema.stepFeedback.id))
    .all();
  const counts = { unclear: 0, too_long: 0, wrong: 0 };
  for (const i of items) counts[i.kind]++;
  return { counts, items: items.slice(0, limit) };
}
