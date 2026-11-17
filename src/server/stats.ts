// Activity and spending across all topics: the activity calendar, streaks,
// accuracy, calibration and money spent per day.
import { and, gte, isNotNull, sql } from "drizzle-orm";
import type { DayActivity, DayCost, Stats } from "@/lib/types";
import { getDb, schema } from "./db";
import { planView } from "./agent/state";

const DAY = 86_400_000;
/** Sessions left open overnight should not count as ten hours of study. */
const SESSION_CAP_MIN = 120;

/** Local calendar date "YYYY-MM-DD" (the server runs on the learner's computer). */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Midnight of the local day that contains `ms`. */
export function startOfDay(ms = Date.now()): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Dollars spent on model calls since a moment; unknown prices count as zero. */
export function spentSince(ms: number): number {
  return getDb()
    .select({ c: sql<number>`coalesce(sum(${schema.usage.cost}), 0)` })
    .from(schema.usage)
    .where(gte(schema.usage.createdAt, ms))
    .get()!.c;
}

/** Current and longest run of consecutive active days. Today may still be empty without breaking the run. */
export function streaks(active: Set<string>, now = Date.now()): { current: number; longest: number } {
  let current = 0;
  let cursor = startOfDay(now);
  if (!active.has(dayKey(cursor))) cursor -= DAY;
  while (active.has(dayKey(cursor))) {
    current++;
    cursor = startOfDay(cursor - DAY / 2);
  }
  const sorted = [...active].sort();
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const k of sorted) {
    const [y, m, d] = k.split("-").map(Number);
    const t = new Date(y, m - 1, d).getTime();
    // DST days are 23 or 25 hours long, so compare with some slack.
    run = prev !== null && Math.abs(t - prev - DAY) < DAY / 4 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = t;
  }
  return { current, longest: Math.max(longest, current) };
}

export function getStats(limit: number | null, now = Date.now(), goalTarget = 10): Stats {
  const db = getDb();
  const from = startOfDay(now) - 371 * DAY;

  const attempts = db
    .select({
      topicId: schema.attempts.topicId,
      outcome: schema.attempts.outcome,
      confidence: schema.attempts.confidence,
      purpose: schema.attempts.purpose,
      misconceptionType: schema.attempts.misconceptionType,
      at: schema.attempts.answeredAt,
    })
    .from(schema.attempts)
    .where(and(isNotNull(schema.attempts.outcome), isNotNull(schema.attempts.answeredAt)))
    .all()
    .filter((a) => a.outcome !== "skipped" && a.misconceptionType !== "invalid_question");
  const drills = db
    .select({ topicId: schema.drills.topicId, outcome: schema.drills.outcome, confidence: schema.drills.confidence, at: schema.drills.createdAt })
    .from(schema.drills)
    .all();

  const days = new Map<string, DayActivity>();
  const bump = (at: number, correct: boolean, drill: boolean) => {
    if (at < from) return;
    const k = dayKey(at);
    const d = days.get(k) ?? { date: k, answers: 0, correct: 0, drills: 0 };
    d.answers++;
    if (correct) d.correct++;
    if (drill) d.drills++;
    days.set(k, d);
  };
  for (const a of attempts) bump(a.at!, a.outcome === "correct", false);
  for (const d of drills) bump(d.at, d.outcome === "correct", true);

  const sessions = db
    .select({ startedAt: schema.sessions.startedAt, endedAt: schema.sessions.endedAt })
    .from(schema.sessions)
    .all();
  const minutes = sessions.reduce((s, x) => s + Math.min(SESSION_CAP_MIN, Math.max(0, Math.round(((x.endedAt ?? x.startedAt) - x.startedAt) / 60_000))), 0);

  // Activity days over all time, so a long streak is not cut at one year.
  const active = new Set<string>([...attempts.map((a) => dayKey(a.at!)), ...drills.map((d) => dayKey(d.at))]);

  const topics = db
    .select({ id: schema.topics.id, title: schema.topics.title })
    .from(schema.topics)
    .all()
    .map((t) => {
      const mine = [...attempts.filter((a) => a.topicId === t.id), ...drills.filter((d) => d.topicId === t.id)];
      const plan = planView(db, t.id);
      return {
        id: t.id,
        title: t.title,
        answers: mine.length,
        correct: mine.filter((a) => a.outcome === "correct").length,
        mastered: plan.filter((n) => n.status === "mastered").length,
        total: plan.length,
      };
    })
    .sort((a, b) => b.answers - a.answers);

  const graded = [...attempts.filter((a) => a.purpose !== "predict"), ...drills];
  const calibration = [1, 2, 3].map((level) => {
    const at = graded.filter((a) => a.confidence === level);
    return { level, total: at.length, correct: at.filter((a) => a.outcome === "correct").length };
  });

  // Spending per day for the last 30 days.
  const costFrom = startOfDay(now) - 29 * DAY;
  const costDays = new Map<string, DayCost>();
  for (let t = costFrom; t <= now; t = startOfDay(t + DAY * 1.5)) {
    costDays.set(dayKey(t), { date: dayKey(t), cost: 0, tokens: 0, unknown: false });
  }
  const usage = db.select().from(schema.usage).all();
  let all = 0;
  let known = true;
  for (const u of usage) {
    all += u.cost ?? 0;
    if (u.cost === null) known = false;
    if (u.createdAt < costFrom) continue;
    const d = costDays.get(dayKey(u.createdAt));
    if (!d) continue;
    d.cost += u.cost ?? 0;
    d.tokens += u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;
    if (u.cost === null) d.unknown = true;
  }
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const todayDone = days.get(dayKey(now))?.answers ?? 0;
  const metDays = [...days.values()].filter((d) => d.answers >= goalTarget && d.date >= dayKey(now - 29 * DAY)).length;

  return {
    today: dayKey(now),
    goal: { target: goalTarget, today: todayDone, metDays },
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    streak: { ...streaks(active, now), activeDays: active.size },
    totals: {
      answers: attempts.length + drills.length,
      correct: attempts.filter((a) => a.outcome === "correct").length + drills.filter((d) => d.outcome === "correct").length,
      drills: drills.length,
      minutes,
      sessions: sessions.length,
    },
    topics,
    calibration,
    cost: {
      days: [...costDays.values()],
      today: spentSince(startOfDay(now)),
      month: spentSince(monthStart.getTime()),
      all,
      known,
      limit,
    },
  };
}
