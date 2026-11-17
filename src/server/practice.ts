// Practice without the tutor: stored questions asked again. The daily review
// queue takes one question per due idea across all topics plus the cards that
// are due; mistake practice re-asks what was last answered wrong.
//
// A DrillItem's attemptId is the lesson attempt's id, or minus the card id for
// a card: one number identifies the question on both sides of the wire.
import { and, desc, eq, inArray, isNotNull, lte, ne } from "drizzle-orm";
import { gradeAuto } from "@/lib/grading";
import { SELF_GRADED, type AnswerPayload, type DrillItem, type Outcome, type Question, type SelfGrade, type TutorReview } from "@/lib/types";
import { dueCards, rateCard, type CardRow } from "./cards";
import { getDb, schema } from "./db";
import { applyRating } from "./mastery";

type AttemptRow = typeof schema.attempts.$inferSelect;
export type DrillMode = "review" | "mistakes" | "exam";

const DAY = 86_400_000;
const REVIEW_LIMIT = 40;
const MISTAKES_LIMIT = 60;

/** A question is reusable when it was really shown and answered, and it can be checked again. */
export function reusable(a: AttemptRow): boolean {
  if (a.misconceptionType === "invalid_question" || !a.answer) return false;
  return checkable(a.question);
}

function checkable(q: Question): boolean {
  if (q.kind === "choice") return Array.isArray(q.options) && typeof q.correct_option === "number";
  if (q.kind === "code" || q.kind === "find_bug") return !!q.tests && !!q.solution && !!q.language;
  if (q.kind === "predict_output") return !!q.code && !!q.language;
  if (q.kind === "parsons") return !!q.solution;
  return SELF_GRADED.includes(q.kind) && !!(q.reference_answer || q.explanation);
}

export function attemptItem(a: AttemptRow, topicTitle: string, nodeTitle: string | null): DrillItem {
  return {
    attemptId: a.id,
    question: a.question,
    topic: { id: a.topicId!, title: topicTitle },
    node: a.nodeKey ? { key: a.nodeKey, title: nodeTitle ?? a.nodeKey } : null,
    last: { outcome: a.outcome, answer: a.answer, misconception: a.misconception, at: a.answeredAt ?? a.createdAt },
  };
}

export function cardItem(c: CardRow, topicTitle: string, nodeTitle: string | null): DrillItem {
  return {
    attemptId: -c.id,
    cardId: c.id,
    question: c.question,
    topic: { id: c.topicId, title: topicTitle },
    node: c.nodeKey ? { key: c.nodeKey, title: nodeTitle ?? c.nodeKey } : null,
    last: { outcome: c.lastOutcome, answer: null, misconception: null, at: c.createdAt },
  };
}

/** Last time each source question was drilled, and whether that try was right. */
function lastDrills(ids: number[]) {
  const out = new Map<number, { at: number; outcome: Outcome }>();
  if (!ids.length) return out;
  const rows = getDb()
    .select({ src: schema.drills.sourceAttemptId, at: schema.drills.createdAt, outcome: schema.drills.outcome })
    .from(schema.drills)
    .where(inArray(schema.drills.sourceAttemptId, ids))
    .all();
  for (const r of rows) {
    const prev = out.get(r.src);
    if (!prev || r.at >= prev.at) out.set(r.src, { at: r.at, outcome: r.outcome });
  }
  return out;
}

export function topicTitles(ids: number[]) {
  if (!ids.length) return new Map<number, string>();
  return new Map(
    getDb()
      .select({ id: schema.topics.id, title: schema.topics.title })
      .from(schema.topics)
      .where(inArray(schema.topics.id, ids))
      .all()
      .map((t) => [t.id, t.title]),
  );
}

export function nodeTitles(topicIds: number[]) {
  if (!topicIds.length) return new Map<string, string>();
  return new Map(
    getDb()
      .select({ topicId: schema.nodes.topicId, key: schema.nodes.key, title: schema.nodes.title })
      .from(schema.nodes)
      .where(inArray(schema.nodes.topicId, topicIds))
      .all()
      .map((n) => [`${n.topicId}:${n.key}`, n.title]),
  );
}

/** Ideas due for review across all topics (or one), each with a stored question, then the due cards. */
export function reviewQueue(topicId?: number, now = Date.now()): { items: DrillItem[]; tutorOnly: TutorReview[] } {
  const db = getDb();
  const due = db
    .select()
    .from(schema.nodes)
    .where(
      and(
        ne(schema.nodes.status, "new"),
        isNotNull(schema.nodes.dueAt),
        lte(schema.nodes.dueAt, now),
        topicId ? eq(schema.nodes.topicId, topicId) : undefined,
      ),
    )
    .all()
    .sort((a, b) => a.dueAt! - b.dueAt!);
  const cards = dueCards(topicId, now);

  const topicIds = [...new Set([...due.map((n) => n.topicId), ...cards.map((c) => c.topicId)])];
  const titles = topicTitles(topicIds);
  const nodeNames = nodeTitles(topicIds);
  const attempts = due.length
    ? db
        .select()
        .from(schema.attempts)
        .where(and(inArray(schema.attempts.topicId, topicIds), isNotNull(schema.attempts.nodeKey), isNotNull(schema.attempts.outcome)))
        .orderBy(desc(schema.attempts.id))
        .all()
        .filter(reusable)
    : [];
  const drilled = lastDrills(attempts.map((a) => a.id));

  const items: DrillItem[] = [];
  const tutorOnly = new Map<number, TutorReview>();
  // Ideas with a card due are covered by the card.
  const carded = new Set(cards.filter((c) => c.nodeKey).map((c) => `${c.topicId}:${c.nodeKey}`));
  for (const n of due) {
    if (!titles.has(n.topicId) || carded.has(`${n.topicId}:${n.key}`)) continue;
    const candidates = attempts.filter((a) => a.topicId === n.topicId && a.nodeKey === n.key);
    if (!candidates.length) {
      const t = tutorOnly.get(n.topicId) ?? { topicId: n.topicId, title: titles.get(n.topicId)!, nodes: 0 };
      t.nodes++;
      tutorOnly.set(n.topicId, t);
      continue;
    }
    if (items.length >= REVIEW_LIMIT) continue;
    // The question not seen for the longest time; among equals, one that was answered wrong.
    const pick = [...candidates].sort((a, b) => {
      const ta = drilled.get(a.id)?.at ?? 0;
      const tb = drilled.get(b.id)?.at ?? 0;
      if (ta !== tb) return ta - tb;
      return Number(b.outcome !== "correct") - Number(a.outcome !== "correct");
    })[0];
    items.push({ ...attemptItem(pick, titles.get(n.topicId)!, n.title), overdueDays: Math.max(0, Math.floor((now - n.dueAt!) / DAY)) });
  }
  for (const c of cards) {
    if (items.length >= REVIEW_LIMIT) break;
    if (!titles.has(c.topicId)) continue;
    items.push({ ...cardItem(c, titles.get(c.topicId)!, nodeNames.get(`${c.topicId}:${c.nodeKey}`) ?? null), overdueDays: Math.max(0, Math.floor((now - c.dueAt) / DAY)) });
  }
  return { items, tutorOnly: [...tutorOnly.values()] };
}

/**
 * Questions whose latest answer was wrong or partly right: lesson attempts
 * (including ones answered right in the lesson but wrong in review or an exam)
 * and cards.
 */
export function openMistakes(topicId?: number): DrillItem[] {
  const db = getDb();
  const latest = new Map<number, Outcome>();
  for (const d of db
    .select({ src: schema.drills.sourceAttemptId, outcome: schema.drills.outcome, at: schema.drills.createdAt })
    .from(schema.drills)
    .where(and(ne(schema.drills.sourceAttemptId, 0), topicId ? eq(schema.drills.topicId, topicId) : undefined))
    .orderBy(schema.drills.createdAt)
    .all()) {
    latest.set(d.src, d.outcome);
  }
  const rows = db
    .select()
    .from(schema.attempts)
    .where(topicId ? eq(schema.attempts.topicId, topicId) : isNotNull(schema.attempts.topicId))
    .orderBy(desc(schema.attempts.id))
    .all()
    .filter((a) => {
      if (a.misconceptionType === "invalid_question" || !a.answer) return false;
      // The latest try decides: a later correct answer closes it, a later wrong one reopens it.
      const last = latest.get(a.id);
      if (last) return last !== "correct";
      return a.outcome === "wrong" || a.outcome === "partial";
    });

  // The same question can come back in a later lesson; keep its newest attempt only.
  const seen = new Set<string>();
  const unique = rows.filter((a) => {
    const k = `${a.topicId}:${a.question.prompt}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const cards = db
    .select()
    .from(schema.cards)
    .where(and(inArray(schema.cards.lastOutcome, ["wrong", "partial"]), topicId ? eq(schema.cards.topicId, topicId) : undefined))
    .all();

  const topicIds = [...new Set([...unique.map((a) => a.topicId!), ...cards.map((c) => c.topicId)])];
  if (!topicIds.length) return [];
  const titles = topicTitles(topicIds);
  const nodeNames = nodeTitles(topicIds);
  const items = [
    ...unique.filter((a) => titles.has(a.topicId!)).map((a) => attemptItem(a, titles.get(a.topicId!)!, nodeNames.get(`${a.topicId}:${a.nodeKey}`) ?? null)),
    ...cards.filter((c) => titles.has(c.topicId)).map((c) => cardItem(c, titles.get(c.topicId)!, nodeNames.get(`${c.topicId}:${c.nodeKey}`) ?? null)),
  ];
  return items.slice(0, MISTAKES_LIMIT);
}

/**
 * Grade one practice answer and move the review schedule (the idea's, and the
 * card's own). Checkable kinds are graded here from what the browser ran;
 * free text uses the learner's own grade.
 */
export function recordDrill(input: { attemptId: number; mode: DrillMode; answer: AnswerPayload; selfGrade?: SelfGrade }, now = new Date()) {
  const db = getDb();
  const isCard = input.attemptId < 0;
  const card = isCard ? db.select().from(schema.cards).where(eq(schema.cards.id, -input.attemptId)).get() : undefined;
  const a = isCard ? undefined : db.select().from(schema.attempts).where(eq(schema.attempts.id, input.attemptId)).get();
  const q = card?.question ?? a?.question;
  if (!q) throw new Error("Вопрос не найден");
  const topicId = card?.topicId ?? a?.topicId ?? null;
  const nodeKey = card?.nodeKey ?? a?.nodeKey ?? null;

  const selfGraded = SELF_GRADED.includes(q.kind);
  const outcome = selfGraded ? (input.selfGrade ?? null) : gradeAuto(q, input.answer);
  if (!outcome || outcome === "skipped") throw new Error(selfGraded ? "Оцени свой ответ: сравни его с эталоном" : "Ответ не удалось проверить");

  const confidence = input.answer.confidence ?? null;
  const hintsUsed = Math.max(0, Math.min(20, Number(input.answer.hintsUsed) || 0));
  db.insert(schema.drills)
    .values({
      sourceAttemptId: a?.id ?? 0,
      cardId: card?.id ?? null,
      topicId,
      nodeKey,
      mode: input.mode,
      outcome,
      selfGraded,
      confidence,
      hintsUsed,
      createdAt: now.getTime(),
    })
    .run();

  if (card) rateCard(card, outcome, hintsUsed, confidence, now);
  else if (topicId != null && nodeKey) {
    const node = db
      .select()
      .from(schema.nodes)
      .where(and(eq(schema.nodes.topicId, topicId), eq(schema.nodes.key, nodeKey)))
      .get();
    if (node) applyRating(db, node, outcome, hintsUsed, confidence, now);
  }
  let status: string | null = null;
  if (topicId != null) {
    if (nodeKey) status = db.select({ s: schema.nodes.status }).from(schema.nodes).where(and(eq(schema.nodes.topicId, topicId), eq(schema.nodes.key, nodeKey))).get()?.s ?? null;
    db.update(schema.topics).set({ updatedAt: now.getTime() }).where(eq(schema.topics.id, topicId)).run();
  }
  return { outcome, status, selfGraded };
}
