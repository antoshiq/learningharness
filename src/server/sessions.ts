import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { isRunning } from "./agent/run";
import { dueNodes, isHiddenText, planView } from "./agent/state";
import { sessionFeedback } from "./feedback";
import type { StepFeedbackKind } from "./db/schema";
import { semesterBookIds } from "./agent/tools";
import { isText, isToolUse } from "./llm/types";
import type { PlanNodeView, SessionSummary, TranscriptItem, UsageTotals } from "@/lib/types";

export function usageTotals(where: { sessionId?: number; topicId?: number }): UsageTotals {
  const db = getDb();
  let ids: number[] | null = null;
  if (where.topicId !== undefined) {
    ids = db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.topicId, where.topicId))
      .all()
      .map((r) => r.id);
    if (!ids.length) return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cost: 0, costKnown: true };
  }
  const cond =
    where.sessionId !== undefined
      ? eq(schema.usage.sessionId, where.sessionId)
      : ids
        ? inArray(schema.usage.sessionId, ids)
        : undefined;
  const row = db
    .select({
      inputTokens: sql<number>`coalesce(sum(${schema.usage.inputTokens} + ${schema.usage.cacheWriteTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${schema.usage.outputTokens}), 0)`,
      cacheReadTokens: sql<number>`coalesce(sum(${schema.usage.cacheReadTokens}), 0)`,
      cost: sql<number>`coalesce(sum(${schema.usage.cost}), 0)`,
      unknown: sql<number>`coalesce(sum(case when ${schema.usage.cost} is null then 1 else 0 end), 0)`,
    })
    .from(schema.usage)
    .where(cond)
    .get()!;
  return {
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cost: row.cost,
    costKnown: row.unknown === 0,
  };
}

export interface SessionView {
  id: number;
  kind: "lesson" | "practice" | "review";
  goal: string;
  plannedMinutes: number | null;
  startedAt: number;
  endedAt: number | null;
  summary: SessionSummary | null;
  topic: { id: number; title: string; kind: "topic" | "repo" };
  transcript: TranscriptItem[];
  pendingAttemptId: number | null;
  /** True when the last saved message is the learner's and the model has not answered (failed call). */
  needsRetry: boolean;
  running: boolean;
  plan: PlanNodeView[];
  usage: UsageTotals;
  side: { role: "user" | "assistant"; text: string }[];
  parkingOpen: number;
  /** Books of the semester a module topic belongs to: page references in the lesson open them. */
  books: { id: number; name: string; role: string }[];
  /** The learner's marks on steps, by the step's first words. */
  feedback: { excerpt: string; kind: StepFeedbackKind }[];
}

export function getSessionView(id: number): SessionView | null {
  const db = getDb();
  const s = db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();
  if (!s) return null;
  const topic = db.select().from(schema.topics).where(eq(schema.topics.id, s.topicId!)).get();
  if (!topic) return null;

  const attempts = new Map(
    db.select().from(schema.attempts).where(eq(schema.attempts.sessionId, id)).all().map((a) => [a.toolUseId, a]),
  );
  const transcript: TranscriptItem[] = [];
  for (const m of s.messages) {
    if (m.role === "user") {
      const text = m.content
        .filter(isText)
        .map((b) => b.text)
        .filter((t) => !isHiddenText(t))
        .join("\n\n");
      if (text) transcript.push({ type: "user", text });
      continue;
    }
    for (const b of m.content) {
      if (isText(b)) {
        if (b.text.trim()) transcript.push({ type: "assistant", text: b.text });
      } else if (isToolUse(b)) {
        if (b.name === "ask_question") {
          const a = attempts.get(b.id);
          // Questions that failed validation or the pre-show check were never seen.
          if (!a || a.misconceptionType === "invalid_question") continue;
          transcript.push({
            type: "question",
            attemptId: a.id,
            question: a.question,
            answer: a.answer,
            outcome: a.outcome,
            autoGraded: a.autoGraded,
            pending: s.pending?.attemptId === a.id,
          });
        } else if (b.name === "set_plan") transcript.push({ type: "event", text: "План обучения обновлён" });
        else if (b.name === "save_repo_map") transcript.push({ type: "event", text: "Карта проекта составлена" });
      }
    }
  }

  const last = s.messages[s.messages.length - 1];
  return {
    id: s.id,
    kind: s.kind,
    goal: s.goal,
    plannedMinutes: s.plannedMinutes,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    summary: s.summary,
    topic: { id: topic.id, title: topic.title, kind: topic.kind },
    transcript,
    pendingAttemptId: s.pending?.attemptId ?? null,
    needsRetry: !s.endedAt && !s.pending && !!last && last.role === "user" && !isRunning(id),
    running: isRunning(id),
    plan: planView(db, topic.id),
    feedback: sessionFeedback(db, id),
    usage: usageTotals({ sessionId: id }),
    side: db
      .select({ role: schema.sideMessages.role, text: schema.sideMessages.text })
      .from(schema.sideMessages)
      .where(eq(schema.sideMessages.sessionId, id))
      .orderBy(schema.sideMessages.id)
      .all(),
    books: semesterBookIds(db, topic).length
      ? db
          .select({ id: schema.books.id, name: schema.books.name, role: schema.books.role })
          .from(schema.books)
          .where(inArray(schema.books.id, semesterBookIds(db, topic)))
          .all()
      : [],
    parkingOpen: db
      .select({ n: sql<number>`count(*)` })
      .from(schema.parking)
      .where(and(eq(schema.parking.topicId, topic.id), eq(schema.parking.done, false)))
      .get()!.n,
  };
}

export function createSession(input: {
  topicId: number;
  kind: "lesson" | "practice" | "review";
  goal?: string;
  plannedMinutes?: number | null;
}): number {
  const db = getDb();
  const topic = db.select().from(schema.topics).where(eq(schema.topics.id, input.topicId)).get();
  if (!topic) throw new Error("Тема не найдена");
  const plan = planView(db, topic.id);
  if (input.kind === "practice" && !plan.some((n) => n.status !== "new")) {
    throw new Error("Практика доступна после первого пройденного узла");
  }
  if (input.kind === "review" && !dueNodes(db, topic.id).length) throw new Error("Сейчас нечего повторять");
  const row = db
    .insert(schema.sessions)
    .values({
      topicId: topic.id,
      kind: input.kind,
      goal: (input.goal ?? "").trim().slice(0, 500),
      plannedMinutes: input.plannedMinutes ?? null,
      messages: [],
      startedAt: Date.now(),
    })
    .returning({ id: schema.sessions.id })
    .get();
  db.update(schema.topics).set({ updatedAt: Date.now() }).where(eq(schema.topics.id, topic.id)).run();
  return row.id;
}

export interface TopicCard {
  id: number;
  title: string;
  goal: string;
  kind: "topic" | "repo";
  repoPath: string | null;
  total: number;
  mastered: number;
  learning: number;
  due: number;
  openSessionId: number | null;
  updatedAt: number;
}

export function listTopics(): TopicCard[] {
  const db = getDb();
  const now = Date.now();
  return db
    .select()
    .from(schema.topics)
    .orderBy(desc(schema.topics.updatedAt))
    .all()
    .map((t) => {
      const plan = planView(db, t.id);
      const open = db
        .select({ id: schema.sessions.id })
        .from(schema.sessions)
        .where(and(eq(schema.sessions.topicId, t.id), eq(schema.sessions.kind, "lesson"), sql`${schema.sessions.endedAt} is null`))
        .orderBy(desc(schema.sessions.id))
        .get();
      return {
        id: t.id,
        title: t.title,
        goal: t.goal,
        kind: t.kind,
        repoPath: t.repoPath,
        total: plan.length,
        mastered: plan.filter((n) => n.status === "mastered").length,
        learning: plan.filter((n) => n.status === "learning").length,
        due: plan.filter((n) => n.status !== "new" && n.dueAt !== null && n.dueAt <= now).length,
        openSessionId: open?.id ?? null,
        updatedAt: t.updatedAt,
      };
    });
}
