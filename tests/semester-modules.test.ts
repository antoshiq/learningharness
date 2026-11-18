// Semester modules against the scripted model: preparation, lessons from the book, gates, exams, grades.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-semmod-"));
process.env.TUTOR_DATA_DIR = dir;
process.env.TUTOR_SECRETS_FILE = path.join(dir, "secrets.json");
process.env.TUTOR_MOCK = "1";

let sem: typeof import("@/server/semester");
let mods: typeof import("@/server/semester/modules");
let jobs: typeof import("@/server/jobs");
let tools: typeof import("@/server/agent/tools");
let state: typeof import("@/server/agent/state");
let sessions: typeof import("@/server/sessions");
let dbmod: typeof import("@/server/db");

beforeAll(async () => {
  sem = await import("@/server/semester");
  mods = await import("@/server/semester/modules");
  jobs = await import("@/server/jobs");
  tools = await import("@/server/agent/tools");
  state = await import("@/server/agent/state");
  sessions = await import("@/server/sessions");
  dbmod = await import("@/server/db");
});

const BOOK = `# Глава 1. Пределы

## Предел последовательности

Число a называют пределом последовательности, если для любого ε найдётся номер N.

## Предел функции

Предел функции по Коши и по Гейне.

# Глава 2. Производная

## Определение производной

Производной функции называют предел отношения приращения функции к приращению аргумента.

## Правила дифференцирования

Производная суммы равна сумме производных.`;

async function startedSemester() {
  const id = sem.createSemester({ request: "Матанализ", level: "standard", weeks: 8, hoursPerWeek: 5 });
  await sem.addBook(id, "учебник.md", "main", new TextEncoder().encode(BOOK));
  sem.startPreparation(id);
  await jobs.waitJob(`semester:${id}`);
  sem.approveProgram(id);
  await jobs.waitJob(`semester-modules:${id}`);
  return id;
}

const ctxFor = (topicId: number) => {
  const db = dbmod.getDb();
  const sessionId = sessions.createSession({ topicId, kind: "lesson" });
  const session = db.select().from(dbmod.schema.sessions).all().find((s) => s.id === sessionId)!;
  const topic = db.select().from(dbmod.schema.topics).all().find((t) => t.id === topicId)!;
  return { db, session, topic };
};

describe("modules of a running semester", () => {
  it("open one after another, starting with the zero module", async () => {
    const id = await startedSemester();
    const v = sem.getSemesterView(id);
    expect(v.modules.map((m) => [m.kind, m.status])).toEqual([
      ["prereq", "open"],
      ["regular", "locked"],
      ["regular", "locked"],
    ]);
    // The open module and the next one are prepared ahead.
    expect(v.modules[0].prepared && v.modules[1].prepared).toBe(true);
    expect(v.modules[2].prepared).toBe(false);
    expect(v.modules[1].ideas!.total).toBe(4);
    expect(v.active!.threshold).toBe(85);
    await expect(mods.buildAssessment(id, "checkpoint", v.modules[1].id)).rejects.toThrow(/закрыт/);
  });

  it("placement test: strong prerequisites count as known, weak ones are learned in the zero module", async () => {
    const id = await startedSemester();
    const zero = sem.getSemesterView(id).modules[0];
    const exam = await mods.buildAssessment(id, "placement", zero.id);
    expect(exam.items.length).toBeGreaterThan(0);
    expect(exam.threshold).toBe(70);

    const r = mods.recordAssessment(id, { kind: "placement", moduleId: zero.id, score: 40, details: [{ key: `${zero.topicId}:functions`, title: "Функции", got: 2, total: 2 }] });
    expect(r.passed).toBe(false);
    let v = sem.getSemesterView(id);
    expect(v.modules[0].status).toBe("open");
    expect(v.modules[0].ideas!.checked).toBe(1);
    // A failed placement test cannot be retaken right away.
    await expect(mods.buildAssessment(id, "placement", zero.id)).rejects.toThrow(/Пересдача/);

    // The zero module is closed by its own checkpoint.
    mods.recordAssessment(id, { kind: "checkpoint", moduleId: zero.id, score: 100 });
    v = sem.getSemesterView(id);
    expect(v.modules.map((m) => m.status)).toEqual(["passed", "open", "locked"]);
    expect(v.modules[0].credit).toBe("exam");
  });

  it("lessons read and search the book and keep the module's ideas", async () => {
    const id = await startedSemester();
    const m1 = sem.getSemesterView(id).modules[1];
    const ctx = ctxFor(m1.topicId!);
    const bookId = sem.getSemesterView(id).books[0].id;

    expect(tools.toolDefs("topic", true).map((t) => t.name)).toContain("read_book");
    expect(tools.toolDefs("topic").map((t) => t.name)).not.toContain("read_book");
    expect(tools.semesterBookIds(ctx.db, ctx.topic)).toEqual([bookId]);

    const found = tools.executeTool(ctx, "search_book", "t1", { query: "производной" });
    expect(found.content).toMatch(new RegExp(`b${bookId} «учебник.md», стр\\. \\d+`));
    const page = Number(/стр\. (\d+)/.exec(found.content)![1]);
    expect(tools.executeTool(ctx, "read_book", "t2", { book_id: bookId, page_from: page, page_to: page }).content).toContain("предел отношения");
    expect(tools.executeTool(ctx, "read_book", "t3", { book_id: 9999, page_from: 1, page_to: 1 }).isError).toBe(true);

    // The plan may grow, but ideas of the program cannot be dropped or declared known.
    const plan = state.planView(ctx.db, m1.topicId!);
    const dropped = tools.executeTool(ctx, "set_plan", "t4", { nodes: plan.slice(1).map((n) => ({ key: n.key, title: n.title, deps: n.deps.filter((d) => d !== plan[0].key) })) });
    expect(dropped.isError).toBe(true);
    expect(dropped.content).toMatch(/убирать нельзя/);
    const grown = tools.executeTool(ctx, "set_plan", "t5", { nodes: [...plan.map((n) => ({ key: n.key, title: n.title, deps: n.deps, known: true })), { key: "extra", title: "Доп. пример" }] });
    expect(grown.isError).toBeFalsy();
    expect(state.planView(ctx.db, m1.topicId!).every((n) => n.status === "new")).toBe(true);

    // The lesson is told where the module sits and which pages to read.
    const text = state.initialState(ctx.db, ctx.session.id);
    expect(text).toContain("Это модуль 1 семестра");
    expect(text).toMatch(new RegExp(`«учебник.md» \\(b${bookId}\\), стр\\. \\d+–\\d+`));
    expect(text).toContain("read_book");
    expect(text).toContain("Путеводитель");
  });

  it("checkpoint: a failed one waits for a retake, a pass closes the module (early if not all ideas were learned)", async () => {
    const id = await startedSemester();
    let v = sem.getSemesterView(id);
    mods.recordAssessment(id, { kind: "checkpoint", moduleId: v.modules[0].id, score: 100 });
    const m1 = v.modules[1];

    expect(mods.recordAssessment(id, { kind: "checkpoint", moduleId: m1.id, score: 60 }).passed).toBe(false);
    await expect(mods.buildAssessment(id, "checkpoint", m1.id)).rejects.toThrow(/Пересдача/);
    v = sem.getSemesterView(id);
    expect(v.modules[1].checkpoint).toMatchObject({ best: 60, tries: 1 });
    expect(v.modules[1].checkpoint!.nextTryAt).toBeGreaterThan(Date.now());

    // Retake after the pause.
    dbmod.getDb().update(dbmod.schema.semesterAssessments).set({ createdAt: Date.now() - 2 * 86_400_000 }).run();
    const exam = await mods.buildAssessment(id, "checkpoint", m1.id);
    expect(exam.title).toContain("Контрольная");
    expect(mods.recordAssessment(id, { kind: "checkpoint", moduleId: m1.id, score: 90 }).passed).toBe(true);
    v = sem.getSemesterView(id);
    expect(v.modules[1]).toMatchObject({ status: "passed", credit: "early" });
    expect(v.modules[1].ideas!.checked).toBe(v.modules[1].ideas!.total);
    expect(v.modules[2].status).toBe("open");
    expect(v.active!.progress).toBe(50);
  });

  it("the final exam opens when every module is closed and finishes the semester", async () => {
    const id = await startedSemester();
    let v = sem.getSemesterView(id);
    expect(v.active!.midterm.reason).toMatch(/короткий/);
    expect(v.active!.final.available).toBe(false);
    for (const m of v.modules) {
      mods.recordAssessment(id, { kind: "checkpoint", moduleId: m.id, score: m.kind === "prereq" ? 100 : 88 });
      await jobs.waitJob(`semester-modules:${id}`);
    }
    v = sem.getSemesterView(id);
    expect(v.active!.final.available).toBe(true);
    const exam = await mods.buildAssessment(id, "final", null);
    expect(exam.items.length).toBeGreaterThan(0);
    expect(mods.recordAssessment(id, { kind: "final", score: 80 }).passed).toBe(false);
    dbmod.getDb().update(dbmod.schema.semesterAssessments).set({ createdAt: Date.now() - 2 * 86_400_000 }).run();
    mods.recordAssessment(id, { kind: "final", score: 92 });
    v = sem.getSemesterView(id);
    expect(v.status).toBe("finished");
    // Checkpoints 88 (weight 0.4) and the best final 92 (0.25), renormalized.
    expect(v.active!.grade).toMatchObject({ mark: 5, pct: Math.round(((88 * 0.4 + 92 * 0.25) / 0.65) * 10) / 10 });
    expect(v.active!.grades.map((g) => g.kind)).toContain("final");
  });
});

describe("computeGrade", () => {
  it("takes the best try of each item and renormalizes missing parts", () => {
    expect(sem.computeGrade([])).toBeNull();
    const g = sem.computeGrade([
      { kind: "checkpoint", moduleId: 1, score: 50 },
      { kind: "checkpoint", moduleId: 1, score: 90 },
      { kind: "checkpoint", moduleId: 2, score: 70 },
      { kind: "placement", moduleId: 0, score: 10 },
    ])!;
    expect(g.pct).toBe(80);
    expect(g.mark).toBe(4);
    expect(g.parts.map((p) => p.kind)).toEqual(["checkpoint"]);
  });
});

describe("parseIdeas", () => {
  it("makes keys unique and deps point only backwards", () => {
    const { ideas, guide } = mods.parseIdeas({
      ideas: [
        { key: "A B", title: "Первая", deps: ["b"] },
        { key: "a-b", title: "Вторая", deps: ["a-b"] },
        { title: "" },
      ],
      guide: [{ section: 1, summary: "Главное", exercises: "№ 5" }],
    });
    expect(ideas.map((i) => [i.key, i.deps])).toEqual([
      ["a-b", []],
      ["a-b-2", ["a-b"]],
    ]);
    expect(guide).toBe("Раздел 1: Главное Упражнения: № 5");
  });
});

describe("a passed placement test", () => {
  it("closes the zero module with all its ideas", async () => {
    const id = await startedSemester();
    const zero = sem.getSemesterView(id).modules[0];
    mods.recordAssessment(id, { kind: "placement", moduleId: zero.id, score: 90 });
    const v = sem.getSemesterView(id);
    expect(v.modules[0]).toMatchObject({ status: "passed", credit: "placement" });
    expect(v.modules[0].ideas!.checked).toBe(v.modules[0].ideas!.total);
    // The zero module is not graded.
    expect(v.active!.grade).toBeNull();
  });
});

describe("course map", () => {
  it("colours every idea by its level and lists sections of unprepared modules", async () => {
    const id = await startedSemester();
    const v = sem.getSemesterView(id);
    const topicId = v.modules[1].topicId!;
    const db = dbmod.getDb();
    const nodes = db.select().from(dbmod.schema.nodes).all().filter((n) => n.topicId === topicId);
    const k = (await import("@/server/mastery")).initialKnownCard();
    const { eq } = await import("drizzle-orm");
    // studied; checked; checked + explained; checked + explained + lasting.
    db.update(dbmod.schema.nodes).set({ status: "learning" }).where(eq(dbmod.schema.nodes.id, nodes[0].id)).run();
    for (const n of nodes.slice(1)) db.update(dbmod.schema.nodes).set({ status: "mastered", card: k.card, dueAt: k.dueAt }).where(eq(dbmod.schema.nodes.id, n.id)).run();
    db.update(dbmod.schema.nodes).set({ card: { ...k.card, scheduled_days: 30, stability: 30 } }).where(eq(dbmod.schema.nodes.id, nodes[3].id)).run();
    const round = { text: "x", review: { score: 90, verdict: "correct" as const, good: [], gaps: [], errors: [], followup: "", model: "" }, at: Date.now() };
    for (const n of nodes.slice(2)) db.insert(dbmod.schema.explanations).values({ topicId, nodeKey: n.key, concept: n.title, rounds: [round], createdAt: Date.now(), updatedAt: Date.now() }).run();
    db.insert(dbmod.schema.attempts).values({ sessionId: 0, topicId, nodeKey: nodes[0].key, toolUseId: "t", purpose: "check", kind: "choice", question: { kind: "choice", purpose: "check", prompt: "?" }, outcome: "wrong", createdAt: Date.now() }).run();

    const map = mods.courseMap(id);
    const m1 = map.modules.find((m) => m.id === v.modules[1].id)!;
    expect(m1.ideas.map((i) => i.level)).toEqual([1, 2, 3, 4]);
    expect(m1.ideas[0].mistakes).toBe(1);
    // Totals count the whole course: one idea each is checked, explained and known for good.
    expect(map.totals.slice(2)).toEqual([1, 1, 1]);
    const later = map.modules.find((m) => m.id === v.modules[2].id)!;
    expect(later.ideas).toEqual([]);
    expect(later.sections.length).toBeGreaterThan(0);
    expect(later.status).toBe("locked");
  });
});
