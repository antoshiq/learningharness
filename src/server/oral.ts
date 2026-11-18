// The oral exam: an examiner asks one question at a time (read aloud in the
// browser), the learner answers by voice or text, the examiner digs deeper
// where an answer is thin, and at the end the whole talk is graded idea by
// idea. Ideas explained well count as "explained" for the strict levels; in a
// semester module the score also goes into the grade book.
import { desc, eq } from "drizzle-orm";
import { LEVELS } from "@/lib/semester";
import { planView } from "./agent/state";
import { getDb, schema } from "./db";
import type { ExplainRound, OralResult, OralTurn } from "./db/schema";
import { chatAs } from "./llm";
import { isText } from "./llm/types";
import { jsonObject } from "./semester/program";

/** Examiner turns at most (questions and follow-ups). */
export const MAX_QUESTIONS = 12;

export const ORAL_SYSTEM = `Ты принимаешь устный экзамен у одного ученика, как строгий, но доброжелательный преподаватель. Твои слова будут прочитаны вслух синтезатором речи.
- За раз — один вопрос, коротко: одно-три предложения. Без Markdown, без LaTeX и без кода: формулы произноси словами («икс в квадрате плюс один»).
- Охвати 4–6 ключевых идей из списка ниже, по возможности разных. Спрашивай понимание: почему, как связано, приведи пример, что будет если. Не спрашивай определения дословно.
- Если ответ неполный или неточный — задай один уточняющий вопрос по той же идее. Если ученик не знает — не объясняй и не подсказывай, переходи дальше.
- Не оценивай ответы вслух и не говори «правильно» или «неверно»: оценка будет в конце.
- Когда идеи охвачены (или ученик просит закончить) — поблагодари одной фразой и закончи.
Ответ — только JSON: {"say": "что ты говоришь", "idea": "key идеи, о которой вопрос", "done": false}. В последней реплике done: true.`;

export const ORAL_GRADE_SYSTEM = `Ты оцениваешь устный экзамен по записи разговора. Ответы ученика распознаны из речи, поэтому не снижай за оговорки, опечатки и неточное распознавание слов — оценивай понимание.
- По каждой идее, о которой спрашивали: verdict correct (понимает и может объяснить), partial (понимает частично или с ошибкой), wrong (не понимает или не ответил) и короткий комментарий: что было хорошо и чего не хватило.
- score — общий результат в процентах, по уровню курса.
- feedback — 2–4 предложения: общий вывод и что повторить.
Ответ — только JSON: {"score": 75, "feedback": "...", "ideas": [{"key": "...", "verdict": "partial", "comment": "..."}]}`;

type OralRow = typeof schema.oralExams.$inferSelect;

function scope(topicId: number) {
  const db = getDb();
  const topic = db.select().from(schema.topics).where(eq(schema.topics.id, topicId)).get();
  if (!topic) throw new Error("Тема не найдена");
  const plan = planView(db, topicId);
  if (!plan.length) throw new Error("У темы ещё нет плана: устный экзамен — по идеям плана.");
  const mod = topic.semesterModuleId ? db.select().from(schema.semesterModules).where(eq(schema.semesterModules.id, topic.semesterModuleId)).get() : undefined;
  const sem = mod ? db.select().from(schema.semesters).where(eq(schema.semesters.id, mod.semesterId)).get() : undefined;
  // Studied ideas first: an exam asks what was learned.
  const ideas = [...plan].sort((a, b) => Number(b.status !== "new") - Number(a.status !== "new"));
  return { topic, ideas, mod, sem };
}

function header(topicId: number): string {
  const { topic, ideas, sem } = scope(topicId);
  return [
    `Тема: ${topic.title}${topic.goal ? ` — ${topic.goal}` : ""}`,
    sem ? `Уровень курса. ${LEVELS[sem.level].depth}` : "",
    "Идеи (key: название — суть):",
    ...ideas.map((n) => `- ${n.key}: ${n.title}${n.summary ? ` — ${n.summary}` : ""}${n.status === "new" ? " (ещё не изучалась)" : ""}`),
  ]
    .filter(Boolean)
    .join("\n");
}

const transcript = (turns: OralTurn[]) => turns.map((t) => `${t.role === "examiner" ? "Экзаменатор" : "Ученик"}: ${t.text}`).join("\n");

async function examinerTurn(row: OralRow): Promise<OralTurn & { done: boolean }> {
  const asked = row.turns.filter((t) => t.role === "examiner").length;
  const r = await chatAs("strong", "oral", null, {
    system: ORAL_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${header(row.topicId)}\n\n${row.turns.length ? `Разговор до сих пор:\n${transcript(row.turns)}\n\n` : ""}${asked >= MAX_QUESTIONS - 1 ? "Это последняя реплика: закончи экзамен (done: true)." : asked ? "Следующая реплика экзаменатора." : "Начни экзамен: поздоровайся одной фразой и задай первый вопрос."}`,
          },
        ],
      },
    ],
    maxTokens: 1500,
  });
  const text = r.content.filter(isText).map((b) => b.text).join("");
  const raw = jsonObject(text) as { say?: unknown; idea?: unknown; done?: unknown } | null;
  // A model that ignored the format still said something: use it as is.
  const say = typeof raw?.say === "string" && raw.say.trim() ? raw.say.trim() : text.replace(/```[\s\S]*?```/g, "").trim();
  if (!say) throw new Error("Экзаменатор не ответил. Попробуй ещё раз.");
  return { role: "examiner", text: say.slice(0, 1500), idea: typeof raw?.idea === "string" ? raw.idea : undefined, at: Date.now(), done: raw?.done === true || asked + 1 >= MAX_QUESTIONS };
}

export function getOral(id: number): OralRow {
  const row = getDb().select().from(schema.oralExams).where(eq(schema.oralExams.id, id)).get();
  if (!row) throw new Error("Экзамен не найден");
  return row;
}

export async function startOral(topicId: number): Promise<OralRow> {
  scope(topicId);
  const db = getDb();
  const row = db.insert(schema.oralExams).values({ topicId, turns: [], createdAt: Date.now() }).returning().get();
  const first = await examinerTurn(row);
  db.update(schema.oralExams).set({ turns: [{ role: first.role, text: first.text, idea: first.idea, at: first.at }] }).where(eq(schema.oralExams.id, row.id)).run();
  return getOral(row.id);
}

/** The learner's answer; the examiner replies, or the exam ends and is graded. */
export async function answerOral(id: number, answer: string): Promise<OralRow> {
  const db = getDb();
  const row = getOral(id);
  if (row.status !== "active") throw new Error("Экзамен уже закончен");
  const text = answer.trim().slice(0, 6000);
  if (!text) throw new Error("Ответ пустой");
  const turns: OralTurn[] = [...row.turns, { role: "student", text, at: Date.now() }];
  db.update(schema.oralExams).set({ turns }).where(eq(schema.oralExams.id, id)).run();
  const next = await examinerTurn({ ...row, turns });
  const all = [...turns, { role: next.role, text: next.text, idea: next.idea, at: next.at }];
  db.update(schema.oralExams).set({ turns: all }).where(eq(schema.oralExams.id, id)).run();
  if (next.done) return finishOral(id);
  return getOral(id);
}

const SCORE: Record<string, number> = { correct: 100, partial: 60, wrong: 20 };

/** Grade the whole talk, record what it showed, close the exam. */
export async function finishOral(id: number): Promise<OralRow> {
  const db = getDb();
  const row = getOral(id);
  if (row.status === "done") return row;
  const { ideas, mod, sem } = scope(row.topicId);
  const answered = row.turns.some((t) => t.role === "student");
  let result: OralResult;
  if (!answered) {
    result = { score: 0, feedback: "Экзамен закончен без ответов.", ideas: [] };
  } else {
    const r = await chatAs("strong", "oral-grade", null, {
      system: ORAL_GRADE_SYSTEM,
      messages: [{ role: "user", content: [{ type: "text", text: `${header(row.topicId)}\n\nЗапись экзамена:\n${transcript(row.turns)}` }] }],
      maxTokens: 4000,
    });
    const raw = (jsonObject(r.content.filter(isText).map((b) => b.text).join("")) ?? {}) as { score?: unknown; feedback?: unknown; ideas?: unknown };
    const titles = new Map(ideas.map((n) => [n.key, n.title]));
    const graded = (Array.isArray(raw.ideas) ? raw.ideas : [])
      .map((x) => x as { key?: unknown; verdict?: unknown; comment?: unknown })
      .filter((x) => typeof x.key === "string" && titles.has(x.key) && ["correct", "partial", "wrong"].includes(String(x.verdict)))
      .map((x) => ({ key: x.key as string, title: titles.get(x.key as string)!, verdict: x.verdict as "correct" | "partial" | "wrong", comment: String(x.comment ?? "").slice(0, 600) }));
    const score = Number(raw.score);
    result = {
      score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : graded.length ? Math.round(graded.reduce((n, g) => n + SCORE[g.verdict], 0) / graded.length) : 0,
      feedback: typeof raw.feedback === "string" ? raw.feedback.slice(0, 2000) : "",
      ideas: graded,
    };
  }
  const now = Date.now();
  db.transaction((tx) => {
    tx.update(schema.oralExams).set({ status: "done", result, finishedAt: now }).where(eq(schema.oralExams.id, id)).run();
    // What the learner explained aloud counts as an explanation of the idea.
    for (const g of result.ideas) {
      const said = row.turns
        .map((t, i) => (t.role === "student" && row.turns[i - 1]?.idea === g.key ? t.text : ""))
        .filter(Boolean)
        .join("\n\n");
      const round: ExplainRound = {
        text: said || "(устный экзамен)",
        review: { score: SCORE[g.verdict], verdict: g.verdict, good: g.verdict === "correct" && g.comment ? [g.comment] : [], gaps: g.verdict !== "correct" && g.comment ? [g.comment] : [], errors: [], followup: "", model: "" },
        at: now,
      };
      tx.insert(schema.explanations).values({ topicId: row.topicId, nodeKey: g.key, concept: g.title, rounds: [round], createdAt: now, updatedAt: now }).run();
    }
    if (mod && sem && answered) {
      tx.insert(schema.semesterAssessments)
        .values({ semesterId: sem.id, moduleId: mod.id, kind: "oral", score: result.score, passed: result.score >= LEVELS[sem.level].threshold, details: result.ideas.map((g) => ({ key: g.key, title: g.title, got: SCORE[g.verdict] / 100, total: 1 })), createdAt: now })
        .run();
    }
  });
  return getOral(id);
}

export function listOral(topicId: number) {
  return getDb()
    .select({ id: schema.oralExams.id, status: schema.oralExams.status, result: schema.oralExams.result, createdAt: schema.oralExams.createdAt })
    .from(schema.oralExams)
    .where(eq(schema.oralExams.topicId, topicId))
    .orderBy(desc(schema.oralExams.id))
    .all()
    .map((r) => ({ id: r.id, status: r.status, score: r.result?.score ?? null, createdAt: r.createdAt }));
}
