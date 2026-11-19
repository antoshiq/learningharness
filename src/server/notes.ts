// The topic's cheat sheet: one tool-less model call over what is known about
// the learner's progress. Answer keys are fine here, the lesson is over.
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "./db";
import { planView } from "./agent/state";
import { materialsText } from "./materials";
import { theoryForNotes } from "./theory";

const MAX_CONTEXT = 40_000;

export function notesContext(topicId: number): string {
  const db = getDb();
  const topic = db.select().from(schema.topics).where(eq(schema.topics.id, topicId)).get();
  if (!topic) throw new Error("Тема не найдена");
  const plan = planView(db, topicId);
  const status = { mastered: "освоено", learning: "изучается", new: "не начато" } as const;

  const out: string[] = [`Тема: ${topic.title}`];
  if (topic.goal) out.push(`Цель ученика: ${topic.goal}`);
  out.push(
    "",
    "План:",
    ...(plan.length
      ? plan.map((n) => `- ${n.key} — ${n.title} [${status[n.status]}]${n.summary ? `: ${n.summary}` : ""}${n.deps.length ? ` (после: ${n.deps.join(", ")})` : ""}`)
      : ["(плана ещё нет)"]),
  );
  if (topic.repoMap) out.push("", "Карта проекта:", topic.repoMap.slice(0, 6000));
  const materials = materialsText(topicId, 15_000);
  if (materials) out.push("", "Материалы ученика (основа темы):", materials);
  const theory = theoryForNotes(db, topicId);
  if (theory) out.push("", "Теория, которую репетитор объяснял на уроках, по идеям (опирайся на неё, сохраняя формулировки и примеры, которые ученик уже видел):", theory);

  const summaries = db
    .select({ summary: schema.sessions.summary })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.topicId, topicId), isNotNull(schema.sessions.summary)))
    .orderBy(desc(schema.sessions.id))
    .limit(10)
    .all();
  if (summaries.length) {
    out.push("", "Итоги сессий (новые первыми):");
    for (const { summary: s } of summaries) {
      if (!s) continue;
      out.push(`- освоено: ${s.learned.join("; ") || "—"}; слабые места: ${s.weak.join("; ") || "—"}`);
    }
  }

  const attempts = db
    .select()
    .from(schema.attempts)
    .where(and(eq(schema.attempts.topicId, topicId), isNotNull(schema.attempts.outcome)))
    .orderBy(desc(schema.attempts.id))
    .limit(60)
    .all()
    .filter((a) => a.misconceptionType !== "invalid_question");
  const mistakes = attempts.filter((a) => a.misconception);
  if (mistakes.length) {
    out.push("", "Ошибки ученика:");
    for (const a of mistakes.slice(0, 15)) out.push(`- [${a.nodeKey ?? "диагностика"}] ${a.misconceptionType ? a.misconceptionType + ": " : ""}${a.misconception}`);
  }
  out.push("", "Вопросы из уроков с эталонами:");
  for (const a of attempts.slice(0, 30)) {
    const q = a.question;
    const key =
      q.kind === "choice" && q.options && typeof q.correct_option === "number"
        ? `ответ: ${q.options[q.correct_option]}`
        : q.solution
          ? `решение:\n${q.solution}`
          : q.reference_answer
            ? `эталон: ${q.reference_answer}`
            : "";
    out.push(`### [${a.nodeKey ?? "—"}] ${q.prompt}${q.code && q.kind === "predict_output" ? `\n${q.code}` : ""}\n${key}${q.explanation ? `\nпояснение: ${q.explanation}` : ""}`);
  }
  return out.join("\n").slice(0, MAX_CONTEXT);
}

export function saveNotes(topicId: number, text: string) {
  getDb().update(schema.topics).set({ notes: text.trim(), notesAt: Date.now() }).where(eq(schema.topics.id, topicId)).run();
}
