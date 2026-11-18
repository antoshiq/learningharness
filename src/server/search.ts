// Search across everything the learner has: topics, overviews, cheat sheets,
// questions, cards, parked thoughts and project conversations.
import { getDb, schema } from "./db";
import { questionKey } from "./questions";

export interface SearchHit {
  kind: "topic" | "brief" | "notes" | "question" | "card" | "parking" | "ask";
  title: string;
  snippet: string;
  href: string;
}

const LIMIT = 30;

/** All words must occur (case-insensitive); returns a short excerpt around the first one. */
function match(text: string, words: string[]): string | null {
  const low = text.toLowerCase();
  if (!words.every((w) => low.includes(w))) return null;
  const at = low.indexOf(words[0]);
  const start = Math.max(0, at - 60);
  const plain = text.slice(start, at + 140).replace(/[#*_`>|]+/g, " ").replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + plain + (at + 140 < text.length ? "…" : "");
}

export function search(query: string): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return [];
  const db = getDb();
  const hits: SearchHit[] = [];
  const push = (h: SearchHit | null) => {
    if (h && hits.length < LIMIT * 3) hits.push(h);
  };

  const topics = db.select().from(schema.topics).all();
  const title = new Map(topics.map((t) => [t.id, t.title]));
  for (const t of topics) {
    const s = match(`${t.title}\n${t.goal}`, words);
    if (s) push({ kind: "topic", title: t.title, snippet: t.goal || "тема", href: `/topics/${t.id}` });
    if (t.notes) {
      const n = match(t.notes, words);
      if (n) push({ kind: "notes", title: `Конспект: ${t.title}`, snippet: n, href: `/topics/${t.id}?tab=notes` });
    }
  }
  for (const b of db.select().from(schema.briefs).all()) {
    const s = match(`${b.title}\n${b.text}`, words);
    if (s) push({ kind: "brief", title: b.title, snippet: s, href: `/brief/${b.id}` });
  }
  const seen = new Set<string>();
  for (const a of db.select().from(schema.attempts).all()) {
    if (a.topicId == null || a.misconceptionType === "invalid_question" || seen.has(questionKey(a.question))) continue;
    seen.add(questionKey(a.question));
    const s = match(`${a.question.prompt}\n${a.question.explanation ?? ""}\n${a.misconception ?? ""}`, words);
    if (s) push({ kind: "question", title: `Вопрос: ${title.get(a.topicId) ?? ""}`, snippet: s, href: `/topics/${a.topicId}?tab=mistakes` });
  }
  for (const c of db.select().from(schema.cards).all()) {
    const s = match(`${c.question.prompt}\n${c.question.explanation ?? ""}\n${c.question.reference_answer ?? ""}`, words);
    if (s) push({ kind: "card", title: `Карточка: ${title.get(c.topicId) ?? ""}`, snippet: s, href: `/topics/${c.topicId}?tab=cards` });
  }
  for (const p of db.select().from(schema.parking).all()) {
    const s = match(p.text, words);
    if (s && p.topicId != null) push({ kind: "parking", title: `Парковка: ${title.get(p.topicId) ?? ""}`, snippet: s, href: `/topics/${p.topicId}?tab=parking` });
  }
  for (const c of db.select().from(schema.repoChats).all()) {
    const s = match(c.messages.map((m) => m.text).join("\n"), words);
    if (s) push({ kind: "ask", title: c.title, snippet: s, href: `/ask/${c.id}` });
  }

  // Titles that match rank above body matches.
  const inTitle = (h: SearchHit) => Number(words.every((w) => h.title.toLowerCase().includes(w)));
  return hits.sort((a, b) => inTitle(b) - inTitle(a)).slice(0, LIMIT);
}
