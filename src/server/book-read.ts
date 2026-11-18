// Reading books for lessons: pages, sections and full-text search. Kept apart
// from books.ts (which calls the model to build outlines) so that the lesson
// tools can use it without pulling the model layer into their imports.
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import type { BookRole } from "./db/schema";

export const ROLE_LABEL: Record<BookRole, string> = {
  main: "основной учебник",
  problems: "задачник",
  lectures: "конспект лекций",
  extra: "дополнительно",
};

/** Front and back matter: not taught and not offered to the program. */
export const SERVICE_TITLE = /предислови|от автор|список литератур|^литература|библиограф|указатель|^оглавлени|^содержани|preface|bibliograph|^index|^contents|об авторе/i;
export const isServiceTitle = (title: string) => SERVICE_TITLE.test(title.replace(/^[\d.§\s]+/, "").trim());

// ---------------------------------------------------------------------------
// Reading for lessons
// ---------------------------------------------------------------------------

export const MAX_READ_PAGES = 8;
const MAX_READ_CHARS = 40_000;

/** Pages of a book as prompt text, at most MAX_READ_PAGES at a time. */
export function readBookPages(bookId: number, from: number, to: number): string {
  const db = getDb();
  const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get();
  if (!book) throw new Error(`Книги ${bookId} нет.`);
  const a = Math.max(1, Math.min(from, book.pages));
  const b = Math.min(book.pages, Math.max(a, to), a + MAX_READ_PAGES - 1);
  const rows = db
    .select()
    .from(schema.bookPages)
    .where(and(eq(schema.bookPages.bookId, bookId), sql`${schema.bookPages.page} between ${a} and ${b}`))
    .orderBy(asc(schema.bookPages.page))
    .all();
  let left = MAX_READ_CHARS;
  const out: string[] = [];
  for (const r of rows) {
    if (left <= 0) break;
    out.push(`[${book.format === "pdf" ? "стр." : "фрагмент"} ${r.page}]\n${r.text.slice(0, left)}`);
    left -= r.text.length;
  }
  const more = b < Math.min(to, book.pages) ? `\n\n(показаны страницы ${a}–${b}; дальше — следующим вызовом)` : "";
  return `«${book.name}», ${a}–${b} из ${book.pages}:\n\n${out.join("\n\n")}${more}`;
}

/** Section text within a character budget, for preparing modules. */
export function sectionText(sectionId: number, budget: number): string {
  const db = getDb();
  const s = db.select().from(schema.bookSections).where(eq(schema.bookSections.id, sectionId)).get();
  if (!s) return "";
  const rows = db
    .select()
    .from(schema.bookPages)
    .where(and(eq(schema.bookPages.bookId, s.bookId), sql`${schema.bookPages.page} between ${s.pageFrom} and ${s.pageTo}`))
    .orderBy(asc(schema.bookPages.page))
    .all();
  const full = rows.map((r) => `[стр. ${r.page}]\n${r.text}`).join("\n\n");
  return full.length > budget ? `${full.slice(0, budget)}\n… (раздел обрезан: показано ${budget} из ${full.length} символов)` : full;
}

/** FTS query: every word as a prefix (a crude stem for Russian endings), all words required. */
export function ftsQuery(q: string): string {
  const words = q
    .toLowerCase()
    .replace(/ё/g, "е")
    .match(/[\p{L}\p{N}]+/gu);
  if (!words) return "";
  return words
    .slice(0, 8)
    .map((w) => (w.length > 5 ? w.slice(0, w.length - 2) : w))
    .map((w) => `"${w}"*`)
    .join(" ");
}

export interface BookHit {
  bookId: number;
  book: string;
  page: number;
  snippet: string;
}

/** Search pages of the given books; best matches first. */
export function searchBooks(bookIds: number[], query: string, limit = 12): BookHit[] {
  const q = ftsQuery(query);
  if (!q || !bookIds.length) return [];
  const db = getDb();
  const rows = db.$client
    .prepare(
      `select p.book_id as bookId, b.name as book, p.page as page,
              snippet(book_pages_fts, 0, '«', '»', ' … ', 24) as snippet
       from book_pages_fts f
       join book_pages p on p.id = f.rowid
       join books b on b.id = p.book_id
       where book_pages_fts match ? and p.book_id in (${bookIds.map(() => "?").join(",")})
       order by bm25(book_pages_fts)
       limit ?`,
    )
    .all(q, ...bookIds, limit) as BookHit[];
  return rows.map((r) => ({ ...r, snippet: r.snippet.replace(/\s+/g, " ").trim() }));
}
