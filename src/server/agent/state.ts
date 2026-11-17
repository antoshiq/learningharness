import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import type { Db } from "../db";
import { schema } from "../db";
import { isAvailable } from "@/lib/plan";
import type { NodeStatus, PlanNodeView } from "@/lib/types";
import { getScan, renderTree } from "../repo/scan";
import { materialsText } from "../materials";

/** Text blocks with these prefixes are context for the model and are hidden from the learner. */
export const STATE_PREFIX = "[состояние]";
export const SYSTEM_PREFIX = "[система]";
export const isHiddenText = (t: string) => t.startsWith(STATE_PREFIX) || t.startsWith(SYSTEM_PREFIX);

export function planView(db: Db, topicId: number): PlanNodeView[] {
  const rows = db.select().from(schema.nodes).where(eq(schema.nodes.topicId, topicId)).orderBy(schema.nodes.orderIdx).all();
  const status = new Map<string, NodeStatus>(rows.map((n) => [n.key, n.status]));
  return rows.map((n) => ({
    key: n.key,
    title: n.title,
    summary: n.summary,
    deps: n.deps,
    status: n.status,
    available: isAvailable(n, status),
    dueAt: n.dueAt,
    correctCount: n.correctCount,
    wrongCount: n.wrongCount,
  }));
}

export function dueNodes(db: Db, topicId: number, now = Date.now()): PlanNodeView[] {
  return planView(db, topicId).filter((n) => n.status !== "new" && n.dueAt !== null && n.dueAt <= now);
}

const MARK: Record<NodeStatus, string> = { mastered: "✓", learning: "◐", new: "○" };

export function planStateText(db: Db, topicId: number): string {
  const plan = planView(db, topicId);
  if (!plan.length) return "Плана ещё нет.";
  const lines = plan.map(
    (n) =>
      `${MARK[n.status]}${n.status !== "mastered" && !n.available ? "🔒" : ""} ${n.key} — ${n.title}` +
      (n.deps.length ? ` (после: ${n.deps.join(", ")})` : ""),
  );
  const next = plan.filter((n) => n.status !== "mastered" && n.available).map((n) => n.key);
  return [
    "План (✓ освоен, ◐ в процессе, ○ новый, 🔒 предпосылки не освоены):",
    ...lines,
    next.length ? `Доступны сейчас: ${next.join(", ")}` : "Все узлы освоены.",
  ].join("\n");
}

const KIND_RU = { lesson: "урок", practice: "практика", review: "повторение" } as const;

/** Full context for the first message of a session. */
export function initialState(db: Db, sessionId: number): string {
  const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get()!;
  const topic = db.select().from(schema.topics).where(eq(schema.topics.id, session.topicId!)).get()!;
  const plan = planView(db, topic.id);
  const out: string[] = [STATE_PREFIX];

  out.push(`Тема: ${topic.title}`);
  if (topic.goal) out.push(`Цель ученика: ${topic.goal}`);
  out.push(
    `Тип сессии: ${KIND_RU[session.kind]}` + (session.plannedMinutes ? `, запланировано ${session.plannedMinutes} минут` : ""),
  );
  if (session.goal) out.push(`Цель на эту сессию: ${session.goal}`);

  if (session.kind === "lesson") {
    const phase =
      topic.kind === "repo" && !topic.repoMap ? "анализ репозитория" : plan.length ? "обучение" : "диагностика";
    out.push(`Фаза: ${phase}`);
  }
  out.push("", planStateText(db, topic.id));

  if (session.kind === "review") {
    const due = dueNodes(db, topic.id);
    out.push("", `К повторению сейчас: ${due.length ? due.map((n) => `${n.key} (${n.title})`).join("; ") : "ничего"}`);
  }

  const mistakes = db
    .select()
    .from(schema.attempts)
    .where(and(eq(schema.attempts.topicId, topic.id), isNotNull(schema.attempts.misconception)))
    .orderBy(desc(schema.attempts.id))
    .limit(8)
    .all();
  if (mistakes.length) {
    out.push("", "Последние ошибки ученика:");
    for (const m of mistakes) out.push(`- [${m.nodeKey ?? "диагностика"}] ${m.misconceptionType ?? "другое"}: ${m.misconception}`);
  }

  const past = db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.topicId, topic.id), ne(schema.sessions.id, sessionId), isNotNull(schema.sessions.summary)))
    .orderBy(desc(schema.sessions.id))
    .limit(2)
    .all();
  if (past.length) {
    out.push("", "Итоги прошлых сессий (от новых к старым):");
    for (const s of past) {
      const sm = s.summary!;
      out.push(`- освоено: ${sm.learned.join("; ") || "—"}. Слабо: ${sm.weak.join("; ") || "—"}. Дальше: ${sm.next}`);
    }
  }

  const parked = db
    .select()
    .from(schema.parking)
    .where(and(eq(schema.parking.topicId, topic.id), eq(schema.parking.done, false)))
    .limit(10)
    .all();
  if (parked.length) {
    out.push("", "Вопросы, которые ученик отложил «на парковку» (можно ответить, когда уместно):");
    for (const p of parked) out.push(`- ${p.text}`);
  }

  const materials = materialsText(topic.id);
  if (materials) {
    out.push(
      "",
      "Материалы, которые приложил ученик. Учи по ним: план, объяснения и вопросы строй на их содержании и терминах, ссылайся на них; чего в них нет, добавляй, только если это нужно для понимания:",
      materials,
    );
  }

  if (topic.brief && topic.brief !== topic.repoMap) {
    out.push("", "Ученик уже прочитал краткий экскурс по теме. Опирайся на него, но знания всё равно проверь диагностикой:", topic.brief.slice(0, 8000));
  }

  if (topic.kind === "repo" && topic.repoPath) {
    if (topic.repoMap) out.push("", "Карта проекта:", topic.repoMap);
    try {
      const { scan } = getScan(topic.repoPath);
      out.push("", `Файлы репозитория (${scan.files.length} доступно для чтения):`, renderTree(scan));
    } catch (e) {
      out.push("", `Репозиторий недоступен: ${e instanceof Error ? e.message : e}`);
    }
  }
  return out.join("\n");
}
