// "Explain it in your own words" (the Feynman technique): the learner explains
// an idea as if teaching someone; the tutor finds gaps and errors and asks one
// follow-up question. Up to a few rounds; the first one counts for the review
// schedule, because it shows what the learner knew before any help.
import { and, desc, eq } from "drizzle-orm";
import { planView } from "./agent/state";
import { getDb, schema } from "./db";
import type { ExplainRound } from "./db/schema";
import { chatAs } from "./llm";
import { isText } from "./llm/types";
import { applyRating } from "./mastery";
import { materialsText } from "./materials";

export const MAX_ROUNDS = 4;

const EXPLAIN_SYSTEM = `Ты проверяешь объяснение ученика: он рассказывает идею своими словами, как будто учит друга (метод Фейнмана). Твоя задача — найти, где понимание неполное или неверное, и одним вопросом подтолкнуть к недостающему.
Оценивай понимание сути, а не стиль и не полноту формулировок. Не придирайся к мелочам, которые не меняют смысла. Если ученик отвечает на твой прошлый уточняющий вопрос, оцени объяснение целиком с учётом ответа.
Ответь только JSON-объектом без текста вокруг:
{"score": 0-100, "verdict": "correct" | "partial" | "wrong", "good": ["что объяснено верно", …], "gaps": ["что упущено", …], "errors": ["что неверно и как на самом деле", …], "followup": "один уточняющий вопрос по самому важному пробелу, или пустая строка, если всё понято", "model": "образцовое объяснение в 2–4 предложениях простыми словами"}
correct — суть понята без ошибок (score от 80), partial — суть есть, но есть пробелы, wrong — главное не понято или неверно. Пиши по-русски, формулы в $...$. Пункты списков короткие.`;

function parseReview(text: string): ExplainRound["review"] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let o: Record<string, unknown> = {};
  try {
    o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("Модель вернула разбор в неверном формате. Попробуй ещё раз.");
  }
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 8) : []);
  const score = Math.max(0, Math.min(100, Math.round(Number(o.score) || 0)));
  const verdict = o.verdict === "correct" || o.verdict === "partial" || o.verdict === "wrong" ? o.verdict : score >= 80 ? "correct" : score >= 40 ? "partial" : "wrong";
  return {
    score,
    verdict,
    good: list(o.good),
    gaps: list(o.gaps),
    errors: list(o.errors),
    followup: typeof o.followup === "string" ? o.followup.trim() : "",
    model: typeof o.model === "string" ? o.model.trim() : "",
  };
}

export function listExplanations(topicId: number) {
  return getDb()
    .select()
    .from(schema.explanations)
    .where(eq(schema.explanations.topicId, topicId))
    .orderBy(desc(schema.explanations.updatedAt))
    .limit(50)
    .all();
}

/**
 * Review one explanation. Without `id` a new one is started for `topicId` and
 * either a plan idea (`nodeKey`) or a free `concept`.
 */
export async function reviewExplanation(input: { id?: number; topicId?: number; nodeKey?: string; concept?: string; text: string }) {
  const db = getDb();
  const text = input.text.trim().slice(0, 8000);
  if (text.length < 20) throw new Error("Объяснение слишком короткое: расскажи хотя бы в паре предложений");

  let row = input.id ? db.select().from(schema.explanations).where(eq(schema.explanations.id, input.id)).get() : undefined;
  if (input.id && !row) throw new Error("Объяснение не найдено");
  if (row && row.rounds.length >= MAX_ROUNDS) throw new Error("Достаточно уточнений: начни новое объяснение");
  const topicId = row?.topicId ?? Number(input.topicId);
  const topic = db.select().from(schema.topics).where(eq(schema.topics.id, topicId)).get();
  if (!topic) throw new Error("Тема не найдена");
  const plan = planView(db, topicId);
  const nodeKey = row?.nodeKey ?? (input.nodeKey && plan.some((n) => n.key === input.nodeKey) ? input.nodeKey : null);
  const node = nodeKey ? plan.find((n) => n.key === nodeKey) : undefined;
  const concept = row?.concept ?? (node ? node.title : (input.concept ?? "").trim().slice(0, 300));
  if (!concept) throw new Error("Выбери идею плана или напиши, что будешь объяснять");

  const context = [
    `Тема: ${topic.title}`,
    `Что объясняет ученик: ${concept}${node?.summary ? ` (${node.summary})` : ""}`,
    topic.notes ? `Конспект темы (для сверки):\n${topic.notes.slice(0, 8000)}` : "",
    materialsText(topicId, 12_000) ? `Материалы ученика (для сверки):\n${materialsText(topicId, 12_000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const history = (row?.rounds ?? []).flatMap((r, i) => [
    i === 0 ? `Объяснение ученика:\n${r.text}` : `Ответ ученика на уточняющий вопрос:\n${r.text}`,
    `Твой разбор: оценка ${r.review.score}; пробелы: ${r.review.gaps.join("; ") || "—"}; ошибки: ${r.review.errors.join("; ") || "—"}; уточняющий вопрос: ${r.review.followup || "—"}`,
  ]);
  const last = row ? `Ответ ученика на уточняющий вопрос «${row.rounds.at(-1)!.review.followup}»:\n${text}` : `Объяснение ученика:\n${text}`;

  const r = await chatAs("strong", "explain", null, {
    system: EXPLAIN_SYSTEM,
    messages: [{ role: "user", content: [{ type: "text", text: [context, ...history, last].join("\n\n") }] }],
    maxTokens: 3000,
  });
  const review = parseReview(r.content.filter(isText).map((b) => b.text).join(""));
  const now = Date.now();
  const round: ExplainRound = { text, review, at: now };

  if (!row) {
    row = db
      .insert(schema.explanations)
      .values({ topicId, nodeKey, concept, rounds: [round], createdAt: now, updatedAt: now })
      .returning()
      .get();
    // Only the unaided first explanation says how well the idea is known.
    if (node && node.status !== "new") {
      const n = db.select().from(schema.nodes).where(and(eq(schema.nodes.topicId, topicId), eq(schema.nodes.key, node.key))).get();
      if (n) applyRating(db, n, review.verdict, 0, null, new Date(now));
    }
  } else {
    row = db
      .update(schema.explanations)
      .set({ rounds: [...row.rounds, round], updatedAt: now })
      .where(eq(schema.explanations.id, row.id))
      .returning()
      .get();
  }
  db.insert(schema.drills)
    .values({ sourceAttemptId: 0, topicId, nodeKey, mode: "explain", outcome: review.verdict, selfGraded: false, createdAt: now })
    .run();
  db.update(schema.topics).set({ updatedAt: now }).where(eq(schema.topics.id, topicId)).run();
  return row!;
}
