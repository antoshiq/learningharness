// Long sources for a semester: textbooks, problem books, lecture notes.
//
// A book is stored page by page (a PDF's own pages; for plain text, fragments
// of about the same size) and split into sections with page ranges. Lessons
// never get a whole book: they read the pages of their section and search the
// rest with full-text search.
//
// The table of contents is found by the cheapest method that works:
//   1. the PDF's bookmarks;
//   2. the printed table of contents, read by the model and matched to pages;
//   3. headings in the text ("Глава 3", "§ 2.1", "## …");
//   4. the model reading the top of every page;
//   5. plain chunks of pages.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { isServiceTitle, ROLE_LABEL } from "./book-read";
import { getDb, schema } from "./db";
import type { BookRole, OutlineSource } from "./db/schema";
import fs from "node:fs";
import path from "node:path";
import { isPdf } from "./extract";
import { looksScanned, ocrPdfPage } from "./ocr";
import { DATA_DIR } from "./paths";
import { chatAs } from "./llm";
import { isText } from "./llm/types";

export const MAX_BOOK_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_CHARS = 8_000_000;
/** Plain text is cut into fragments of about this size, at paragraph breaks. */
const FRAGMENT = 3500;
/** A section without subsections longer than this is split for lessons. */
const MAX_LEAF_PAGES = 30;
const SPLIT_PAGES = 20;


export interface OutlineEntry {
  title: string;
  level: number;
  /** 1-based page where it starts. */
  page: number;
}

export interface SectionRange extends OutlineEntry {
  pageTo: number;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const clean = (t: string) =>
  t
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Pages of a PDF and its bookmarks, if it has any. */
export async function readPdf(buf: Uint8Array): Promise<{ pages: string[]; bookmarks: OutlineEntry[] }> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  let doc;
  try {
    doc = await getDocumentProxy(new Uint8Array(buf));
  } catch (e) {
    throw new Error(`Не удалось открыть PDF: ${e instanceof Error ? e.message : e}`);
  }
  const r = await extractText(doc, { mergePages: false });
  // Pages without a text layer (scans) stay empty here; OCR fills them in later.
  const pages = (r.text as string[]).map(clean).map((t) => (looksScanned(t) ? "" : t));

  const bookmarks: OutlineEntry[] = [];
  try {
    type Item = { title: string; dest: string | unknown[] | null; items: Item[] };
    const outline = ((await doc.getOutline()) ?? []) as Item[];
    const pageOf = async (dest: Item["dest"]): Promise<number | null> => {
      try {
        const d = typeof dest === "string" ? await doc.getDestination(dest) : dest;
        if (!Array.isArray(d) || !d.length) return null;
        const ref = d[0];
        const idx = typeof ref === "number" ? ref : await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0]);
        return idx + 1;
      } catch {
        return null;
      }
    };
    const walk = async (items: Item[], level: number) => {
      for (const it of items) {
        if (bookmarks.length >= 1500) return;
        const page = await pageOf(it.dest);
        const title = (it.title ?? "").replace(/\s+/g, " ").trim();
        if (page && title) bookmarks.push({ title, level, page });
        if (level < 3 && it.items?.length) await walk(it.items, level + 1);
      }
    };
    await walk(outline, 1);
  } catch {
    /* no usable bookmarks */
  }
  return { pages, bookmarks };
}

/** Plain text cut into fragments at paragraph breaks, with Markdown headings as an outline. */
export function textPages(text: string): { pages: string[]; headings: OutlineEntry[] } {
  const paras = clean(text).split(/\n\s*\n/);
  const pages: string[] = [];
  const headings: OutlineEntry[] = [];
  let cur = "";
  const flush = () => {
    if (cur.trim()) pages.push(cur.trim());
    cur = "";
  };
  for (const p of paras) {
    const h = /^(#{1,3})\s+(.+)$/m.exec(p.trimStart());
    // A heading starts a new fragment, so its section begins on a page of its own.
    if (h && p.trimStart().startsWith("#")) {
      if (cur.length > FRAGMENT / 4) flush();
      headings.push({ title: h[2].trim().slice(0, 200), level: h[1].length, page: pages.length + 1 });
    } else if (cur.length + p.length > FRAGMENT) flush();
    // A single huge paragraph is cut hard.
    for (let s = p; s.length; s = s.slice(FRAGMENT)) {
      cur += (cur ? "\n\n" : "") + s.slice(0, FRAGMENT);
      if (s.length > FRAGMENT) flush();
    }
  }
  flush();
  return { pages, headings: headings.map((h) => ({ ...h, page: Math.min(h.page, Math.max(1, pages.length)) })) };
}

// ---------------------------------------------------------------------------
// Outline from the text itself
// ---------------------------------------------------------------------------

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();

const CHAPTER = /^(глава|chapter|часть|part|раздел|лекция|lecture|тема)\s+([0-9]+|[ivxlc]+)\b\.?\s*(.{0,100})$/i;
const PARAGRAPH = /^§\s*(\d+(?:\.\d+)*)\.?\s+(\S.{1,100})$/;
const NUMBERED = /^(\d+\.\d+(?:\.\d+)?)\.?\s+([A-ZА-ЯЁ].{2,90})$/;

/** Headings found at the top of pages; running headers (repeated on many pages) are ignored. */
export function headingsOutline(pages: string[]): OutlineEntry[] {
  const found: OutlineEntry[] = [];
  pages.forEach((text, i) => {
    const lines = text
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 12);
    for (let j = 0; j < lines.length; j++) {
      const l = lines[j];
      // Lines of a printed table of contents ("Глава 1 ....... 5") are not headings.
      if (l.length > 110 || /(\.{3,}|…|\s{3,})\s*\d{1,4}$/.test(l)) continue;
      let m = CHAPTER.exec(l);
      if (m) {
        // "Глава 3" with the name on the next line.
        const rest = m[3].trim() || (lines[j + 1] && lines[j + 1].length < 90 ? lines[j + 1] : "");
        found.push({ title: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}${rest ? `. ${rest}` : ""}`, level: 1, page: i + 1 });
        continue;
      }
      m = PARAGRAPH.exec(l);
      if (m) {
        // "§ 3" and "§ 1.3" are paragraphs; "§ 1.3.2" is a subsection.
        found.push({ title: `§ ${m[1]}. ${m[2]}`, level: m[1].split(".").length >= 3 ? 3 : 2, page: i + 1 });
        continue;
      }
      m = NUMBERED.exec(l);
      if (m && !/[.:;,]$/.test(m[2])) found.push({ title: `${m[1]} ${m[2]}`, level: m[1].split(".").length, page: i + 1 });
    }
  });
  // Running headers repeat a chapter's title on its pages: the first one is where it starts.
  const seen = new Set<string>();
  const out: OutlineEntry[] = [];
  for (const f of found) {
    const k = norm(f.title);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  const chapters = out.filter((o) => o.level === 1).length;
  const sections = out.filter((o) => o.level > 1).length;
  return chapters >= 2 || sections >= 4 ? out : [];
}

// ---------------------------------------------------------------------------
// Outline with the model's help
// ---------------------------------------------------------------------------

/** Pages that look like the printed table of contents (at the start or the end of the book). */
export function tocPages(pages: string[]): number[] {
  const near = [...Array(Math.min(30, pages.length)).keys(), ...[...Array(Math.min(25, pages.length)).keys()].map((i) => pages.length - 1 - i)];
  const start = [...new Set(near)].sort((a, b) => a - b).find((i) => /(^|\n)\s*(оглавление|содержание|contents|table of contents)\s*(\n|$)/i.test(pages[i]));
  if (start === undefined) return [];
  const out: number[] = [];
  // The table runs over the following pages while they keep listing page numbers.
  for (let i = start; i < pages.length && out.length < 12; i++) {
    const numbered = pages[i].split("\n").filter((l) => /\s\d{1,4}\s*$/.test(l.trim())).length;
    if (i > start && numbered < 4) break;
    out.push(i);
  }
  return out;
}

/** The PDF page offset of printed page numbers: where the titles actually appear. */
export function pageOffset(entries: OutlineEntry[], pages: string[]): number {
  const votes = new Map<number, number>();
  for (const e of entries.slice(0, 60)) {
    const key = norm(e.title).replace(/^(глава|chapter|часть|§)\s*/, "").slice(0, 28);
    if (key.length < 6) continue;
    for (let p = 0; p < pages.length; p++) {
      if (norm(pages[p].slice(0, 600)).includes(key)) {
        const off = p + 1 - e.page;
        if (Math.abs(off) <= 60) votes.set(off, (votes.get(off) ?? 0) + 1);
      }
    }
  }
  let best = 0;
  let bestVotes = 0;
  for (const [off, v] of votes) if (v > bestVotes || (v === bestVotes && Math.abs(off) < Math.abs(best))) [best, bestVotes] = [off, v];
  return best;
}

function parseEntries(text: string): OutlineEntry[] {
  const m = /\[[\s\S]*\]/.exec(text);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]) as { title?: unknown; level?: unknown; page?: unknown }[];
    return arr
      .filter((e) => typeof e.title === "string" && Number.isFinite(Number(e.page)))
      .map((e) => ({
        title: String(e.title).replace(/\s+/g, " ").trim().slice(0, 200),
        level: Math.min(3, Math.max(1, Math.round(Number(e.level) || 1))),
        page: Math.round(Number(e.page)),
      }))
      .filter((e) => e.title);
  } catch {
    return [];
  }
}

const OUTLINE_SYSTEM = `Ты извлекаешь оглавление книги. Верни только JSON-массив без пояснений: [{"title": "...", "level": 1, "page": 12}, ...].
level: 1 — часть или глава, 2 — параграф или раздел, 3 — подраздел. Глубже третьего уровня не нужно.
Пропускай предисловие, список литературы, предметный указатель и прочие служебные разделы. Названия пиши как в книге, с номерами.`;

async function askOutline(purpose: string, text: string): Promise<OutlineEntry[]> {
  const r = await chatAs("cheap", purpose, null, {
    system: OUTLINE_SYSTEM,
    messages: [{ role: "user", content: [{ type: "text", text }] }],
    maxTokens: 16000,
  });
  return parseEntries(r.content.filter(isText).map((b) => b.text).join(""));
}

/** The printed table of contents, read by the model and shifted onto PDF pages. */
export async function tocOutline(pages: string[]): Promise<OutlineEntry[]> {
  const idx = tocPages(pages);
  if (!idx.length) return [];
  const text = idx.map((i) => `[стр. ${i + 1}]\n${pages[i]}`).join("\n\n").slice(0, 40_000);
  const entries = await askOutline("book-toc", `Ниже страницы оглавления книги. Номера страниц в ответе — как напечатаны в оглавлении.\n\n${text}`);
  if (entries.length < 3) return [];
  const off = pageOffset(entries, pages);
  return entries.map((e) => ({ ...e, page: e.page + off })).filter((e) => e.page >= 1 && e.page <= pages.length);
}

/** The model reads the top of every page and lists where chapters and sections begin. */
async function modelOutline(pages: string[]): Promise<OutlineEntry[]> {
  const out: OutlineEntry[] = [];
  const WINDOW = 120;
  for (let from = 0; from < pages.length; from += WINDOW) {
    const text = pages
      .slice(from, from + WINDOW)
      .map((p, i) => `[стр. ${from + i + 1}] ${p.slice(0, 300).replace(/\s+/g, " ")}`)
      .join("\n");
    const entries = await askOutline(
      "book-outline",
      `Ниже начало каждой страницы книги (страницы ${from + 1}–${Math.min(pages.length, from + WINDOW)}). Найди, где начинаются главы и разделы. Номер страницы — из пометки [стр. N].\n\n${text}`,
    );
    out.push(...entries.filter((e) => e.page > from && e.page <= from + WINDOW));
  }
  return out;
}

/** Ranges of plain page chunks, when nothing else worked. */
export function pageChunks(total: number, size = SPLIT_PAGES): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  for (let p = 1; p <= total; p += size) out.push({ title: `Страницы ${p}–${Math.min(total, p + size - 1)}`, level: 1, page: p });
  return out;
}

/**
 * Sorted sections with page ranges: each runs until the next section of the
 * same or a higher level. Long sections without subsections are split.
 */
export function toSections(entries: OutlineEntry[], total: number): SectionRange[] {
  let list = entries
    .filter((e) => e.page >= 1 && e.page <= total && e.title.trim())
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => a.page - b.page || a.i - b.i);
  if (list.length > 600) list = list.filter((e) => e.level < 3);
  // Levels must not jump (a chapter's first child is level 2, not 3).
  let prev = 0;
  const leveled = list.map((e) => {
    const level = Math.min(e.level, prev + 1);
    prev = level;
    return { title: e.title, level, page: e.page };
  });

  const ranged: SectionRange[] = leveled.map((e, i) => {
    let to = total;
    for (let j = i + 1; j < leveled.length; j++) {
      if (leveled[j].level <= e.level) {
        to = Math.max(e.page, leveled[j].page - 1);
        break;
      }
    }
    return { ...e, pageTo: to };
  });
  // Front matter before the first section is not taught; long leaves are split.
  const out: SectionRange[] = [];
  ranged.forEach((s, i) => {
    const leaf = !(ranged[i + 1] && ranged[i + 1].level > s.level);
    const len = s.pageTo - s.page + 1;
    if (!leaf || len <= MAX_LEAF_PAGES) {
      out.push(s);
      return;
    }
    out.push(s);
    for (let p = s.page, k = 1; p <= s.pageTo; p += SPLIT_PAGES, k++) {
      out.push({ title: `${s.title} (ч. ${k})`, level: Math.min(3, s.level + 1), page: p, pageTo: Math.min(s.pageTo, p + SPLIT_PAGES - 1) });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Storing
// ---------------------------------------------------------------------------

export interface BookInput {
  semesterId: number | null;
  name: string;
  role: BookRole;
  data: Uint8Array;
}

/** First step: read the file and store its pages. Fast and model-free; the outline comes later. */
/** Where a book's original file is kept. */
export const bookFile = (id: number, format: "pdf" | "text") => path.join(DATA_DIR, "books", `${id}.${format === "pdf" ? "pdf" : "txt"}`);

export async function storeBook(input: BookInput): Promise<{ id: number; bookmarks: OutlineEntry[] }> {
  if (input.data.length > MAX_BOOK_BYTES) throw new Error(`${input.name} больше 100 МБ.`);
  const name = input.name.replace(/[\\/]/g, "_").slice(0, 200) || "книга";
  let pages: string[];
  let bookmarks: OutlineEntry[] = [];
  let format: "pdf" | "text";
  if (isPdf(input.data)) {
    ({ pages, bookmarks } = await readPdf(input.data));
    format = "pdf";
  } else {
    if (input.data.subarray(0, 8000).includes(0)) throw new Error(`${name}: это не PDF и не текстовый файл.`);
    const text = Buffer.from(input.data).toString("utf8");
    if (text.length > MAX_TEXT_CHARS) throw new Error(`${name}: слишком много текста.`);
    const t = textPages(text);
    pages = t.pages;
    bookmarks = t.headings;
    format = "text";
  }
  if (!pages.length) throw new Error(`${name}: в файле нет текста.`);
  const scanned = pages.filter((p) => !p).length;

  const db = getDb();
  const id = db.transaction((tx) => {
    const row = tx
      .insert(schema.books)
      .values({
        semesterId: input.semesterId,
        name,
        role: input.role,
        format,
        pages: pages.length,
        chars: pages.reduce((n, p) => n + p.length, 0),
        // Scanned pages are recognized before the outline is looked for.
        status: scanned ? "ocr" : "outlining",
        ocrTotal: scanned,
        bookmarks,
        createdAt: Date.now(),
      })
      .returning({ id: schema.books.id })
      .get();
    for (let i = 0; i < pages.length; i += 200) {
      tx.insert(schema.bookPages)
        .values(pages.slice(i, i + 200).map((text, k) => ({ bookId: row.id, page: i + k + 1, text, ocr: text ? 0 : 1 })))
        .run();
    }
    return row.id;
  });
  // The original stays on disk: the page viewer shows it and OCR reads its pictures.
  const file = bookFile(id, format);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, input.data);
  db.update(schema.books).set({ file: path.basename(file) }).where(eq(schema.books.id, id)).run();
  return { id, bookmarks };
}

/**
 * Recognize the scanned pages of a book, one page at a time, saving each as it
 * is done: interrupted work goes on from where it stopped. Then the book goes on
 * to the outline step.
 */
export async function ocrBook(bookId: number, onProgress?: (done: number, total: number) => void): Promise<void> {
  const db = getDb();
  const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
  if (!book) throw new Error("Книга не найдена");
  const waiting = db
    .select({ id: schema.bookPages.id, page: schema.bookPages.page })
    .from(schema.bookPages)
    .where(and(eq(schema.bookPages.bookId, bookId), eq(schema.bookPages.ocr, 1)))
    .orderBy(asc(schema.bookPages.page))
    .all();
  if (waiting.length) {
    if (!book.file) throw new Error("Исходный файл книги не сохранился: загрузи её заново.");
    const { getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(fs.readFileSync(path.join(DATA_DIR, "books", book.file))));
    let done = book.ocrTotal - waiting.length;
    for (const w of waiting) {
      onProgress?.(done, book.ocrTotal);
      let text = "";
      try {
        text = clean(await ocrPdfPage(doc, w.page));
      } catch {
        // A page that cannot be read stays empty; the rest of the book is still useful.
      }
      done++;
      db.transaction((tx) => {
        tx.update(schema.bookPages).set({ text, ocr: 2 }).where(eq(schema.bookPages.id, w.id)).run();
        tx.update(schema.books).set({ ocrDone: done }).where(eq(schema.books.id, bookId)).run();
      });
    }
    await doc.destroy();
  }
  const chars = db
    .select({ n: sql<number>`coalesce(sum(length(${schema.bookPages.text})), 0)` })
    .from(schema.bookPages)
    .where(eq(schema.bookPages.bookId, bookId))
    .get()!.n;
  if (chars < 200) {
    db.update(schema.books).set({ status: "error", error: "Не удалось распознать текст: страницы пустые или слишком плохого качества.", chars }).where(eq(schema.books.id, bookId)).run();
    return;
  }
  db.update(schema.books).set({ status: "outlining", chars }).where(eq(schema.books.id, bookId)).run();
}

export function bookPagesText(bookId: number): string[] {
  return getDb()
    .select({ text: schema.bookPages.text })
    .from(schema.bookPages)
    .where(eq(schema.bookPages.bookId, bookId))
    .orderBy(asc(schema.bookPages.page))
    .all()
    .map((r) => r.text);
}

/** Second step: find the outline (possibly with the model) and save the sections. */
export async function outlineBook(bookId: number, onStep?: (text: string) => void): Promise<OutlineSource> {
  const db = getDb();
  const pages = bookPagesText(bookId);
  const bookmarks = db.select({ b: schema.books.bookmarks }).from(schema.books).where(eq(schema.books.id, bookId)).get()?.b ?? [];
  let entries: OutlineEntry[] = [];
  let source: OutlineSource = "pages";
  const tries: [OutlineSource, string, () => Promise<OutlineEntry[]> | OutlineEntry[]][] = [
    ["bookmarks", "Читаю закладки", () => bookmarks],
    ["toc", "Читаю оглавление", () => tocOutline(pages)],
    ["headings", "Ищу заголовки в тексте", () => headingsOutline(pages)],
    ["model", "Модель просматривает страницы", () => modelOutline(pages)],
  ];
  for (const [src, label, fn] of tries) {
    onStep?.(label);
    try {
      const got = await fn();
      if (got.filter((e) => e.page >= 1 && e.page <= pages.length).length >= 3) {
        entries = got;
        source = src;
        break;
      }
    } catch (e) {
      // A failed model call falls through to the next method; a spending cap stops everything.
      if (e instanceof Error && /лимит/i.test(e.message)) throw e;
    }
  }
  if (!entries.length) entries = pageChunks(pages.length);

  const sections = toSections(entries, pages.length);
  db.transaction((tx) => {
    tx.delete(schema.bookSections).where(eq(schema.bookSections.bookId, bookId)).run();
    if (sections.length) {
      tx.insert(schema.bookSections)
        .values(sections.map((s, idx) => ({ bookId, idx, level: s.level, title: s.title, pageFrom: s.page, pageTo: s.pageTo })))
        .run();
    }
    tx.update(schema.books).set({ status: "ready", outlineSource: source, error: null, bookmarks: null }).where(eq(schema.books.id, bookId)).run();
  });
  return source;
}

export function deleteBook(bookId: number) {
  const db = getDb();
  const book = db.select({ file: schema.books.file }).from(schema.books).where(eq(schema.books.id, bookId)).get();
  if (book?.file) fs.rmSync(path.join(DATA_DIR, "books", book.file), { force: true });
  db.transaction((tx) => {
    tx.delete(schema.bookSections).where(eq(schema.bookSections.bookId, bookId)).run();
    tx.delete(schema.bookPages).where(eq(schema.bookPages.bookId, bookId)).run();
    tx.delete(schema.books).where(eq(schema.books.id, bookId)).run();
  });
}

export * from "./book-read";

/** Compact outline of books for prompts: one line per section with its id and pages. */
export function outlineText(bookIds: number[], maxLevel = 2): string {
  if (!bookIds.length) return "";
  const db = getDb();
  const bookRows = db.select().from(schema.books).where(inArray(schema.books.id, bookIds)).all();
  const out: string[] = [];
  for (const b of bookRows) {
    out.push(`Книга b${b.id}: «${b.name}» (${ROLE_LABEL[b.role]}, ${b.pages} ${b.format === "pdf" ? "стр." : "фрагм."})`);
    const secs = db
      .select()
      .from(schema.bookSections)
      .where(and(eq(schema.bookSections.bookId, b.id), sql`${schema.bookSections.level} <= ${maxLevel}`))
      .orderBy(asc(schema.bookSections.idx))
      .all();
    for (const s of secs.filter((x) => !isServiceTitle(x.title))) out.push(`${"  ".repeat(s.level - 1)}s${s.id} ${s.title} (стр. ${s.pageFrom}–${s.pageTo})`);
  }
  return out.join("\n");
}
