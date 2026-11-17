// Exam over a whole topic: questions spread across the plan's ideas, no hints
// and no tutor while it runs; results per idea at the end. Stored questions
// come first; when there are too few, the model writes the rest as cards.
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { DrillItem } from "@/lib/types";
import { planView } from "./agent/state";
import { getDb, schema } from "./db";
import { chatAs } from "./llm";
import { isText } from "./llm/types";
import { attemptItem, cardItem, reusable } from "./practice";
import { materialsText } from "./materials";
import { parseQuestions, QUESTION_FORMAT } from "./questions";

const EXAM_SYSTEM = `Ты составляешь экзамен по теме, которую ученик изучает. Вопросы должны проверять понимание и умение применить, а не память на формулировки; от простого к сложному. Распредели вопросы по идеям плана, указывая node_key у каждого. По-русски.

${QUESTION_FORMAT}`;

function shuffle<T>(a: T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function buildExam(topicId: number, count: number, generate: boolean): Promise<{ items: DrillItem[]; generated: number }> {
  const db = getDb();
  const topic = db.select().from(schema.topics).where(eq(schema.topics.id, topicId)).get();
  if (!topic) throw new Error("Тема не найдена");
  const plan = planView(db, topicId);
  const titles = new Map(plan.map((n) => [n.key, n.title]));

  // Stored questions per idea, most recent first; cards too.
  const pool = new Map<string, DrillItem[]>();
  const add = (key: string, item: DrillItem) => pool.set(key, [...(pool.get(key) ?? []), item]);
  const seenPrompts = new Set<string>();
  for (const a of db
    .select()
    .from(schema.attempts)
    .where(and(eq(schema.attempts.topicId, topicId), isNotNull(schema.attempts.outcome)))
    .orderBy(desc(schema.attempts.id))
    .all()
    .filter(reusable)) {
    if (seenPrompts.has(a.question.prompt)) continue;
    seenPrompts.add(a.question.prompt);
    add(a.nodeKey ?? "", attemptItem(a, topic.title, a.nodeKey ? (titles.get(a.nodeKey) ?? null) : null));
  }
  for (const c of db.select().from(schema.cards).where(eq(schema.cards.topicId, topicId)).all()) {
    if (seenPrompts.has(c.question.prompt)) continue;
    seenPrompts.add(c.question.prompt);
    add(c.nodeKey ?? "", cardItem(c, topic.title, c.nodeKey ? (titles.get(c.nodeKey) ?? null) : null));
  }

  // Round robin over the ideas, so every idea is asked before any is asked twice.
  const keys = [...plan.map((n) => n.key), ""].filter((k) => pool.has(k));
  const queues = keys.map((k) => shuffle(pool.get(k)!));
  const items: DrillItem[] = [];
  while (items.length < count && queues.some((q) => q.length)) {
    for (const q of queues) {
      if (items.length >= count) break;
      const next = q.shift();
      if (next) items.push(next);
    }
  }

  let generated = 0;
  const missing = count - items.length;
  if (missing > 0 && generate) {
    const covered = new Map<string, number>();
    for (const it of items) if (it.node) covered.set(it.node.key, (covered.get(it.node.key) ?? 0) + 1);
    const materials = materialsText(topicId, 20_000);
    const planText = plan.length
      ? plan.map((n) => `- ${n.key} — ${n.title}${n.summary ? `: ${n.summary}` : ""} (уже есть вопросов: ${covered.get(n.key) ?? 0})`).join("\n")
      : "(плана нет — опирайся на название и цель темы)";
    const r = await chatAs("strong", "exam", null, {
      system: EXAM_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `Тема: ${topic.title}${topic.goal ? `\nЦель ученика: ${topic.goal}` : ""}\n\nПлан:\n${planText}` +
                (topic.notes ? `\n\nКонспект темы:\n${topic.notes.slice(0, 12_000)}` : "") +
                (materials ? `\n\nМатериалы ученика (вопросы — по их содержанию):\n${materials}` : "") +
                `\n\nСоставь ${missing} новых вопросов, в первую очередь по идеям, где вопросов меньше всего.`,
            },
          ],
        },
      ],
      maxTokens: 8000,
    });
    const questions = parseQuestions(r.content.filter(isText).map((b) => b.text).join(""), "check", new Set(plan.map((n) => n.key))).slice(0, missing);
    const now = Date.now();
    for (const q of questions) {
      const row = db
        .insert(schema.cards)
        .values({ topicId, nodeKey: q.node_key ?? null, origin: "exam", question: q, dueAt: now, createdAt: now })
        .returning()
        .get();
      items.push(cardItem(row, topic.title, row.nodeKey ? (titles.get(row.nodeKey) ?? null) : null));
      generated++;
    }
  }
  if (!items.length) throw new Error("Для экзамена пока нет вопросов. Пройди урок или разреши составить новые вопросы.");
  return { items: shuffle(items), generated };
}
