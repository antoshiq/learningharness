// Export a topic's questions and cards to Anki: a tab-separated text file with
// Anki's file headers (File → Import in Anki 2.1.55+ reads the deck name and
// that the fields are HTML). Formulas become Anki's MathJax \( … \) and \[ … \].
import { and, eq, isNotNull } from "drizzle-orm";
import { parsonsLines } from "@/lib/grading";
import type { Question } from "@/lib/types";
import { getDb, schema } from "./db";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A small Markdown subset to HTML: code blocks, inline code, bold, math, line breaks. */
export function mdToAnkiHtml(md: string): string {
  const parts = md.replace(/\r\n?/g, "\n").split(/(```[\s\S]*?```)/g);
  return parts
    .map((p, i) => {
      if (i % 2 === 1) return `<pre><code>${esc(p.replace(/^```[\w-]*\n?/, "").replace(/```$/, "").replace(/\n$/, ""))}</code></pre>`;
      return esc(p)
        .replace(/\$\$([\s\S]+?)\$\$/g, (_, m: string) => `\\[${m.trim()}\\]`)
        .replace(/\$([^$\n]+?)\$/g, (_, m: string) => `\\(${m.trim()}\\)`)
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
        .replace(/\n/g, "<br>");
    })
    .join("");
}

const code = (lang: string | undefined, src: string) => `\`\`\`${lang ?? ""}\n${src}\n\`\`\``;

/** Front and back of one question. */
export function ankiNote(q: Question): [string, string] {
  let front = q.prompt;
  let back = "";
  switch (q.kind) {
    case "choice":
      front += "\n\n" + (q.options ?? []).map((o, i) => `${i + 1}. ${o}`).join("\n");
      back = `**${(q.correct_option ?? 0) + 1}. ${q.options?.[q.correct_option ?? 0] ?? ""}**`;
      break;
    case "predict_output":
      front += "\n\n" + code(q.language, q.code ?? "");
      back = "Программа напечатает вывод выше; проверь, запустив её.";
      break;
    case "code":
    case "find_bug":
      if (q.code) front += "\n\n" + code(q.language, q.code);
      back = code(q.language, q.solution ?? "");
      break;
    case "parsons":
      back = code(q.language, parsonsLines(q.solution ?? "").join("\n"));
      break;
    default:
      back = q.reference_answer ?? "";
  }
  if (q.explanation) back += `\n\n${q.explanation}`;
  return [mdToAnkiHtml(front), mdToAnkiHtml(back.trim())];
}

const field = (s: string) => `"${s.replace(/"/g, '""').replace(/\t/g, " ")}"`;

export function ankiExport(topicId: number): { name: string; body: string; count: number } {
  const db = getDb();
  const topic = db.select().from(schema.topics).where(eq(schema.topics.id, topicId)).get();
  if (!topic) throw new Error("Тема не найдена");
  const questions: Question[] = [];
  const seen = new Set<string>();
  for (const a of db
    .select()
    .from(schema.attempts)
    .where(and(eq(schema.attempts.topicId, topicId), isNotNull(schema.attempts.answer)))
    .all()) {
    // predict_output has no stored output to put on the back; leave those to the app.
    if (a.misconceptionType === "invalid_question" || a.question.kind === "predict_output" || seen.has(a.question.prompt)) continue;
    seen.add(a.question.prompt);
    questions.push(a.question);
  }
  for (const c of db.select().from(schema.cards).where(eq(schema.cards.topicId, topicId)).all()) {
    if (seen.has(c.question.prompt)) continue;
    seen.add(c.question.prompt);
    questions.push(c.question);
  }
  if (!questions.length) throw new Error("В теме пока нет вопросов для экспорта");
  const deck = `Репетитор::${topic.title.replace(/::/g, " ")}`;
  const tag = topic.title.replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 60) || "тема";
  const lines = [
    "#separator:tab",
    "#html:true",
    `#deck:${deck}`,
    "#notetype:Basic",
    "#tags column:3",
    ...questions.map((q) => {
      const [front, back] = ankiNote(q);
      return [field(front), field(back), `репетитор ${tag}`].join("\t");
    }),
  ];
  const name = `${topic.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "тема"} (Anki).txt`;
  return { name, body: lines.join("\n") + "\n", count: questions.length };
}
