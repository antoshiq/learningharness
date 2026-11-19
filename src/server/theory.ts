// The topic's own textbook: theory the tutor gave in lessons, kept by idea of
// the plan so it can be reread outside the lesson and used in the cheat sheet.
//
// A lesson does not tag its text with ideas. What it does tag are questions:
// so when the learner answers a question on an idea, the explanations since
// the previous question (theory steps, "Объясни подробнее", the text before
// the question) are filed under that idea. Short remarks are left out.
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "./db";
import { schema } from "./db";
import { isText, isToolUse, type ChatMsg } from "./llm/types";
import { planView } from "./agent/state";

/** Shorter texts are feedback and transitions ("Верно, дальше…"), not theory. */
export const MIN_THEORY_CHARS = 280;

/** Explanations that led up to the question `toolUseId`, oldest first. */
export function theoryBefore(messages: ChatMsg[], toolUseId: string): string[] {
  let at = -1;
  for (let i = messages.length - 1; i >= 0 && at < 0; i--) {
    if (messages[i].role === "assistant" && messages[i].content.some((b) => isToolUse(b) && b.id === toolUseId)) at = i;
  }
  if (at < 0) return [];
  const texts: string[] = [];
  for (let i = at; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    // An earlier question closes the stretch; text in the same message as our question still counts.
    if (i !== at && m.content.some((b) => isToolUse(b) && b.name === "ask_question")) break;
    const own = m.content.filter(isText).map((b) => b.text.trim()).filter((t) => t.length >= MIN_THEORY_CHARS);
    texts.unshift(...own);
  }
  return texts;
}

/** File the explanations before an answered question under its idea (once per text). */
export function captureTheory(db: Db, a: { topicId: number | null; sessionId: number | null; nodeKey: string | null; toolUseId: string }, messages: ChatMsg[]) {
  if (!a.topicId || !a.nodeKey) return;
  const texts = theoryBefore(messages, a.toolUseId);
  if (!texts.length) return;
  const have = new Set(
    db
      .select({ text: schema.theory.text })
      .from(schema.theory)
      .where(and(eq(schema.theory.topicId, a.topicId), eq(schema.theory.nodeKey, a.nodeKey)))
      .all()
      .map((r) => r.text),
  );
  const now = Date.now();
  for (const text of texts) {
    if (have.has(text)) continue;
    have.add(text);
    db.insert(schema.theory).values({ topicId: a.topicId, nodeKey: a.nodeKey, sessionId: a.sessionId, text, createdAt: now }).run();
  }
}

export interface TheoryNode {
  key: string;
  title: string;
  status: string;
  entries: { id: number; text: string; createdAt: number; sessionId: number | null }[];
}

/** Theory of a topic by idea, in the order of the plan (ideas without theory are left out). */
export function topicTheory(db: Db, topicId: number): TheoryNode[] {
  const rows = db.select().from(schema.theory).where(eq(schema.theory.topicId, topicId)).orderBy(asc(schema.theory.id)).all();
  const by = new Map<string, TheoryNode["entries"]>();
  for (const r of rows) {
    const list = by.get(r.nodeKey) ?? [];
    list.push({ id: r.id, text: r.text, createdAt: r.createdAt, sessionId: r.sessionId });
    by.set(r.nodeKey, list);
  }
  const out: TheoryNode[] = [];
  for (const n of planView(db, topicId)) {
    const entries = by.get(n.key);
    if (entries) out.push({ key: n.key, title: n.title, status: n.status, entries });
    by.delete(n.key);
  }
  // Ideas that were dropped from the plan later keep their theory at the end.
  for (const [key, entries] of by) out.push({ key, title: key, status: "new", entries });
  return out;
}

export function deleteTheory(db: Db, topicId: number, id: number) {
  db.delete(schema.theory).where(and(eq(schema.theory.topicId, topicId), eq(schema.theory.id, id))).run();
}

/** The theory for the cheat sheet, trimmed per idea. */
export function theoryForNotes(db: Db, topicId: number, perNode = 3000, total = 14_000): string {
  const parts: string[] = [];
  let used = 0;
  for (const n of topicTheory(db, topicId)) {
    const body = n.entries.map((e) => e.text).join("\n\n").slice(0, perNode);
    if (used + body.length > total) break;
    used += body.length;
    parts.push(`### ${n.key} — ${n.title}\n${body}`);
  }
  return parts.join("\n\n");
}
