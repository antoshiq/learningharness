// Semesters: creation, books, preparation in the background, the program
// editor and the view of a semester for its page.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { LEVELS } from "@/lib/semester";
import { deleteBook, outlineBook, storeBook } from "../books";
import { getDb, schema } from "../db";
import type { BookRole, ProgramSection, SemesterLevel } from "../db/schema";
import { isJobRunning, startJob } from "../jobs";
import { startOfDay } from "../stats";
import { gradeOf, GRADE_WEIGHTS } from "@/lib/semester";
import type { AssessmentKind } from "../db/schema";
import { assessments, examAvailability, ideaLevels, moduleStatuses, nextTry, prepareAhead, prepErrors, setupModules, type ExamAvailability, type IdeaLevels, type ModuleStatus } from "./modules";
import { buildProgram, type ProgramModule } from "./program";

const jobKey = (id: number) => `semester:${id}`;

export interface SemesterInput {
  request?: string;
  level?: string;
  goal?: string;
  weeks?: number;
  hoursPerWeek?: number;
  startDate?: string;
}

function checkInput(input: SemesterInput) {
  const request = (input.request ?? "").trim().slice(0, 500);
  const level = (input.level ?? "standard") as SemesterLevel;
  if (!(level in LEVELS)) throw new Error("Неизвестный уровень");
  const weeks = Math.round(Number(input.weeks));
  if (!Number.isFinite(weeks) || weeks < 1 || weeks > 52) throw new Error("Длительность — от 1 до 52 недель");
  const hoursPerWeek = Math.round(Number(input.hoursPerWeek));
  if (!Number.isFinite(hoursPerWeek) || hoursPerWeek < 1 || hoursPerWeek > 60) throw new Error("Часов в неделю — от 1 до 60");
  let startDate = startOfDay();
  if (input.startDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.startDate);
    if (!m) throw new Error("Некорректная дата начала");
    startDate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  }
  return { request, level, goal: (input.goal ?? "").trim().slice(0, 500), weeks, hoursPerWeek, startDate };
}

/** A new semester waiting for its books; preparation starts with startPreparation. */
export function createSemester(input: SemesterInput): number {
  const v = checkInput(input);
  return getDb()
    .insert(schema.semesters)
    .values({ ...v, title: v.request || "Новый семестр", status: "preparing", prereqs: [], notes: [], recommended: [], createdAt: Date.now() })
    .returning({ id: schema.semesters.id })
    .get().id;
}

export function updateSemester(id: number, input: SemesterInput & { title?: string }) {
  const sem = getSemesterRow(id);
  const v = checkInput({
    request: input.request ?? sem.request,
    level: input.level ?? sem.level,
    goal: input.goal ?? sem.goal,
    weeks: input.weeks ?? sem.weeks,
    hoursPerWeek: input.hoursPerWeek ?? sem.hoursPerWeek,
    startDate: input.startDate,
  });
  const title = input.title !== undefined ? input.title.trim().slice(0, 160) || sem.title : sem.title;
  getDb()
    .update(schema.semesters)
    .set({ ...v, startDate: input.startDate ? v.startDate : sem.startDate, title })
    .where(eq(schema.semesters.id, id))
    .run();
}

export function getSemesterRow(id: number) {
  const s = getDb().select().from(schema.semesters).where(eq(schema.semesters.id, id)).get();
  if (!s) throw new Error("Семестр не найден");
  return s;
}

const ROLES: BookRole[] = ["main", "problems", "lectures", "extra"];

/** Store a book's pages now; its outline is built by the preparation job. */
export async function addBook(semesterId: number, name: string, role: string, data: Uint8Array) {
  const sem = getSemesterRow(semesterId);
  if (sem.status === "finished") throw new Error("Семестр завершён");
  if (!ROLES.includes(role as BookRole)) throw new Error("Неизвестная роль файла");
  const { id } = await storeBook({ semesterId, name, role: role as BookRole, data });
  return id;
}

export function setBookRole(semesterId: number, bookId: number, role: string) {
  if (!ROLES.includes(role as BookRole)) throw new Error("Неизвестная роль файла");
  getDb()
    .update(schema.books)
    .set({ role: role as BookRole })
    .where(and(eq(schema.books.id, bookId), eq(schema.books.semesterId, semesterId)))
    .run();
}

export function removeBook(semesterId: number, bookId: number) {
  const db = getDb();
  const book = db.select().from(schema.books).where(and(eq(schema.books.id, bookId), eq(schema.books.semesterId, semesterId))).get();
  if (!book) throw new Error("Файл не найден");
  const sectionIds = new Set(
    db
      .select({ id: schema.bookSections.id })
      .from(schema.bookSections)
      .where(eq(schema.bookSections.bookId, bookId))
      .all()
      .map((r) => r.id),
  );
  // The program forgets the removed book's sections.
  for (const m of db.select().from(schema.semesterModules).where(eq(schema.semesterModules.semesterId, semesterId)).all()) {
    if (!m.sections.some((s) => s.refs.some((r) => sectionIds.has(r)))) continue;
    const sections = m.sections.map((s) => ({ ...s, refs: s.refs.filter((r) => !sectionIds.has(r)) }));
    db.update(schema.semesterModules).set({ sections }).where(eq(schema.semesterModules.id, m.id)).run();
  }
  deleteBook(bookId);
}

function setStep(id: number, step: string | null) {
  getDb().update(schema.semesters).set({ step }).where(eq(schema.semesters.id, id)).run();
}

/** Outline books that are not outlined yet. Errors stay on the book; the rest go on. */
async function outlinePending(semesterId: number) {
  const db = getDb();
  const pending = db
    .select()
    .from(schema.books)
    .where(and(eq(schema.books.semesterId, semesterId), eq(schema.books.status, "outlining")))
    .orderBy(asc(schema.books.id))
    .all();
  for (const b of pending) {
    setStep(semesterId, `«${b.name}»: читаю структуру`);
    try {
      await outlineBook(b.id, (label) => setStep(semesterId, `«${b.name}»: ${label.toLowerCase()}`));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A spending cap or a missing model setup stops the whole preparation.
      if (/лимит|Настройки|ключ/i.test(msg)) throw e;
      db.update(schema.books).set({ status: "error", error: msg }).where(eq(schema.books.id, b.id)).run();
    }
  }
}

/** Save a program as the semester's modules (replacing the old ones). */
export function saveProgramModules(semesterId: number, modules: ProgramModule[]) {
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(schema.semesterModules)
      .where(and(eq(schema.semesterModules.semesterId, semesterId), eq(schema.semesterModules.kind, "regular")))
      .run();
    modules.forEach((m, idx) => {
      tx.insert(schema.semesterModules)
        .values({ semesterId, idx: idx + 1, part: m.part, title: m.title, summary: m.summary, hours: m.hours, sections: m.sections })
        .run();
    });
  });
}

/** Read the books and build the program, in the background. Safe to call again after a failure. */
export function startPreparation(semesterId: number, rebuild = false): boolean {
  const sem = getSemesterRow(semesterId);
  if (sem.status === "active" || sem.status === "finished" || (sem.status === "draft" && !rebuild)) {
    // Outside of building a program only newly added books are read: in a draft they can then
    // be added to the program by hand (or the program rebuilt); in a running semester lessons find them by search.
    return startJob(jobKey(semesterId), async () => {
      try {
        await outlinePending(semesterId);
        setStep(semesterId, null);
      } catch (e) {
        getDb().update(schema.semesters).set({ step: null, error: e instanceof Error ? e.message : String(e) }).where(eq(schema.semesters.id, semesterId)).run();
      }
    });
  }
  const db = getDb();
  db.update(schema.semesters).set({ status: "preparing", error: null }).where(eq(schema.semesters.id, semesterId)).run();
  return startJob(jobKey(semesterId), async () => {
    try {
      await outlinePending(semesterId);
      const books = db.select().from(schema.books).where(eq(schema.books.semesterId, semesterId)).all();
      if (!books.some((b) => b.status === "ready") && !getSemesterRow(semesterId).request) {
        throw new Error(books.length ? "Ни один файл не удалось прочитать. Добавь другие файлы или укажи тему." : "Укажи тему или добавь книги.");
      }
      setStep(semesterId, "Составляю программу курса. Для толстых книг это может занять несколько минут");
      const program = await buildProgram(semesterId);
      saveProgramModules(semesterId, program.modules);
      db.update(schema.semesters)
        .set({
          title: program.title,
          estimateHours: program.estimateHours,
          prereqs: program.prereqs,
          notes: program.notes,
          recommended: program.recommended,
          status: "draft",
          step: null,
          error: null,
        })
        .where(eq(schema.semesters.id, semesterId))
        .run();
    } catch (e) {
      db.update(schema.semesters)
        .set({ step: null, error: e instanceof Error ? e.message : String(e) })
        .where(eq(schema.semesters.id, semesterId))
        .run();
    }
  });
}

// ---------------------------------------------------------------------------
// Program editor
// ---------------------------------------------------------------------------

export interface ModuleEdit {
  id?: number;
  part?: string;
  title?: string;
  summary?: string;
  hours?: number;
  sections?: { title?: string; summary?: string; refs?: number[] }[];
}

/** Replace the draft program with the learner's edited version. */
export function saveProgram(semesterId: number, edits: ModuleEdit[]) {
  const sem = getSemesterRow(semesterId);
  if (sem.status !== "draft") throw new Error("Программу можно менять до начала семестра");
  if (!Array.isArray(edits) || !edits.length) throw new Error("В программе должен быть хотя бы один модуль");
  const db = getDb();
  const bookIds = db.select({ id: schema.books.id }).from(schema.books).where(eq(schema.books.semesterId, semesterId)).all().map((b) => b.id);
  const known = new Set(
    bookIds.length
      ? db
          .select({ id: schema.bookSections.id })
          .from(schema.bookSections)
          .where(inArray(schema.bookSections.bookId, bookIds))
          .all()
          .map((r) => r.id)
      : [],
  );
  const modules: ProgramModule[] = edits.map((m, i) => {
    const title = (m.title ?? "").trim().slice(0, 160);
    if (!title) throw new Error(`У модуля ${i + 1} нет названия`);
    const sections: ProgramSection[] = (m.sections ?? [])
      .map((s) => ({
        title: (s.title ?? "").trim().slice(0, 200),
        summary: (s.summary ?? "").trim().slice(0, 400),
        refs: [...new Set((s.refs ?? []).map(Number).filter((r) => known.has(r)))],
      }))
      .filter((s) => s.title);
    if (!sections.length) throw new Error(`В модуле «${title}» нет разделов`);
    const hours = Number(m.hours);
    return {
      part: (m.part ?? "").trim().slice(0, 120),
      title,
      summary: (m.summary ?? "").trim().slice(0, 600),
      hours: Number.isFinite(hours) && hours > 0 ? Math.min(60, Math.round(hours * 2) / 2) : 4,
      sections,
    };
  });
  saveProgramModules(semesterId, modules);
}

export function deleteSemester(id: number) {
  const db = getDb();
  const books = db.select({ id: schema.books.id }).from(schema.books).where(eq(schema.books.semesterId, id)).all();
  for (const b of books) deleteBook(b.id);
  // Module topics stay as ordinary topics: the learning history is not thrown away.
  const moduleIds = db.select({ id: schema.semesterModules.id }).from(schema.semesterModules).where(eq(schema.semesterModules.semesterId, id)).all().map((m) => m.id);
  db.transaction((tx) => {
    if (moduleIds.length) tx.update(schema.topics).set({ semesterModuleId: null }).where(inArray(schema.topics.semesterModuleId, moduleIds)).run();
    tx.delete(schema.semesterModules).where(eq(schema.semesterModules.semesterId, id)).run();
    tx.delete(schema.semesterAssessments).where(eq(schema.semesterAssessments.semesterId, id)).run();
    tx.delete(schema.semesterHomework).where(eq(schema.semesterHomework.semesterId, id)).run();
    tx.delete(schema.semesters).where(eq(schema.semesters.id, id)).run();
  });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface SectionRef {
  id: number;
  bookId: number;
  book: string;
  title: string;
  pageFrom: number;
  pageTo: number;
}

export interface BookView {
  id: number;
  name: string;
  role: BookRole;
  format: "pdf" | "text";
  pages: number;
  status: "reading" | "outlining" | "ready" | "error";
  outlineSource: string | null;
  error: string | null;
  sections: number;
}

/** Book sections referenced by a program, by id. */
export function sectionRefs(semesterId: number): Map<number, SectionRef> {
  const db = getDb();
  const rows = db
    .select({
      id: schema.bookSections.id,
      bookId: schema.bookSections.bookId,
      book: schema.books.name,
      title: schema.bookSections.title,
      pageFrom: schema.bookSections.pageFrom,
      pageTo: schema.bookSections.pageTo,
    })
    .from(schema.bookSections)
    .innerJoin(schema.books, eq(schema.books.id, schema.bookSections.bookId))
    .where(eq(schema.books.semesterId, semesterId))
    .all();
  return new Map(rows.map((r) => [r.id, r]));
}

export function bookViews(semesterId: number): BookView[] {
  const db = getDb();
  const counts = new Map(
    db
      .select({ bookId: schema.bookSections.bookId, n: sql<number>`count(*)` })
      .from(schema.bookSections)
      .groupBy(schema.bookSections.bookId)
      .all()
      .map((r) => [r.bookId, r.n]),
  );
  return db
    .select()
    .from(schema.books)
    .where(eq(schema.books.semesterId, semesterId))
    .orderBy(asc(schema.books.id))
    .all()
    .map((b) => ({
      id: b.id,
      name: b.name,
      role: b.role,
      format: b.format,
      pages: b.pages,
      status: b.status,
      outlineSource: b.outlineSource,
      error: b.error,
      sections: counts.get(b.id) ?? 0,
    }));
}

/** Book sections of a semester for the editor's "add from the book" picker. */
export function bookOutline(semesterId: number, bookId: number) {
  const db = getDb();
  const book = db.select().from(schema.books).where(and(eq(schema.books.id, bookId), eq(schema.books.semesterId, semesterId))).get();
  if (!book) throw new Error("Файл не найден");
  return db
    .select({ id: schema.bookSections.id, level: schema.bookSections.level, title: schema.bookSections.title, pageFrom: schema.bookSections.pageFrom, pageTo: schema.bookSections.pageTo })
    .from(schema.bookSections)
    .where(eq(schema.bookSections.bookId, bookId))
    .orderBy(asc(schema.bookSections.idx))
    .all();
}

/** Resume preparation that a server restart interrupted. */
export function resumeIfStalled(semesterId: number) {
  const sem = getSemesterRow(semesterId);
  if (isJobRunning(jobKey(semesterId)) || sem.error) return;
  const db = getDb();
  const outlining = db
    .select({ id: schema.books.id })
    .from(schema.books)
    .where(and(eq(schema.books.semesterId, semesterId), eq(schema.books.status, "outlining")))
    .get();
  if (sem.status === "preparing" && sem.step !== null) startPreparation(semesterId);
  else if (sem.status !== "preparing" && outlining) startPreparation(semesterId);
}

export const preparing = (semesterId: number) => isJobRunning(jobKey(semesterId));

export interface ModuleView {
  id: number;
  idx: number;
  part: string;
  title: string;
  summary: string;
  hours: number;
  kind: "regular" | "prereq";
  sections: (ProgramSection & { sources: SectionRef[] })[];
  topicId: number | null;
  credit: "exam" | "early" | "placement" | null;
  passedAt: number | null;
  /** Running semester only. */
  status?: ModuleStatus;
  prepared?: boolean;
  ideas?: IdeaLevels & { perfect: string[] };
  openSessionId?: number | null;
  checkpoint?: { best: number | null; tries: number; nextTryAt: number | null };
}

export interface GradeLine {
  id: number;
  kind: AssessmentKind;
  module: string | null;
  score: number;
  passed: boolean;
  createdAt: number;
}

export interface ActiveInfo {
  threshold: number;
  /** Share of the program's ideas mastered, weighted by module size; closed modules count fully. */
  progress: number;
  /** Share known for good: explained and lasting. */
  lasting: number;
  midterm: ExamAvailability;
  final: ExamAvailability;
  grades: GradeLine[];
  grade: { pct: number; mark: number; label: string; parts: { kind: AssessmentKind; pct: number; weight: number }[] } | null;
  preparing: boolean;
  prepareError: string | null;
}

export interface SemesterView {
  id: number;
  title: string;
  request: string;
  level: SemesterLevel;
  goal: string;
  weeks: number;
  hoursPerWeek: number;
  startDate: number;
  status: "preparing" | "draft" | "active" | "finished";
  step: string | null;
  error: string | null;
  estimateHours: number | null;
  capacityHours: number;
  programHours: number;
  prereqs: { key: string; title: string; summary: string }[];
  notes: string[];
  recommended: string[];
  books: BookView[];
  modules: ModuleView[];
  running: boolean;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  active: ActiveInfo | null;
}

export function moduleViews(semesterId: number): ModuleView[] {
  const refs = sectionRefs(semesterId);
  return getDb()
    .select()
    .from(schema.semesterModules)
    .where(eq(schema.semesterModules.semesterId, semesterId))
    .orderBy(asc(schema.semesterModules.idx))
    .all()
    .map((m) => ({
      id: m.id,
      idx: m.idx,
      part: m.part,
      title: m.title,
      summary: m.summary,
      hours: m.hours,
      kind: m.kind,
      sections: m.sections.map((s) => ({ ...s, sources: s.refs.map((r) => refs.get(r)).filter((x): x is SectionRef => !!x) })),
      topicId: m.topicId,
      credit: m.credit,
      passedAt: m.passedAt,
    }));
}

export function getSemesterView(id: number): SemesterView {
  resumeIfStalled(id);
  const s = getSemesterRow(id);
  const modules = moduleViews(id);
  return {
    id: s.id,
    title: s.title,
    request: s.request,
    level: s.level,
    goal: s.goal,
    weeks: s.weeks,
    hoursPerWeek: s.hoursPerWeek,
    startDate: s.startDate,
    status: s.status,
    step: s.step,
    error: s.error,
    estimateHours: s.estimateHours,
    capacityHours: s.weeks * s.hoursPerWeek,
    programHours: modules.filter((m) => m.kind === "regular").reduce((n, m) => n + m.hours, 0),
    prereqs: s.prereqs,
    notes: s.notes,
    recommended: s.recommended,
    books: bookViews(id),
    modules,
    running: preparing(id),
    createdAt: s.createdAt,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    active: s.status === "active" || s.status === "finished" ? activeInfo(id, modules) : null,
  };
}

/** Best score of each graded item, then the weighted grade (missing parts left out). */
export function computeGrade(lines: { kind: AssessmentKind; moduleId: number | null; score: number }[]) {
  const best = new Map<string, { kind: AssessmentKind; score: number }>();
  for (const l of lines) {
    if (l.kind === "placement") continue;
    const k = `${l.kind}:${l.moduleId ?? ""}`;
    if (!best.has(k) || best.get(k)!.score < l.score) best.set(k, { kind: l.kind, score: l.score });
  }
  const parts: { kind: AssessmentKind; pct: number; weight: number }[] = [];
  for (const [kind, weight] of Object.entries(GRADE_WEIGHTS) as [AssessmentKind, number][]) {
    const xs = [...best.values()].filter((b) => b.kind === kind).map((b) => b.score);
    if (xs.length) parts.push({ kind, pct: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10, weight });
  }
  if (!parts.length) return null;
  const w = parts.reduce((n, p) => n + p.weight, 0);
  const pct = Math.round((parts.reduce((n, p) => n + p.pct * p.weight, 0) / w) * 10) / 10;
  return { pct, ...gradeOf(pct), parts };
}

function activeInfo(id: number, modules: ModuleView[]): ActiveInfo {
  const db = getDb();
  const sem = getSemesterRow(id);
  prepareAhead(id);
  const statuses = moduleStatuses(id);
  const all = assessments(id);
  const titles = new Map(modules.map((m) => [m.id, m.title]));
  let weightSum = 0;
  let masteredSum = 0;
  let lastingSum = 0;
  for (const m of modules) {
    const ideas = ideaLevels(m.topicId);
    const open = m.topicId
      ? db
          .select({ id: schema.sessions.id })
          .from(schema.sessions)
          .where(and(eq(schema.sessions.topicId, m.topicId), eq(schema.sessions.kind, "lesson"), sql`${schema.sessions.endedAt} is null`))
          .orderBy(sql`${schema.sessions.id} desc`)
          .get()
      : undefined;
    const tries = all.filter((a) => a.moduleId === m.id && (a.kind === "checkpoint" || a.kind === "placement"));
    m.status = statuses.get(m.id);
    m.prepared = !!m.topicId;
    m.ideas = ideas;
    m.openSessionId = open?.id ?? null;
    const lastKind = tries[0]?.kind ?? "checkpoint";
    m.checkpoint = { best: tries.length ? Math.max(...tries.map((a) => a.score)) : null, tries: tries.length, nextTryAt: nextTry(id, lastKind, m.id) };
    if (m.kind !== "regular") continue;
    // Module weight: its sections, a crude but stable measure of size.
    const w = Math.max(1, m.sections.length);
    weightSum += w;
    masteredSum += w * (m.credit ? 1 : ideas.total ? ideas.checked / ideas.total : 0);
    lastingSum += w * (ideas.total ? ideas.perfect.length / ideas.total : 0);
  }
  // The zero module is what the course assumes, not the course: it is not graded.
  const zero = new Set(modules.filter((m) => m.kind === "prereq").map((m) => m.id));
  const grade = computeGrade(all.filter((a) => !(a.moduleId && zero.has(a.moduleId))).map((a) => ({ kind: a.kind, moduleId: a.moduleId, score: a.score })));
  return {
    threshold: LEVELS[sem.level].threshold,
    progress: weightSum ? Math.round((masteredSum / weightSum) * 100) : 0,
    lasting: weightSum ? Math.round((lastingSum / weightSum) * 100) : 0,
    midterm: examAvailability(id, "midterm"),
    final: examAvailability(id, "final"),
    grades: all.map((a) => ({ id: a.id, kind: a.kind, module: a.moduleId ? (titles.get(a.moduleId) ?? null) : null, score: a.score, passed: a.passed, createdAt: a.createdAt })),
    grade: grade ? { pct: grade.pct, mark: grade.mark, label: grade.label, parts: grade.parts } : null,
    preparing: isJobRunning(`semester-modules:${id}`),
    prepareError: prepErrors.get(id) ?? null,
  };
}

export interface SemesterCard {
  id: number;
  title: string;
  level: SemesterLevel;
  status: SemesterView["status"];
  modules: number;
  passed: number;
  weeks: number;
  startDate: number;
}

export function listSemesters(): SemesterCard[] {
  const db = getDb();
  return db
    .select()
    .from(schema.semesters)
    .orderBy(sql`${schema.semesters.createdAt} desc`)
    .all()
    .map((s) => {
      const mods = db.select({ passedAt: schema.semesterModules.passedAt }).from(schema.semesterModules).where(eq(schema.semesterModules.semesterId, s.id)).all();
      return { id: s.id, title: s.title, level: s.level, status: s.status, modules: mods.length, passed: mods.filter((m) => m.passedAt).length, weeks: s.weeks, startDate: s.startDate };
    });
}

/** The learner accepts the program: the semester starts. */
export function approveProgram(id: number) {
  const sem = getSemesterRow(id);
  if (sem.status !== "draft") throw new Error("Программа уже утверждена");
  const db = getDb();
  if (!db.select({ id: schema.semesterModules.id }).from(schema.semesterModules).where(eq(schema.semesterModules.semesterId, id)).get()) {
    throw new Error("В программе нет модулей");
  }
  db.update(schema.semesters).set({ status: "active", startedAt: Date.now() }).where(eq(schema.semesters.id, id)).run();
  setupModules(id);
}
