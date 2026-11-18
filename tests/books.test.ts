// Books: pages, outlines, sections and search.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-books-"));
process.env.TUTOR_DATA_DIR = dir;
process.env.TUTOR_SECRETS_FILE = path.join(dir, "secrets.json");
process.env.TUTOR_MOCK = "1";

let books: typeof import("@/server/books");

beforeAll(async () => {
  books = await import("@/server/books");
});

describe("textPages", () => {
  it("cuts text into fragments and turns Markdown headings into an outline", () => {
    const long = "Слово ".repeat(800);
    const { pages, headings } = books.textPages(`# Глава 1\n\n${long}\n\n## Пределы\n\n${long}\n\n# Глава 2\n\nКоротко.`);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(headings.map((h) => [h.title, h.level])).toEqual([
      ["Глава 1", 1],
      ["Пределы", 2],
      ["Глава 2", 1],
    ]);
    // Each heading points at the fragment that starts with it.
    for (const h of headings) expect(pages[h.page - 1]).toContain(h.title);
  });
});

describe("headingsOutline", () => {
  it("finds chapters and paragraphs and ignores running headers", () => {
    const pages = [
      "Предисловие\nтекст",
      "ГЛАВА 1\nДействительные числа\nтекст",
      "Глава 1. Действительные числа\n§ 1. Множества\nтекст",
      "Глава 1. Действительные числа\nтекст",
      "Глава 1. Действительные числа\n§ 2. Верхняя грань\nтекст",
      "Глава 1. Действительные числа\nтекст",
      "ГЛАВА 2\nПределы\nтекст",
      "Глава 2. Пределы\n§ 3. Предел последовательности\nтекст",
    ];
    const out = books.headingsOutline(pages);
    expect(out.map((o) => [o.level, o.page])).toEqual([
      [1, 2],
      [2, 3],
      [2, 5],
      [1, 7],
      [2, 8],
    ]);
    expect(out[0].title).toBe("Глава 1. Действительные числа");
  });

  it("returns nothing when there is no structure", () => {
    expect(books.headingsOutline(["просто текст", "ещё текст"])).toEqual([]);
  });
});

describe("table of contents", () => {
  it("finds the contents pages and the offset of printed page numbers", () => {
    const pages = ["Обложка", "ОГЛАВЛЕНИЕ\nГлава 1. Множества 1\nГлава 2. Функции 5\nГлава 3. Пределы 9\nГлава 4. Ряды 12", "Предисловие"];
    for (let i = 0; i < 20; i++) pages.push(`текст ${i}`);
    // Printed page 1 is PDF page 4, so the offset is 3.
    pages[3] = "Глава 1. Множества\nтекст";
    pages[7] = "Глава 2. Функции\nтекст";
    pages[11] = "Глава 3. Пределы\nтекст";
    expect(books.tocPages(pages)).toEqual([1]);
    const entries = [
      { title: "Глава 1. Множества", level: 1, page: 1 },
      { title: "Глава 2. Функции", level: 1, page: 5 },
      { title: "Глава 3. Пределы", level: 1, page: 9 },
    ];
    expect(books.pageOffset(entries, pages)).toBe(3);
  });
});

describe("toSections", () => {
  it("gives each section the pages up to the next one of its level", () => {
    const s = books.toSections(
      [
        { title: "Гл. 1", level: 1, page: 3 },
        { title: "§1", level: 2, page: 3 },
        { title: "§2", level: 2, page: 10 },
        { title: "Гл. 2", level: 1, page: 20 },
      ],
      30,
    );
    expect(s.map((x) => [x.title, x.page, x.pageTo])).toEqual([
      ["Гл. 1", 3, 19],
      ["§1", 3, 9],
      ["§2", 10, 19],
      ["Гл. 2", 20, 30],
    ]);
  });

  it("splits a long section without subsections and fixes level jumps", () => {
    const s = books.toSections([{ title: "Длинная", level: 2, page: 1 }], 70);
    expect(s[0]).toMatchObject({ title: "Длинная", level: 1, pageTo: 70 });
    expect(s.slice(1).map((x) => [x.page, x.pageTo])).toEqual([
      [1, 20],
      [21, 40],
      [41, 60],
      [61, 70],
    ]);
  });
});

describe("storing, reading and searching", () => {
  it("stores a text book, outlines it and finds words by their stem", async () => {
    const text = `# Пределы\n\nПредел последовательности — число, к которому она стремится.\n\n# Производная\n\nПроизводной функции называют предел отношения приращений.\n\n# Интеграл\n\nПервообразная и интеграл.`;
    const { id, bookmarks } = await books.storeBook({ semesterId: null, name: "конспект.md", role: "lectures", data: new TextEncoder().encode(text) });
    expect(bookmarks.length).toBe(3);
    expect(await books.outlineBook(id, bookmarks)).toBe("bookmarks");

    const outline = books.outlineText([id]);
    expect(outline).toContain("конспект.md");
    expect(outline).toMatch(/s\d+ Производная/);

    // "производная" finds "Производной" (prefix search).
    const hits = books.searchBooks([id], "производная");
    expect(hits.length).toBe(1);
    expect(hits[0].snippet).toMatch(/«Производн/);
    expect(books.readBookPages(id, hits[0].page, hits[0].page)).toContain("предел отношения");

    books.deleteBook(id);
    expect(books.searchBooks([id], "производная")).toEqual([]);
  });

  it("falls back to page chunks when a book has no structure", async () => {
    const plain = Array.from({ length: 40 }, (_, i) => `Абзац номер ${i}. ${"текст ".repeat(150)}`).join("\n\n");
    const { id, bookmarks } = await books.storeBook({ semesterId: null, name: "заметки.txt", role: "extra", data: new TextEncoder().encode(plain) });
    expect(await books.outlineBook(id, bookmarks)).toBe("pages");
  });

  it("refuses binary files that are not PDFs", async () => {
    await expect(books.storeBook({ semesterId: null, name: "x.bin", role: "main", data: new Uint8Array([1, 0, 2, 0]) })).rejects.toThrow(/не PDF/);
  });
});

describe("PDF", () => {
  it("reads pages and bookmarks of a real PDF and searches it", async () => {
    const data = new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", "book.pdf")));
    const { pages, bookmarks } = await books.readPdf(data);
    expect(pages.length).toBeGreaterThan(4);
    expect(bookmarks.map((b) => [b.level, b.title])).toEqual([
      [1, "Оглавление"],
      [1, "Глава 1. Множества"],
      [2, "§ 1.1. Операции"],
      [2, "§ 1.2. Отображения"],
      [1, "Глава 2. Пределы"],
      [2, "§ 2.1. Предел последовательности"],
      [2, "§ 2.2. Производная функции"],
    ]);
    // Bookmarks point at the pages where the headings really are.
    for (const b of bookmarks) expect(pages[b.page - 1]).toContain(b.title.split(". ").pop());

    const { id, bookmarks: bm } = await books.storeBook({ semesterId: null, name: "book.pdf", role: "main", data });
    expect(await books.outlineBook(id, bm)).toBe("bookmarks");
    const hit = books.searchBooks([id], "производной")[0];
    // The section runs over more than one page; any of them is a right answer.
    expect(hit.page).toBeGreaterThanOrEqual(bookmarks[6].page);
  });
});

describe("printed table of contents", () => {
  it("is read by the model and shifted onto PDF pages", async () => {
    const pages = ["Обложка", "СОДЕРЖАНИЕ\nГлава 1. Множества ....... 1\n§ 1. Операции ....... 2\nГлава 2. Функции ....... 6\nГлава 3. Пределы ....... 10"];
    for (let i = 0; i < 16; i++) pages.push(`текст ${i}`);
    pages[3] = "Глава 1. Множества\nтекст";
    pages[8] = "Глава 2. Функции\nтекст";
    pages[12] = "Глава 3. Пределы\nтекст";
    const entries = await books.tocOutline(pages);
    // Printed page 1 is PDF page 4.
    expect(entries.map((e) => [e.title, e.page])).toEqual([
      ["Глава 1. Множества", 4],
      ["§ 1. Операции", 5],
      ["Глава 2. Функции", 9],
      ["Глава 3. Пределы", 13],
    ]);
  });

  it("is not mistaken for headings", () => {
    const out = books.headingsOutline(["Оглавление\nГлава 1. Множества ....... 1\nГлава 2. Функции ....... 6", "Глава 1. Множества", "§ 1.1. Операции", "Глава 2. Функции"]);
    expect(out.map((o) => [o.title, o.level, o.page])).toEqual([
      ["Глава 1. Множества", 1, 2],
      ["§ 1.1. Операции", 2, 3],
      ["Глава 2. Функции", 1, 4],
    ]);
  });
});
