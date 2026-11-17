import { and, eq } from "drizzle-orm";
import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from "ts-fsrs";
import type { Db } from "./db";
import { schema } from "./db";
import type { FsrsCardJson, NodeStatus, Outcome } from "@/lib/types";

const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

function revive(json: FsrsCardJson): Card {
  return {
    ...json,
    due: new Date(json.due),
    last_review: json.last_review ? new Date(json.last_review) : undefined,
  } as Card;
}

/**
 * Map an answer to an FSRS grade. Hints and low confidence make a correct
 * answer count for less; a clean, confident answer counts for more.
 */
export function ratingFor(outcome: Outcome, hintsUsed: number, confidence: number | null): Grade | null {
  if (outcome === "skipped") return null;
  if (outcome === "wrong") return Rating.Again;
  if (outcome === "partial") return Rating.Hard;
  if (hintsUsed > 0 || confidence === 1) return Rating.Hard;
  if (confidence === 3) return Rating.Easy;
  return Rating.Good;
}

export function schedule(card: FsrsCardJson | null, rating: Grade, now: Date): { card: FsrsCardJson; dueAt: number } {
  const current = card ? revive(card) : createEmptyCard(now);
  const next = scheduler.next(current, now, rating).card;
  return { card: JSON.parse(JSON.stringify(next)) as FsrsCardJson, dueAt: next.due.getTime() };
}

export function nextStatus(prev: NodeStatus, outcome: Outcome): NodeStatus {
  if (outcome === "correct") return "mastered";
  if (outcome === "wrong") return "learning";
  if (outcome === "partial") return prev === "new" ? "learning" : prev;
  return prev;
}

/**
 * Apply a graded attempt to its plan node exactly once. Returns a short status
 * line for the model, or null if nothing changed.
 */
export function applyAttempt(db: Db, attemptId: number, now = new Date()): string | null {
  const a = db.select().from(schema.attempts).where(eq(schema.attempts.id, attemptId)).get();
  if (!a || a.masteryApplied || !a.outcome || a.outcome === "skipped") return null;
  db.update(schema.attempts).set({ masteryApplied: true }).where(eq(schema.attempts.id, attemptId)).run();
  // A prediction made before the explanation says nothing about mastery.
  if (a.purpose === "predict" || !a.nodeKey || a.topicId == null) return null;

  const node = db
    .select()
    .from(schema.nodes)
    .where(and(eq(schema.nodes.topicId, a.topicId), eq(schema.nodes.key, a.nodeKey)))
    .get();
  if (!node) return null;

  if (a.purpose === "probe") {
    // Diagnostics only promote: a confident correct answer marks the node as known.
    if (a.outcome !== "correct" || a.confidence === 1 || node.status === "mastered") return null;
  }
  return applyRating(db, node, a.outcome, a.hintsUsed, a.confidence, now);
}

type NodeRow = typeof schema.nodes.$inferSelect;

/** Move a node's FSRS card and status by one graded answer. */
export function applyRating(db: Db, node: NodeRow, outcome: Outcome, hintsUsed: number, confidence: number | null, now = new Date()): string | null {
  const rating = ratingFor(outcome, hintsUsed, confidence);
  if (rating === null) return null;
  const { card, dueAt } = schedule(node.card ?? null, rating, now);
  const status = nextStatus(node.status, outcome);
  db.update(schema.nodes)
    .set({
      card,
      dueAt,
      status,
      correctCount: node.correctCount + (outcome === "correct" ? 1 : 0),
      wrongCount: node.wrongCount + (outcome === "wrong" ? 1 : 0),
    })
    .where(eq(schema.nodes.id, node.id))
    .run();
  const label = status === "mastered" ? "освоен" : status === "learning" ? "в процессе" : "новый";
  return `узел ${node.key}: ${label}`;
}

/** Mark a node as already known from diagnostics (initial review scheduled). */
export function initialKnownCard(now = new Date()) {
  return schedule(null, Rating.Good, now);
}
