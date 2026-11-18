// Semesters against the scripted model: program building, coverage of the book, editing and approval.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-semester-"));
process.env.TUTOR_DATA_DIR = dir;
process.env.TUTOR_SECRETS_FILE = path.join(dir, "secrets.json");
process.env.TUTOR_MOCK = "1";

let sem: typeof import("@/server/semester");
let program: typeof import("@/server/semester/program");
let jobs: typeof import("@/server/jobs");

beforeAll(async () => {
  sem = await import("@/server/semester");
  program = await import("@/server/semester/program");
  jobs = await import("@/server/jobs");
});

const BOOK = `# Глава 1. Множества

Множество — совокупность объектов.

## Операции над множествами

Объединение и пересечение.

## Отображения

Отображение сопоставляет элементы.

# Глава 2. Пределы

## Предел последовательности

Число a называют пределом, если …

## Производная

Производной функции называют предел отношения приращений.`;

describe("parseProgram", () => {
  it("keeps refs only to known sections and fills gaps", () => {
    const p = program.parseProgram(
      {
        title: "Курс",
        estimate_hours: "40",
        prereqs: [{ key: "Функции и графики", title: "Функции" }, { title: "" }],
        parts: [{ title: "Часть 1", modules: [{ title: "М1", hours: 5, sections: [{ title: "Р1", refs: ["s1", "s99", 2] }] }, { title: "М2" }] }],
        notes: ["n"],
      },
      new Set([1, 2]),
    )!;
    expect(p.estimateHours).toBe(40);
    // Keys are made Latin; a Cyrillic key becomes a numbered one. Entries without a title are dropped.
    expect(p.prereqs).toEqual([{ key: "pre-1", title: "Функции", summary: "" }]);
    expect(p.modules[0]).toMatchObject({ part: "Часть 1", title: "М1", hours: 5, sections: [{ title: "Р1", refs: [1, 2] }] });
    // A module without sections gets one section named like the module.
    expect(p.modules[1].sections.map((s) => s.title)).toEqual(["М2"]);
    expect(program.parseProgram({ parts: [] }, new Set())).toBeNull();
  });
});

describe("attachUncovered", () => {
  const sections = [
    { id: 1, bookId: 1, level: 1, title: "Предисловие", pageFrom: 1, pageTo: 2 },
    { id: 2, bookId: 1, level: 1, title: "Глава 1", pageFrom: 3, pageTo: 20 },
    { id: 3, bookId: 1, level: 2, title: "§1", pageFrom: 3, pageTo: 10 },
    { id: 4, bookId: 1, level: 2, title: "§2", pageFrom: 11, pageTo: 20 },
    { id: 5, bookId: 1, level: 1, title: "Глава 2", pageFrom: 21, pageTo: 40 },
  ];

  it("adds left-out sections after the material that precedes them, skipping front matter", () => {
    const modules = [
      { part: "", title: "A", summary: "", hours: 4, sections: [{ title: "x", summary: "", refs: [3] }] },
      { part: "", title: "B", summary: "", hours: 4, sections: [{ title: "y", summary: "", refs: [5] }] },
    ];
    const added = program.attachUncovered(modules, sections, new Set([1]));
    expect(added).toEqual(["§2"]);
    expect(modules[0].sections.map((s) => s.title)).toEqual(["x", "§2"]);
    expect(modules[1].sections.map((s) => s.title)).toEqual(["y"]);
  });

  it("counts a chapter as covered by its pages", () => {
    const modules = [{ part: "", title: "A", summary: "", hours: 4, sections: [{ title: "все", summary: "", refs: [2, 5] }] }];
    expect(program.attachUncovered(modules, sections, new Set([1]))).toEqual([]);
  });

  it("ignores books that are not main", () => {
    const modules = [{ part: "", title: "A", summary: "", hours: 4, sections: [{ title: "x", summary: "", refs: [] }] }];
    expect(program.attachUncovered(modules, sections, new Set())).toEqual([]);
  });
});

describe("semester preparation", () => {
  it("reads the books, builds a program, lets it be edited and approved", async () => {
    const id = sem.createSemester({ request: "", level: "advanced", weeks: 8, hoursPerWeek: 5 });
    const bookId = await sem.addBook(id, "учебник.md", "main", new TextEncoder().encode(BOOK));
    expect(sem.startPreparation(id)).toBe(true);
    await jobs.waitJob(`semester:${id}`);

    const v = sem.getSemesterView(id);
    expect(v.error).toBeNull();
    expect(v.status).toBe("draft");
    expect(v.books).toMatchObject([{ id: bookId, status: "ready", outlineSource: "bookmarks" }]);
    expect(v.modules.map((m) => m.title)).toEqual(["Глава 1. Множества", "Глава 2. Пределы"]);
    expect(v.modules[1].sections.map((s) => s.title)).toEqual(["Предел последовательности", "Производная"]);
    expect(v.modules[1].sections[1].sources[0]).toMatchObject({ bookId, book: "учебник.md", title: "Производная" });
    expect(v.capacityHours).toBe(40);
    expect(v.prereqs.length).toBe(1);

    // Edit: drop the first module, merge everything into one.
    const m = v.modules[1];
    sem.saveProgram(id, [{ title: "Всё", hours: 7, sections: m.sections.map((s) => ({ title: s.title, refs: [...s.refs, 99999] })) }]);
    const after = sem.getSemesterView(id);
    expect(after.modules.map((x) => [x.title, x.hours])).toEqual([["Всё", 7]]);
    // Unknown refs are dropped.
    expect(after.modules[0].sections[0].refs).toEqual(m.sections[0].refs);
    expect(() => sem.saveProgram(id, [{ title: "", sections: [] }])).toThrow(/названия/);

    sem.approveProgram(id);
    expect(sem.getSemesterView(id).status).toBe("active");
    expect(() => sem.saveProgram(id, [{ title: "x", sections: [{ title: "y" }] }])).toThrow(/до начала/);
    expect(sem.listSemesters().find((s) => s.id === id)).toMatchObject({ status: "active", modules: 1, passed: 0 });
  });

  it("builds a program for a bare topic and suggests books", async () => {
    const id = sem.createSemester({ request: "Матанализ, полный курс", level: "base", weeks: 12, hoursPerWeek: 4 });
    sem.startPreparation(id);
    await jobs.waitJob(`semester:${id}`);
    const v = sem.getSemesterView(id);
    expect(v.status).toBe("draft");
    expect(v.modules.length).toBe(2);
    expect(v.recommended).toEqual(["(тест) Учебник"]);
  });

  it("reports when there is nothing to build from", async () => {
    const id = sem.createSemester({ request: "", level: "base", weeks: 4, hoursPerWeek: 4 });
    sem.startPreparation(id);
    await jobs.waitJob(`semester:${id}`);
    const v = sem.getSemesterView(id);
    expect(v.status).toBe("preparing");
    expect(v.error).toMatch(/Укажи тему/);
  });

  it("removing a book removes its sections from the program", async () => {
    const id = sem.createSemester({ request: "x", level: "base", weeks: 4, hoursPerWeek: 4 });
    const bookId = await sem.addBook(id, "a.md", "main", new TextEncoder().encode(BOOK));
    sem.startPreparation(id);
    await jobs.waitJob(`semester:${id}`);
    sem.removeBook(id, bookId);
    const v = sem.getSemesterView(id);
    expect(v.books).toEqual([]);
    expect(v.modules.every((m) => m.sections.every((s) => s.refs.length === 0))).toBe(true);
  });

  it("validates input", () => {
    expect(() => sem.createSemester({ level: "nope", weeks: 4, hoursPerWeek: 4 })).toThrow(/уровень/);
    expect(() => sem.createSemester({ weeks: 0, hoursPerWeek: 4 })).toThrow(/недель/);
  });
});

describe("books added to a draft", () => {
  it("are read without rebuilding the program", async () => {
    const id = sem.createSemester({ request: "Пределы", level: "base", weeks: 4, hoursPerWeek: 4 });
    sem.startPreparation(id);
    await jobs.waitJob(`semester:${id}`);
    const before = sem.getSemesterView(id).modules.map((m) => m.title);
    await sem.addBook(id, "доп.md", "extra", new TextEncoder().encode(BOOK));
    sem.startPreparation(id);
    await jobs.waitJob(`semester:${id}`);
    const v = sem.getSemesterView(id);
    expect(v.status).toBe("draft");
    expect(v.books[0].status).toBe("ready");
    expect(v.modules.map((m) => m.title)).toEqual(before);
  });
});
