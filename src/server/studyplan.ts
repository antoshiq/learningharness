// Getting ready for a date. The schedule is not stored: it is worked out from
// what is left every time it is shown, so falling behind (or getting ahead)
// re-plans the remaining days by itself.
//
// Days before the exam: ideas still to learn are spread evenly over the
// learning days in plan order; review is daily; a practice exam comes at about
// two thirds of the way and again on the last day, the day before the exam is
// for mistakes and a final review.
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { planView } from "./agent/state";
import { getDb, schema } from "./db";
import { openMistakes, reviewQueue } from "./practice";
import { dayKey, startOfDay } from "./stats";

const DAY = 86_400_000;

export type TaskKind = "start" | "learn" | "review" | "exam" | "mistakes";

export interface PlanTask {
  kind: TaskKind;
  title: string;
  topicId: number | null;
  topicTitle?: string;
  nodeKey?: string;
  /** Where the task is done. */
  href: string;
  /** Today only: whether it is already done. */
  done?: boolean;
}

export interface PlanDay {
  date: string;
  /** Days from today, 0 = today. */
  offset: number;
  tasks: PlanTask[];
}

export interface PlanView {
  id: number;
  title: string;
  examDate: number;
  examDay: string;
  daysLeft: number;
  topics: { id: number; title: string; total: number; mastered: number; hasPlan: boolean }[];
  progress: { mastered: number; total: number };
  /** New ideas to learn per day at the current pace. */
  perDay: number;
  pace: "ok" | "tight" | "behind";
  days: PlanDay[];
  createdAt: number;
}

/** Calendar days between two local midnights (DST-safe). */
const daysBetween = (from: number, to: number) => Math.round((startOfDay(to) - startOfDay(from)) / DAY);

export function computePlan(p: typeof schema.studyPlans.$inferSelect, now = Date.now(), showDays = 14): PlanView {
  const db = getDb();
  const daysLeft = daysBetween(now, p.examDate);
  const topics = p.topicIds.length
    ? db.select().from(schema.topics).where(inArray(schema.topics.id, p.topicIds)).all()
    : [];

  const plans = topics.map((t) => ({ t, plan: planView(db, t.id) }));
  const remaining: PlanTask[] = [];
  const starts: PlanTask[] = [];
  for (const { t, plan } of plans) {
    if (!plan.length) {
      starts.push({ kind: "start", title: `Начать тему: диагностика и план`, topicId: t.id, topicTitle: t.title, href: `/topics/${t.id}?start=lesson` });
      continue;
    }
    // Plan order already respects prerequisites.
    for (const n of plan) {
      if (n.status === "mastered") continue;
      remaining.push({ kind: "learn", title: `${n.status === "learning" ? "Довести" : "Изучить"}: ${n.title}`, topicId: t.id, topicTitle: t.title, nodeKey: n.key, href: `/topics/${t.id}?start=lesson&node=${encodeURIComponent(n.key)}` });
    }
  }
  // Interleave topics so that each day touches several of them.
  const byTopic = new Map<number, PlanTask[]>();
  for (const r of remaining) byTopic.set(r.topicId!, [...(byTopic.get(r.topicId!) ?? []), r]);
  const queues = [...byTopic.values()];
  const learn: PlanTask[] = [];
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) learn.push(q.shift()!);

  const reserve = daysLeft >= 7 ? 2 : daysLeft >= 3 ? 1 : 0;
  const learnDays = Math.max(1, daysLeft - reserve);
  // Starting a topic takes a lesson of its own; count it as one idea.
  const perDay = Math.max(learn.length || starts.length ? 1 : 0, Math.ceil((learn.length + starts.length) / learnDays));
  const pace: PlanView["pace"] = daysLeft <= 0 && learn.length ? "behind" : perDay > 4 ? "behind" : perDay > 2 ? "tight" : "ok";

  const midExam = daysLeft >= 6 ? Math.floor(learnDays * 0.66) : -1;
  const today = startOfDay(now);
  const days: PlanDay[] = [];
  let cursor = 0;
  const queue = [...starts, ...learn];
  for (let d = 0; d < Math.min(Math.max(daysLeft, 1), showDays); d++) {
    const tasks: PlanTask[] = [];
    const isLearn = d < learnDays;
    if (isLearn) {
      for (let k = 0; k < perDay && cursor < queue.length; k++) tasks.push(queue[cursor++]);
    }
    tasks.push({ kind: "review", title: "Повторение на сегодня", topicId: null, href: "/review" });
    const lastDay = d === daysLeft - 1;
    if (d === midExam || (lastDay && daysLeft > 1) || (!isLearn && d === learnDays)) {
      for (const { t, plan } of plans) if (plan.length) tasks.push({ kind: "exam", title: "Пробный экзамен", topicId: t.id, topicTitle: t.title, href: `/exam?topic=${t.id}` });
    }
    if (lastDay || (!isLearn && d === daysLeft - 1)) tasks.push({ kind: "mistakes", title: "Разобрать ошибки", topicId: null, href: "/mistakes" });
    days.push({ date: dayKey(today + d * DAY + DAY / 2), offset: d, tasks });
  }

  // What is already done today.
  if (days[0]) {
    const exams = new Set(
      db
        .select({ t: schema.drills.topicId })
        .from(schema.drills)
        .where(and(eq(schema.drills.mode, "exam"), gte(schema.drills.createdAt, today)))
        .all()
        .map((r) => r.t),
    );
    const reviewLeft = reviewQueue().items.length;
    const learnedToday = new Set(
      db
        .select({ t: schema.drills.topicId, k: schema.drills.nodeKey })
        .from(schema.drills)
        .where(gte(schema.drills.createdAt, today))
        .all()
        .map((r) => `${r.t}:${r.k}`),
    );
    const lessonsToday = db
      .select({ t: schema.sessions.topicId })
      .from(schema.sessions)
      .where(gte(schema.sessions.startedAt, today))
      .orderBy(desc(schema.sessions.id))
      .all()
      .map((s) => s.t);
    for (const task of days[0].tasks) {
      if (task.kind === "review") task.done = reviewLeft === 0;
      else if (task.kind === "exam") task.done = exams.has(task.topicId);
      else if (task.kind === "mistakes") task.done = openMistakes().length === 0;
      else if (task.kind === "start") task.done = lessonsToday.includes(task.topicId);
      else if (task.kind === "learn") {
        const node = plans.find((x) => x.t.id === task.topicId)?.plan.find((n) => n.key === task.nodeKey);
        task.done = node?.status === "mastered" || learnedToday.has(`${task.topicId}:${task.nodeKey}`);
      }
    }
  }

  const all = plans.flatMap((x) => x.plan);
  return {
    id: p.id,
    title: p.title,
    examDate: p.examDate,
    examDay: dayKey(p.examDate),
    daysLeft,
    topics: plans.map(({ t, plan }) => ({ id: t.id, title: t.title, total: plan.length, mastered: plan.filter((n) => n.status === "mastered").length, hasPlan: plan.length > 0 })),
    progress: { mastered: all.filter((n) => n.status === "mastered").length, total: all.length },
    perDay,
    pace,
    days,
    createdAt: p.createdAt,
  };
}

export function listPlans(now = Date.now()) {
  return getDb()
    .select()
    .from(schema.studyPlans)
    .orderBy(schema.studyPlans.examDate)
    .all()
    .map((p) => computePlan(p, now, 1));
}

export function getPlan(id: number, now = Date.now()) {
  const p = getDb().select().from(schema.studyPlans).where(eq(schema.studyPlans.id, id)).get();
  return p ? computePlan(p, now) : null;
}

function check(input: { title?: string; examDate?: string; topicIds?: number[] }) {
  const title = (input.title ?? "").trim().slice(0, 200);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.examDate ?? "");
  if (!m) throw new Error("Укажи дату");
  const examDate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  if (examDate < startOfDay()) throw new Error("Дата уже прошла");
  const topicIds = [...new Set((input.topicIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!topicIds.length) throw new Error("Выбери хотя бы одну тему");
  return { title: title || "Экзамен", examDate, topicIds };
}

export function createPlan(input: { title?: string; examDate?: string; topicIds?: number[] }): number {
  return getDb()
    .insert(schema.studyPlans)
    .values({ ...check(input), createdAt: Date.now() })
    .returning({ id: schema.studyPlans.id })
    .get().id;
}

export function updatePlan(id: number, input: { title?: string; examDate?: string; topicIds?: number[] }) {
  getDb().update(schema.studyPlans).set(check(input)).where(eq(schema.studyPlans.id, id)).run();
}

export function deletePlan(id: number) {
  getDb().delete(schema.studyPlans).where(eq(schema.studyPlans.id, id)).run();
}
