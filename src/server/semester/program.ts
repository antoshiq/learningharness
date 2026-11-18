// The semester program: parts → modules → sections, each section tied to the
// book sections it is taught from. Built by the strong model from the books'
// outlines and/or the requested subject and level; then checked so that no
// part of the main book silently drops out.
import { and, asc, eq, inArray } from "drizzle-orm";
import { LEVELS } from "@/lib/semester";
import { isServiceTitle, outlineText } from "../books";
import { getDb, schema } from "../db";
import type { Prereq, ProgramSection } from "../db/schema";
import { chatAs } from "../llm";
import { isText } from "../llm/types";

export interface ProgramModule {
  part: string;
  title: string;
  summary: string;
  hours: number;
  sections: ProgramSection[];
}

export interface Program {
  title: string;
  estimateHours: number | null;
  prereqs: Prereq[];
  modules: ProgramModule[];
  notes: string[];
  recommended: string[];
}

export const PROGRAM_SYSTEM = `Ты составляешь программу семестра — полного курса, который ученик пройдёт до конца, чтобы знать предмет по-настоящему. Программа станет основой всего: модули, уроки, контрольные и экзамены.

Структура: части → модули → разделы.
- Модуль — законченная тема на 3–10 часов занятий, 2–8 разделов, в конце модуля контрольная.
- Раздел — то, что проходится за один-два урока.
- Части нужны, если курс большой: например «Часть 1. Пределы и непрерывность». Для небольшого курса достаточно одной части.

Если даны книги:
- Порядок — по основному учебнику. Охвати всё его содержание, кроме служебных разделов (предисловие, литература, указатели). Пропускать главы нельзя: ученик хочет знать всё.
- В refs у раздела программы перечисли id разделов книг (вида "s123"), по которым он учится. Можно несколько, из разных книг: параграф учебника, задачи из задачника к нему, лекция на ту же тему.
- Если для заявленного уровня нужно то, чего в книгах нет, добавь раздел с пустым refs.

Если книг нет: строй программу по типичным университетским курсам этого предмета для указанного уровня и цели, refs везде пустые. В recommended назови 1–3 известных учебника для этого уровня (на русском, если такие есть).

Также:
- prereqs: 3–8 вещей, которые курс предполагает известными (для входного теста), каждая — одна проверяемая идея.
- estimate_hours: честная оценка часов на весь курс при этом уровне.
- Если объём заметно больше, чем ученик успевает за отведённое время, всё равно составь полную программу, раздели её на части и скажи об этом в notes.
- notes: 0–5 коротких честных замечаний по-русски (объём, чего не хватает в книгах, что добавлено сверх книг).

Ответ — только JSON без пояснений:
{"title": "...", "estimate_hours": 120, "prereqs": [{"key": "latin-key", "title": "...", "summary": "..."}],
 "parts": [{"title": "...", "modules": [{"title": "...", "summary": "одна-две фразы", "hours": 6,
   "sections": [{"title": "...", "summary": "одна фраза", "refs": ["s12", "s40"]}]}]}],
 "notes": ["..."], "recommended": ["..."]}`;

/** The first JSON object in a reply. */
export function jsonObject(text: string): unknown {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const key = (v: unknown, i: number) => (str(v, 40).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || `pre-${i + 1}`);

/** Validate the model's program; refs are kept only when they name sections of these books. */
export function parseProgram(raw: unknown, knownSections: Set<number>): Program | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const modules: ProgramModule[] = [];
  for (const p of Array.isArray(r.parts) ? r.parts : []) {
    const part = str((p as Record<string, unknown>)?.title, 120);
    for (const m of Array.isArray((p as Record<string, unknown>)?.modules) ? ((p as Record<string, unknown>).modules as unknown[]) : []) {
      const mm = (m ?? {}) as Record<string, unknown>;
      const title = str(mm.title, 160);
      if (!title) continue;
      const sections: ProgramSection[] = [];
      for (const s of Array.isArray(mm.sections) ? mm.sections : []) {
        const ss = (s ?? {}) as Record<string, unknown>;
        const st = str(ss.title, 200);
        if (!st) continue;
        const refs = (Array.isArray(ss.refs) ? ss.refs : [])
          .map((x) => Number(String(x).replace(/^s/i, "")))
          .filter((n) => Number.isInteger(n) && knownSections.has(n));
        sections.push({ title: st, summary: str(ss.summary, 400), refs: [...new Set(refs)] });
      }
      if (!sections.length) sections.push({ title, summary: str(mm.summary, 400), refs: [] });
      const hours = Number(mm.hours);
      modules.push({ part, title, summary: str(mm.summary, 600), hours: Number.isFinite(hours) && hours > 0 ? Math.min(60, hours) : 4, sections });
    }
  }
  if (!modules.length) return null;
  const prereqs: Prereq[] = [];
  const seen = new Set<string>();
  (Array.isArray(r.prereqs) ? r.prereqs : []).slice(0, 10).forEach((x, i) => {
    const xx = (x ?? {}) as Record<string, unknown>;
    const title = str(xx.title, 120);
    let k = key(xx.key, i);
    while (seen.has(k)) k += "-x";
    if (!title) return;
    seen.add(k);
    prereqs.push({ key: k, title, summary: str(xx.summary, 300) });
  });
  const est = Number(r.estimate_hours);
  const list = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);
  return {
    title: str(r.title, 160),
    estimateHours: Number.isFinite(est) && est > 0 ? Math.round(est) : null,
    prereqs,
    modules,
    notes: list(r.notes, 6, 400),
    recommended: list(r.recommended, 4, 200),
  };
}

interface BookSec {
  id: number;
  bookId: number;
  level: number;
  title: string;
  pageFrom: number;
  pageTo: number;
}

/**
 * Sections of the main books (textbooks and lecture notes) that the program
 * left out are added to the module that covers the pages just before them.
 * Returns the titles that were added.
 */
export function attachUncovered(modules: ProgramModule[], sections: BookSec[], mainBooks: Set<number>): string[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const covered = new Map<number, Set<number>>();
  const cover = (s: BookSec) => {
    const set = covered.get(s.bookId) ?? new Set<number>();
    for (let p = s.pageFrom; p <= s.pageTo; p++) set.add(p);
    covered.set(s.bookId, set);
  };
  for (const m of modules) for (const s of m.sections) for (const r of s.refs) if (byId.has(r)) cover(byId.get(r)!);

  const added: string[] = [];
  const candidates = sections
    .filter((s) => mainBooks.has(s.bookId) && s.level <= 2 && !isServiceTitle(s.title))
    .sort((a, b) => a.bookId - b.bookId || a.pageFrom - b.pageFrom || a.level - b.level);
  for (const s of candidates) {
    // A chapter whose subsections are listed is judged by them.
    const hasChildren = candidates.some((c) => c.bookId === s.bookId && c.level > s.level && c.pageFrom >= s.pageFrom && c.pageTo <= s.pageTo);
    if (hasChildren) continue;
    const set = covered.get(s.bookId);
    const len = s.pageTo - s.pageFrom + 1;
    let inside = 0;
    for (let p = s.pageFrom; p <= s.pageTo; p++) if (set?.has(p)) inside++;
    if (inside / len >= 0.5) continue;

    // The module whose material comes right before this section in the same book.
    let target = 0;
    let best = -1;
    modules.forEach((m, mi) => {
      for (const sec of m.sections)
        for (const r of sec.refs) {
          const b = byId.get(r);
          if (b && b.bookId === s.bookId && b.pageFrom <= s.pageFrom && b.pageFrom > best) {
            best = b.pageFrom;
            target = mi;
          }
        }
    });
    modules[target].sections.push({ title: s.title, summary: "", refs: [s.id] });
    cover(s);
    added.push(s.title);
  }
  // Keep the sections of each module in book order where they have pages.
  for (const m of modules) {
    const first = (sec: ProgramSection) => Math.min(...sec.refs.map((r) => byId.get(r)?.pageFrom ?? Infinity));
    const withPages = m.sections.map((sec, i) => ({ sec, i, p: first(sec) }));
    if (withPages.every((x) => x.p !== Infinity)) m.sections = withPages.sort((a, b) => a.p - b.p || a.i - b.i).map((x) => x.sec);
  }
  return added;
}

/** Ask the model for a program for this semester (books must be outlined already). */
export async function buildProgram(semesterId: number): Promise<Program> {
  const db = getDb();
  const sem = db.select().from(schema.semesters).where(eq(schema.semesters.id, semesterId)).get();
  if (!sem) throw new Error("Семестр не найден");
  const books = db
    .select()
    .from(schema.books)
    .where(and(eq(schema.books.semesterId, semesterId), eq(schema.books.status, "ready")))
    .orderBy(asc(schema.books.id))
    .all();
  const ids = books.map((b) => b.id);
  const sections = ids.length
    ? db
        .select({ id: schema.bookSections.id, bookId: schema.bookSections.bookId, level: schema.bookSections.level, title: schema.bookSections.title, pageFrom: schema.bookSections.pageFrom, pageTo: schema.bookSections.pageTo })
        .from(schema.bookSections)
        .where(inArray(schema.bookSections.bookId, ids))
        .all()
    : [];

  let outline = outlineText(ids, 2);
  if (outline.length > 80_000) outline = outlineText(ids, 1);
  const level = LEVELS[sem.level];
  const capacity = sem.weeks * sem.hoursPerWeek;
  const text = [
    sem.request ? `Что ученик хочет изучить: ${sem.request}` : "Ученик хочет пройти приложенные книги целиком.",
    `Уровень. ${level.depth}`,
    sem.goal ? `Цель ученика: ${sem.goal}` : "",
    `Время: ${sem.weeks} недель по ${sem.hoursPerWeek} ч — около ${capacity} часов.`,
    outline ? `Оглавления книг (id разделов — для refs):\n${outline}` : "Книг нет.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const r = await chatAs("strong", "semester-program", null, {
    system: PROGRAM_SYSTEM,
    messages: [{ role: "user", content: [{ type: "text", text }] }],
    maxTokens: 32000,
  });
  const program = parseProgram(jsonObject(r.content.filter(isText).map((b) => b.text).join("")), new Set(sections.map((s) => s.id)));
  if (!program) throw new Error("Модель не смогла составить программу. Попробуй ещё раз.");

  const main = new Set(books.filter((b) => b.role === "main" || b.role === "lectures").map((b) => b.id));
  const added = attachUncovered(program.modules, sections, main);
  if (added.length) {
    program.notes.push(
      `${added.length === 1 ? "Раздел учебника, который" : `${added.length} разделов учебника, которые`} модель пропустила, добавлены в программу автоматически: ${added.slice(0, 8).join("; ")}${added.length > 8 ? "…" : ""}.`,
    );
  }
  if (!program.title) program.title = sem.request || books[0]?.name.replace(/\.[^.]+$/, "") || "Семестр";
  return program;
}

export const MAP_SYSTEM = `Ты раскладываешь новую книгу по готовой программе семестра. Для каждого раздела программы (id вида "m12.3") перечисли разделы книги (id вида "s45"), которые подходят ему по содержанию: тот же материал, задачи к нему, другой взгляд на ту же тему. Раздел книги может подойти нескольким разделам программы; неподходящие пропусти.
Ответ — только JSON: {"m12.3": ["s45", "s46"], ...}`;

/**
 * A book added to a running semester: its sections are attached to the
 * program's sections, so module lessons read it too. The program itself does
 * not change. Returns how many program sections got new material.
 */
export async function mapBookToProgram(semesterId: number, bookId: number): Promise<number> {
  const db = getDb();
  const modules = db.select().from(schema.semesterModules).where(and(eq(schema.semesterModules.semesterId, semesterId), eq(schema.semesterModules.kind, "regular"))).orderBy(asc(schema.semesterModules.idx)).all();
  const secIds = new Set(db.select({ id: schema.bookSections.id }).from(schema.bookSections).where(eq(schema.bookSections.bookId, bookId)).all().map((r) => r.id));
  if (!modules.length || !secIds.size) return 0;
  const program = modules
    .map((m) => `Модуль «${m.title}»:\n${m.sections.map((s, i) => `  m${m.id}.${i + 1} ${s.title}${s.summary ? ` — ${s.summary}` : ""}`).join("\n")}`)
    .join("\n");
  const r = await chatAs("cheap", "semester-map-book", null, {
    system: MAP_SYSTEM,
    messages: [{ role: "user", content: [{ type: "text", text: `Программа:\n${program}\n\nНовая книга:\n${outlineText([bookId], 2)}` }] }],
    maxTokens: 8000,
  });
  const raw = jsonObject(r.content.filter(isText).map((b) => b.text).join(""));
  if (!raw || typeof raw !== "object") return 0;
  let changed = 0;
  for (const m of modules) {
    let touched = false;
    const sections = m.sections.map((s, i) => {
      const add = ((raw as Record<string, unknown>)[`m${m.id}.${i + 1}`] ?? []) as unknown[];
      const refs = (Array.isArray(add) ? add : []).map((x) => Number(String(x).replace(/^s/i, ""))).filter((n) => secIds.has(n) && !s.refs.includes(n));
      if (!refs.length) return s;
      touched = true;
      changed++;
      return { ...s, refs: [...s.refs, ...refs] };
    });
    if (touched) db.update(schema.semesterModules).set({ sections }).where(eq(schema.semesterModules.id, m.id)).run();
  }
  return changed;
}
