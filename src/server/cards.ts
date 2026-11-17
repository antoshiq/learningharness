// Cards: practice questions made from an overview or a cheat sheet (or for an
// exam), each with its own FSRS schedule. They join the daily review queue.
import { and, asc, eq, lte } from "drizzle-orm";
import type { Outcome } from "@/lib/types";
import { planView } from "./agent/state";
import { briefToTopic, getBrief } from "./brief";
import { getDb, schema } from "./db";
import { chatAs } from "./llm";
import { isText } from "./llm/types";
import { applyRating, ratingFor, schedule } from "./mastery";
import { parseQuestions, QUESTION_FORMAT } from "./questions";

export type CardRow = typeof schema.cards.$inferSelect;

const CARDS_SYSTEM = `Ты делаешь карточки для интервального повторения по материалу, который ученик прочитал. Каждая карточка проверяет одну мысль: понимание, а не дословное запоминание формулировок. Покрой главные тезисы, ловушки и пример. Вопросы короткие, по-русски.

${QUESTION_FORMAT}`;

/**
 * Make `count` cards from an overview or from the topic's cheat sheet. An
 * overview without a topic becomes one first: cards always belong to a topic.
 */
export async function makeCards(from: { briefId: number } | { topicId: number }, count: number): Promise<{ topicId: number; added: number }> {
  const db = getDb();
  let topicId: number;
  let material: string;
  let briefId: number | null = null;
  if ("briefId" in from) {
    const b = getBrief(from.briefId);
    if (!b) throw new Error("Экскурс не найден");
    topicId = briefToTopic(b.id);
    briefId = b.id;
    material = `Экскурс «${b.title}»:\n${b.text}`;
  } else {
    topicId = from.topicId;
    const t = db.select().from(schema.topics).where(eq(schema.topics.id, topicId)).get();
    if (!t) throw new Error("Тема не найдена");
    if (!t.notes) throw new Error("Сначала составь конспект темы");
    material = `Конспект темы «${t.title}»:\n${t.notes}`;
  }
  const plan = planView(db, topicId);
  const keys = new Set(plan.map((n) => n.key));
  const planText = plan.length ? `\n\nИдеи плана (node_key — название): ${plan.map((n) => `${n.key} — ${n.title}`).join("; ")}` : "";

  const r = await chatAs("strong", "cards", null, {
    system: CARDS_SYSTEM,
    messages: [{ role: "user", content: [{ type: "text", text: `${material.slice(0, 40_000)}${planText}\n\nСделай ${count} карточек.` }] }],
    maxTokens: 8000,
  });
  const questions = parseQuestions(r.content.filter(isText).map((b) => b.text).join(""), "review", keys).slice(0, count);
  if (!questions.length) throw new Error("Модель не вернула ни одной подходящей карточки. Попробуй ещё раз.");
  const now = Date.now();
  db.insert(schema.cards)
    .values(questions.map((q) => ({ topicId, briefId, nodeKey: q.node_key ?? null, origin: "brief" in from ? ("brief" as const) : ("notes" as const), question: q, dueAt: now, createdAt: now })))
    .run();
  if ("briefId" in from) db.update(schema.topics).set({ updatedAt: now }).where(eq(schema.topics.id, topicId)).run();
  return { topicId, added: questions.length };
}

export function topicCards(topicId: number): CardRow[] {
  return getDb().select().from(schema.cards).where(eq(schema.cards.topicId, topicId)).orderBy(asc(schema.cards.dueAt)).all();
}

export function dueCards(topicId?: number, now = Date.now()): CardRow[] {
  return getDb()
    .select()
    .from(schema.cards)
    .where(and(lte(schema.cards.dueAt, now), topicId ? eq(schema.cards.topicId, topicId) : undefined))
    .orderBy(asc(schema.cards.dueAt))
    .all();
}

export function deleteCard(id: number) {
  getDb().delete(schema.cards).where(eq(schema.cards.id, id)).run();
}

/** Move a card's own schedule, and its plan idea's if it has one. */
export function rateCard(card: CardRow, outcome: Outcome, hintsUsed: number, confidence: number | null, now = new Date()) {
  const db = getDb();
  const rating = ratingFor(outcome, hintsUsed, confidence);
  if (rating === null) return;
  const next = schedule(card.card ?? null, rating, now);
  db.update(schema.cards)
    .set({ card: next.card, dueAt: next.dueAt, lastOutcome: outcome === "skipped" ? card.lastOutcome : outcome, reps: card.reps + 1 })
    .where(eq(schema.cards.id, card.id))
    .run();
  if (card.nodeKey) {
    const node = db
      .select()
      .from(schema.nodes)
      .where(and(eq(schema.nodes.topicId, card.topicId), eq(schema.nodes.key, card.nodeKey)))
      .get();
    if (node) applyRating(db, node, outcome, hintsUsed, confidence, now);
  }
}
