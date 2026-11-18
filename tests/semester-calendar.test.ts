// Semester calendar, today's tasks, homework and books added to a running semester.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-semcal-"));
process.env.TUTOR_DATA_DIR = dir;
process.env.TUTOR_SECRETS_FILE = path.join(dir, "secrets.json");
process.env.TUTOR_MOCK = "1";

let sem: typeof import("@/server/semester");
let mods: typeof import("@/server/semester/modules");
let cal: typeof import("@/server/semester/calendar");
let hw: typeof import("@/server/semester/homework");
let jobs: typeof import("@/server/jobs");
let dbmod: typeof import("@/server/db");

beforeAll(async () => {
  sem = await import("@/server/semester");
  mods = await import("@/server/semester/modules");
  cal = await import("@/server/semester/calendar");
  hw = await import("@/server/semester/homework");
  jobs = await import("@/server/jobs");
  dbmod = await import("@/server/db");
});

const DAY = 86_400_000;
type Row = Parameters<typeof cal.layout>[0][number];
const mod = (id: number, hours: number, kind: "regular" | "prereq" = "regular", credit: Row["credit"] = null): Row => ({
  id,
  semesterId: 1,
  idx: id,
  part: "",
  title: `M${id}`,
  summary: "",
  hours,
  kind,
  sections: [],
  topicId: null,
  guide: null,
  preparedAt: null,
  credit,
  passedAt: null,
});

describe("calendar", () => {
  const start = new Date(2026, 8, 1).getTime();

  it("lays modules over weeks by hours, keeps the last week for the final, puts the midterm after half", () => {
    const weeks = cal.layout([mod(0, 2, "prereq"), mod(1, 6), mod(2, 6), mod(3, 6), mod(4, 6)], 6, 6, start);
    expect(weeks.map((w) => w.moduleIds)).toEqual([[0], [1], [2], [3], [4], []]);
    expect(weeks.findIndex((w) => w.midterm)).toBe(3);
    expect(weeks[5].final).toBe(true);
  });

  it("squeezes a program bigger than the time into the learning weeks", () => {
    const weeks = cal.layout([mod(1, 20), mod(2, 20), mod(3, 20)], 3, 5, start);
    expect(weeks.flatMap((w) => w.moduleIds)).toEqual([1, 2, 3]);
    expect(weeks[2].moduleIds).toEqual([]);
  });

  it("measures the pace against the plan", () => {
    const rows = [mod(1, 6), mod(2, 6), mod(3, 6)];
    const s = { weeks: 4, hoursPerWeek: 6, startDate: start };
    // Third week: two modules should be closed.
    const now = start + 15 * DAY;
    expect(cal.calendar(rows, s, now)).toMatchObject({ currentWeek: 3, expectedPassed: 2, passed: 0, pace: "behind" });
    expect(cal.calendar([mod(1, 6, "regular", "exam"), mod(2, 6, "regular", "exam"), mod(3, 6, "regular", "early")], s, now).pace).toBe("ok");
    expect(cal.calendar([mod(1, 6, "regular", "exam"), mod(2, 6), mod(3, 6)], s, start + 2 * DAY).pace).toBe("ahead");
    expect(cal.calendar(rows, s, start - DAY).currentWeek).toBe(0);
    expect(cal.calendar(rows, s, start + 40 * DAY)).toMatchObject({ currentWeek: 5, pace: "late" });
  });
});

const BOOK = `# Глава 1. Пределы

## Предел последовательности

Число a называют пределом последовательности.

# Глава 2. Производная

## Определение производной

Производной называют предел отношения приращений.`;

async function running() {
  const id = sem.createSemester({ request: "Матанализ", level: "base", weeks: 4, hoursPerWeek: 6 });
  await sem.addBook(id, "учебник.md", "main", new TextEncoder().encode(BOOK));
  sem.startPreparation(id);
  await jobs.waitJob(`semester:${id}`);
  sem.approveProgram(id);
  await jobs.waitJob(`semester-modules:${id}`);
  return id;
}

describe("today's tasks", () => {
  it("start with the placement test, then lessons, then homework", async () => {
    const id = await running();
    let v = sem.getSemesterView(id);
    expect(v.active!.today.map((t) => t.kind)).toEqual(["placement"]);
    mods.recordAssessment(id, { kind: "placement", moduleId: v.modules[0].id, score: 100 });
    await jobs.waitJob(`semester-modules:${id}`);
    v = sem.getSemesterView(id);
    expect(v.active!.today[0]).toMatchObject({ kind: "learn", title: "Урок: Глава 1. Пределы" });
    // Homework appears once a module is being studied.
    expect(v.active!.today.some((t) => t.kind === "new-homework")).toBe(false);
    const topicId = v.modules[1].topicId!;
    dbmod.getDb().update(dbmod.schema.nodes).set({ status: "learning" }).where(eq(dbmod.schema.nodes.topicId, topicId)).run();
    expect(sem.getSemesterView(id).active!.today.some((t) => t.kind === "new-homework")).toBe(true);
    expect(sem.activeSemesters().find((s) => s.id === id)).toMatchObject({ week: 1, weeks: 4 });
  });
});

describe("homework", () => {
  it("is written once a week, graded against its rubric and goes to the grade book", async () => {
    const id = await running();
    const v = sem.getSemesterView(id);
    mods.recordAssessment(id, { kind: "placement", moduleId: v.modules[0].id, score: 100 });
    await jobs.waitJob(`semester-modules:${id}`);
    await expect(hw.createHomework(id)).rejects.toThrow(/первый модуль/);
    dbmod.getDb().update(dbmod.schema.nodes).set({ status: "learning" }).where(eq(dbmod.schema.nodes.topicId, sem.getSemesterView(id).modules[1].topicId!)).run();

    const h = await hw.createHomework(id);
    expect(h).toMatchObject({ week: 1, status: "open", rubric: [{ criterion: "Верная идея", points: 6 }, { criterion: "Аккуратное оформление", points: 4 }] });
    expect((await hw.createHomework(id)).id).toBe(h.id);

    await expect(hw.submitHomework(id, h.id, "коротко")).rejects.toThrow(/короткий/);
    const graded = await hw.submitHomework(id, h.id, "Сложение коммутативно по определению натуральных чисел, индукцией по b.");
    // 6 + 2 of 10.
    expect(graded.review).toMatchObject({ total: 80, feedback: "(тест) Хорошо." });
    await expect(hw.submitHomework(id, h.id, "ещё раз то же самое, но длиннее двадцати")).rejects.toThrow(/уже проверено/);
    const after = sem.getSemesterView(id).active!;
    expect(after.homework).toEqual([{ id: h.id, week: 1, title: "(тест) Домашнее задание", status: "graded", score: 80 }]);
    expect(after.grade).toMatchObject({ pct: 80, mark: 4 });
  });
});

describe("a book added to a running semester", () => {
  it("is read and attached to the program's sections without changing the program", async () => {
    const id = await running();
    const before = sem.getSemesterView(id).modules.map((m) => m.title);
    const bookId = await sem.addBook(id, "задачник.md", "problems", new TextEncoder().encode("# Задачи к главе 1\n\nНайдите предел.\n\n# Задачи к главе 2\n\nНайдите производную."));
    sem.startPreparation(id);
    await jobs.waitJob(`semester:${id}`);
    const v = sem.getSemesterView(id);
    expect(v.modules.map((m) => m.title)).toEqual(before);
    const first = v.modules.find((m) => m.kind === "regular")!.sections[0];
    expect(first.sources.some((s) => s.bookId === bookId)).toBe(true);
    expect(v.books.find((b) => b.id === bookId)!.status).toBe("ready");
  });
});
