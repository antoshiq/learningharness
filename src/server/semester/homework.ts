// Weekly homework: one larger task that ties several ideas together, written
// for the modules of the week and graded against a rubric. The score goes to
// the grade book.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { LEVELS } from "@/lib/semester";
import { planView } from "../agent/state";
import { getDb, schema } from "../db";
import type { HomeworkCriterion, HomeworkReview } from "../db/schema";
import { chatAs } from "../llm";
import { isText } from "../llm/types";
import { calendar } from "./calendar";
import { semesterModules } from "./modules";
import { jsonObject } from "./program";

export const HOMEWORK_SYSTEM = `Ты составляешь домашнее задание на неделю семестра. Это не тест, а одна содержательная задача (или 2–3 связанных пункта), которая требует соединить несколько идей пройденного: доказать, вывести, решить нестандартную задачу, написать и объяснить программу, разобрать пример.
- Опирайся на идеи модулей ниже; если есть упражнения из книги — можно взять их за основу, указав номер и страницу.
- Сложность — по уровню семестра. Решение должно занимать 30–90 минут.
- Критерии оценивания (rubric): 3–6 пунктов, что именно проверяется, с баллами; сумма баллов — 10.
- Формулы в $...$ и $$...$$, код в блоках \`\`\` с языком.
Ответ — только JSON: {"title": "...", "task": "условие в Markdown", "rubric": [{"criterion": "...", "points": 3}]}`;

export const GRADE_HW_SYSTEM = `Ты проверяешь домашнее задание ученика по критериям. Будь строгим и справедливым, как хороший преподаватель: за каждый критерий поставь баллы от 0 до максимума и коротко объясни, почему. В feedback — что получилось, главная ошибка (если есть) и как её исправить; 2–5 предложений. Не придумывай того, чего в ответе нет.
Ответ — только JSON: {"scores": [{"criterion": "...", "got": 2, "max": 3, "comment": "..."}], "feedback": "..."}`;

type HomeworkRow = typeof schema.semesterHomework.$inferSelect;

export function listHomework(semesterId: number): HomeworkRow[] {
  return getDb().select().from(schema.semesterHomework).where(eq(schema.semesterHomework.semesterId, semesterId)).orderBy(asc(schema.semesterHomework.week)).all();
}

export function getHomework(semesterId: number, id: number): HomeworkRow {
  const h = getDb()
    .select()
    .from(schema.semesterHomework)
    .where(and(eq(schema.semesterHomework.id, id), eq(schema.semesterHomework.semesterId, semesterId)))
    .get();
  if (!h) throw new Error("Задание не найдено");
  return h;
}

/** Modules a week's homework is about: those planned for the week and studied, else the latest studied ones. */
export function homeworkModules(semesterId: number, week: number, now = Date.now()) {
  const db = getDb();
  const sem = db.select().from(schema.semesters).where(eq(schema.semesters.id, semesterId)).get()!;
  const mods = semesterModules(semesterId).filter((m) => m.kind === "regular" && m.topicId);
  const studied = mods.filter((m) => planView(db, m.topicId!).some((n) => n.status !== "new") || m.credit);
  const cal = calendar(semesterModules(semesterId), sem, now);
  const planned = new Set(cal.weeks.find((w) => w.week === week)?.moduleIds ?? []);
  const inWeek = studied.filter((m) => planned.has(m.id));
  return inWeek.length ? inWeek : studied.slice(-2);
}

/** Write this week's homework (once per week). */
export async function createHomework(semesterId: number, now = Date.now()): Promise<HomeworkRow> {
  const db = getDb();
  const sem = db.select().from(schema.semesters).where(eq(schema.semesters.id, semesterId)).get();
  if (!sem || sem.status !== "active") throw new Error("Домашние задания — в идущем семестре");
  const week = Math.max(1, Math.min(sem.weeks, calendar(semesterModules(semesterId), sem, now).currentWeek));
  const existing = db
    .select()
    .from(schema.semesterHomework)
    .where(and(eq(schema.semesterHomework.semesterId, semesterId), eq(schema.semesterHomework.week, week)))
    .get();
  if (existing) return existing;
  const mods = homeworkModules(semesterId, week, now);
  if (!mods.length) throw new Error("Домашнее задание появится, когда начнёшь первый модуль.");

  const parts = mods.map((m) => {
    const ideas = planView(db, m.topicId!)
      .map((n) => `- ${n.title}${n.summary ? `: ${n.summary}` : ""}`)
      .join("\n");
    return `Модуль «${m.title}»:\n${ideas}${m.guide ? `\nПутеводитель по книге:\n${m.guide}` : ""}`;
  });
  const r = await chatAs("strong", "semester-homework", null, {
    system: HOMEWORK_SYSTEM,
    messages: [{ role: "user", content: [{ type: "text", text: `Семестр «${sem.title}». ${LEVELS[sem.level].depth}\nНеделя ${week}.\n\n${parts.join("\n\n")}` }] }],
    maxTokens: 6000,
  });
  const raw = (jsonObject(r.content.filter(isText).map((b) => b.text).join("")) ?? {}) as { title?: unknown; task?: unknown; rubric?: unknown };
  const task = typeof raw.task === "string" ? raw.task.trim() : "";
  const rubric: HomeworkCriterion[] = (Array.isArray(raw.rubric) ? raw.rubric : [])
    .map((c) => ({ criterion: String((c as HomeworkCriterion)?.criterion ?? "").trim().slice(0, 300), points: Math.max(1, Math.round(Number((c as HomeworkCriterion)?.points) || 1)) }))
    .filter((c) => c.criterion)
    .slice(0, 8);
  if (!task || !rubric.length) throw new Error("Модель не смогла составить задание. Попробуй ещё раз.");
  return db
    .insert(schema.semesterHomework)
    .values({
      semesterId,
      week,
      moduleIds: mods.map((m) => m.id),
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 160) : `Домашнее задание, неделя ${week}`,
      task,
      rubric,
      createdAt: now,
    })
    .returning()
    .get();
}

/** Grade an answer against the rubric and put the score into the grade book. */
export async function submitHomework(semesterId: number, id: number, answer: string): Promise<HomeworkRow> {
  const db = getDb();
  const h = getHomework(semesterId, id);
  if (h.status === "graded") throw new Error("Задание уже проверено");
  const text = answer.trim();
  if (text.length < 20) throw new Error("Ответ слишком короткий");
  if (text.length > 60_000) throw new Error("Ответ слишком длинный");
  db.update(schema.semesterHomework).set({ answer: text }).where(eq(schema.semesterHomework.id, id)).run();

  const r = await chatAs("strong", "semester-homework-grade", null, {
    system: GRADE_HW_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Задание:\n${h.task}\n\nКритерии:\n${h.rubric.map((c) => `- ${c.criterion} (${c.points} б.)`).join("\n")}\n\nОтвет ученика:\n${text}`,
          },
        ],
      },
    ],
    maxTokens: 4000,
  });
  const raw = (jsonObject(r.content.filter(isText).map((b) => b.text).join("")) ?? {}) as { scores?: unknown; feedback?: unknown };
  const given = Array.isArray(raw.scores) ? (raw.scores as { criterion?: unknown; got?: unknown; comment?: unknown }[]) : [];
  if (!given.length) throw new Error("Не удалось проверить ответ. Попробуй ещё раз — ответ сохранён.");
  // Scores follow the rubric's own criteria and caps, whatever the model wrote.
  const scores = h.rubric.map((c, i) => {
    const g = given.find((x) => String(x.criterion ?? "").trim() === c.criterion) ?? given[i];
    return { criterion: c.criterion, max: c.points, got: Math.max(0, Math.min(c.points, Number(g?.got) || 0)), comment: String(g?.comment ?? "").slice(0, 600) };
  });
  const max = scores.reduce((n, s) => n + s.max, 0) || 1;
  const total = Math.round((scores.reduce((n, s) => n + s.got, 0) / max) * 1000) / 10;
  const review: HomeworkReview = { scores, total, feedback: typeof raw.feedback === "string" ? raw.feedback.slice(0, 3000) : "" };
  const now = Date.now();
  db.transaction((tx) => {
    tx.update(schema.semesterHomework).set({ review, status: "graded", gradedAt: now }).where(eq(schema.semesterHomework.id, id)).run();
    tx.insert(schema.semesterAssessments)
      .values({
        semesterId,
        moduleId: null,
        homeworkId: id,
        kind: "homework",
        score: total,
        // Homework is "passed" at a satisfactory grade; its score itself goes into the final grade.
        passed: total >= 55,
        details: scores.map((s) => ({ key: s.criterion.slice(0, 80), title: s.criterion.slice(0, 120), got: s.got, total: s.max })),
        createdAt: now,
      })
      .run();
  });
  return getHomework(semesterId, id);
}

/** Module titles of a homework, for display. */
export function homeworkModuleTitles(ids: number[]) {
  if (!ids.length) return [];
  return getDb().select({ id: schema.semesterModules.id, title: schema.semesterModules.title }).from(schema.semesterModules).where(inArray(schema.semesterModules.id, ids)).orderBy(desc(schema.semesterModules.idx)).all();
}

export const APPEAL_SYSTEM = `Ты пересматриваешь оценку домашнего задания: ученик с ней не согласен. Перечитай задание, критерии, ответ ученика, прежнюю оценку и его возражение.
- Будь честным: если ученик прав (решение верно, а проверка ошиблась или придралась), повысь баллы по нужным критериям; если нет — оставь как было и объясни по существу, почему.
- Баллы не снижай: апелляция не может навредить.
- В feedback начни с вывода («Оценка повышена: …» или «Оценка остаётся: …»), затем коротко обоснуй.
Ответ — только JSON: {"scores": [{"criterion": "...", "got": 2, "max": 3, "comment": "..."}], "feedback": "..."}`;

/** The learner disputes a homework grade once; the model reconsiders and may only raise it. */
export async function appealHomework(semesterId: number, id: number, objection: string): Promise<HomeworkRow> {
  const db = getDb();
  const h = getHomework(semesterId, id);
  if (h.status !== "graded" || !h.review) throw new Error("Сначала задание должно быть проверено");
  if (h.appeal) throw new Error("Апелляция уже была");
  const text = objection.trim();
  if (text.length < 10) throw new Error("Объясни, с чем не согласен");
  const r = await chatAs("strong", "semester-homework-appeal", null, {
    system: APPEAL_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `Задание:\n${h.task}`,
              `Критерии:\n${h.rubric.map((c) => `- ${c.criterion} (${c.points} б.)`).join("\n")}`,
              `Ответ ученика:\n${h.answer ?? ""}`,
              `Прежняя оценка:\n${h.review.scores.map((s) => `- ${s.criterion}: ${s.got} из ${s.max}. ${s.comment}`).join("\n")}\n${h.review.feedback}`,
              `Возражение ученика:\n${text.slice(0, 4000)}`,
            ].join("\n\n"),
          },
        ],
      },
    ],
    maxTokens: 4000,
  });
  const raw = (jsonObject(r.content.filter(isText).map((b) => b.text).join("")) ?? {}) as { scores?: unknown; feedback?: unknown };
  const given = Array.isArray(raw.scores) ? (raw.scores as { criterion?: unknown; got?: unknown; comment?: unknown }[]) : [];
  if (!given.length) throw new Error("Не удалось пересмотреть оценку. Попробуй ещё раз.");
  const before = h.review;
  const scores = h.rubric.map((c, i) => {
    const old = before.scores.find((s) => s.criterion === c.criterion) ?? before.scores[i];
    const g = given.find((x) => String(x.criterion ?? "").trim() === c.criterion) ?? given[i];
    // Never lower than before.
    const got = Math.max(old?.got ?? 0, Math.min(c.points, Number(g?.got) || 0));
    return { criterion: c.criterion, max: c.points, got, comment: String(g?.comment ?? old?.comment ?? "").slice(0, 600) };
  });
  const max = scores.reduce((n, s) => n + s.max, 0) || 1;
  const total = Math.round((scores.reduce((n, s) => n + s.got, 0) / max) * 1000) / 10;
  const review: HomeworkReview = { scores, total, feedback: typeof raw.feedback === "string" ? raw.feedback.slice(0, 3000) : "" };
  db.transaction((tx) => {
    tx.update(schema.semesterHomework).set({ appeal: text, firstReview: before, review }).where(eq(schema.semesterHomework.id, id)).run();
    tx.update(schema.semesterAssessments)
      .set({ score: total, passed: total >= 55, details: scores.map((s) => ({ key: s.criterion.slice(0, 80), title: s.criterion.slice(0, 120), got: s.got, total: s.max })) })
      .where(eq(schema.semesterAssessments.homeworkId, id))
      .run();
  });
  return getHomework(semesterId, id);
}
