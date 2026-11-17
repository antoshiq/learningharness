// Questions written by the model as plain JSON (no tool calls, so every
// provider can make them): cards from an overview or cheat sheet, exam questions.
import type { Language, Purpose, Question } from "@/lib/types";

/** What the model is asked to produce; the parser accepts exactly this. */
export const QUESTION_FORMAT = `Ответь только JSON-массивом объектов, без текста до и после. Виды вопросов:
- выбор ответа: {"kind":"choice","prompt":"…","options":["…","…","…","…"],"correct_option":1,"explanation":"почему так"}
- свободный ответ: {"kind":"free","prompt":"…","reference_answer":"эталон в 1–3 предложения","explanation":"…"}
- предсказать вывод программы: {"kind":"predict_output","language":"python","prompt":"Что напечатает программа?","code":"print(…)","explanation":"…"}
Можно добавить "node_key", если вопрос проверяет конкретную идею плана.
Правила: prompt не содержит ответа; у choice 3–5 правдоподобных вариантов и ровно один верный, correct_option — индекс с нуля; predict_output только для python или javascript, программа детерминированная, короткая и что-то печатает; формулы в $...$, код в Markdown-блоках.`;

function arrayIn(text: string): unknown[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as unknown;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const str = (v: unknown, max = 4000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** Keep the well-formed questions, drop the rest silently. */
export function parseQuestions(text: string, purpose: Purpose, nodeKeys?: Set<string>): Question[] {
  const out: Question[] = [];
  for (const raw of arrayIn(text)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const prompt = str(o.prompt);
    if (!prompt) continue;
    const node = str(o.node_key, 100);
    const base = {
      purpose,
      prompt,
      explanation: str(o.explanation),
      ...(node && (!nodeKeys || nodeKeys.has(node)) ? { node_key: node } : {}),
    };
    if (o.kind === "choice") {
      const options = Array.isArray(o.options) ? o.options.map((x) => str(x, 1000)).filter((x): x is string => !!x) : [];
      const correct = Number(o.correct_option);
      if (options.length < 2 || options.length > 8 || !Number.isInteger(correct) || correct < 0 || correct >= options.length) continue;
      out.push({ ...base, kind: "choice", options, correct_option: correct });
    } else if (o.kind === "free") {
      const ref = str(o.reference_answer);
      if (!ref) continue;
      out.push({ ...base, kind: "free", reference_answer: ref });
    } else if (o.kind === "predict_output") {
      const language = o.language === "python" || o.language === "javascript" ? (o.language as Language) : null;
      const code = str(o.code, 4000);
      if (!language || !code) continue;
      out.push({ ...base, kind: "predict_output", language, code });
    }
  }
  return out;
}
