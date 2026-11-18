// Semester modules: each becomes a topic whose plan is the module's ideas,
// prepared from the program sections and the book pages behind them. Modules
// open one after another; a module is closed by its checkpoint (or the
// placement test for the zero module), and only that lets the learner move on.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { LASTING_DAYS, LEVELS, RETAKE_PAUSE_MS } from "@/lib/semester";
import { topoOrder, validatePlan } from "@/lib/plan";
import { planView } from "../agent/state";
import { ROLE_LABEL, sectionText } from "../books";
import { getDb, schema } from "../db";
import type { AssessmentKind } from "../db/schema";
import { buildExam } from "../exam";
import { startJob } from "../jobs";
import { chatAs } from "../llm";
import { isText } from "../llm/types";
import { initialKnownCard } from "../mastery";
import { jsonObject } from "./program";

type ModuleRow = typeof schema.semesterModules.$inferSelect;
type SemesterRow = typeof schema.semesters.$inferSelect;

const PREPARE_BUDGET = 60_000;

export const IDEAS_SYSTEM = `Ты готовишь модуль семестра к урокам с репетитором. По разделам модуля (и по тексту книг, если он дан) составь план — идеи модуля.

Идея — одна мысль, которую можно проверить одним вопросом: определение с его смыслом, теорема и где она применяется, приём решения, типичная тонкость. Обычно 5–20 идей на модуль, по 1–4 на раздел.
- Порядок — как в книге (или как разумно учить, если книги нет). deps — только key идей этого же модуля, которые нужно понимать раньше.
- Ничего из разделов не пропускай: ученик хочет знать модуль целиком.
- Глубина — по уровню семестра.
- key — латиница в нижнем регистре, цифры и дефис; title — по-русски, до 60 символов; summary — одна фраза: что ученик будет понимать.

Также составь путеводитель для репетитора (guide): для каждого раздела 2–3 предложения о главном с номерами страниц и упражнения из книг к нему (номера и страницы), если они есть в тексте.

Ответ — только JSON без пояснений:
{"ideas": [{"key": "...", "title": "...", "summary": "...", "deps": ["..."], "section": 1}],
 "guide": [{"section": 1, "summary": "...", "exercises": "№ 12–18, стр. 45"}]}`;

export function moduleRow(moduleId: number): ModuleRow {
  const m = getDb().select().from(schema.semesterModules).where(eq(schema.semesterModules.id, moduleId)).get();
  if (!m) throw new Error("Модуль не найден");
  return m;
}

export function semesterModules(semesterId: number): ModuleRow[] {
  return getDb().select().from(schema.semesterModules).where(eq(schema.semesterModules.semesterId, semesterId)).orderBy(asc(schema.semesterModules.idx)).all();
}

interface Idea {
  key: string;
  title: string;
  summary: string;
  deps: string[];
}

/** Ideas from the model's reply, made valid: unique keys, known deps, no cycles. */
export function parseIdeas(raw: unknown): { ideas: Idea[]; guide: string } {
  const r = (raw ?? {}) as { ideas?: unknown; guide?: unknown };
  const ideas: Idea[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(r.ideas) ? r.ideas : []) {
    const xx = (x ?? {}) as Record<string, unknown>;
    const title = typeof xx.title === "string" ? xx.title.trim().slice(0, 80) : "";
    if (!title) continue;
    let key = (typeof xx.key === "string" ? xx.key : "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || `idea-${ideas.length + 1}`;
    while (seen.has(key)) key += "-2";
    seen.add(key);
    ideas.push({ key, title, summary: typeof xx.summary === "string" ? xx.summary.trim().slice(0, 300) : "", deps: Array.isArray(xx.deps) ? xx.deps.map(String) : [] });
  }
  // Deps only to earlier ideas: keeps the graph acyclic and in book order.
  const before = new Set<string>();
  for (const i of ideas) {
    i.deps = [...new Set(i.deps.filter((d) => before.has(d)))];
    before.add(i.key);
  }
  const guide = (Array.isArray(r.guide) ? r.guide : [])
    .map((g) => {
      const gg = (g ?? {}) as Record<string, unknown>;
      const parts = [typeof gg.summary === "string" ? gg.summary.trim() : "", typeof gg.exercises === "string" && gg.exercises.trim() ? `Упражнения: ${gg.exercises.trim()}` : ""].filter(Boolean);
      return parts.length ? `Раздел ${gg.section ?? "?"}: ${parts.join(" ")}` : "";
    })
    .filter(Boolean)
    .join("\n");
  return { ideas, guide };
}

function createModuleTopic(sem: SemesterRow, m: ModuleRow, ideas: Idea[], guide: string | null): number {
  const db = getDb();
  // A one-idea module (a course with a single prerequisite) is fine here, unlike a lesson's plan.
  const problems = ideas.length >= 2 ? validatePlan(ideas.map((i) => ({ ...i }))) : ideas.length ? [] : ["в модуле нет идей"];
  if (problems.length) throw new Error(`План модуля не сложился: ${problems.join(" ")}`);
  const order = topoOrder(ideas)!;
  const now = Date.now();
  return db.transaction((tx) => {
    const topicId = tx
      .insert(schema.topics)
      .values({
        title: m.kind === "prereq" ? `${sem.title}: что нужно знать заранее` : m.title,
        // The topic page says which semester it belongs to; the goal is what the module is about.
        goal: m.kind === "prereq" ? "То, на что опирается курс." : m.summary,
        kind: "topic",
        semesterModuleId: m.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.topics.id })
      .get().id;
    tx.insert(schema.nodes)
      .values(ideas.map((i) => ({ topicId, key: i.key, title: i.title, summary: i.summary, deps: i.deps, orderIdx: order.indexOf(i.key) })))
      .run();
    tx.update(schema.semesterModules).set({ topicId, guide, preparedAt: now }).where(eq(schema.semesterModules.id, m.id)).run();
    return topicId;
  });
}

const inFlight = new Map<number, Promise<number>>();

/** Turn a module into a topic with its ideas; concurrent calls for one module share the work. */
export function prepareModule(moduleId: number): Promise<number> {
  const running = inFlight.get(moduleId);
  if (running) return running;
  const p = prepareModuleNow(moduleId).finally(() => inFlight.delete(moduleId));
  inFlight.set(moduleId, p);
  return p;
}

/** The zero module needs no model: its ideas are the prerequisites. */
async function prepareModuleNow(moduleId: number): Promise<number> {
  const db = getDb();
  const m = moduleRow(moduleId);
  if (m.topicId && db.select({ id: schema.topics.id }).from(schema.topics).where(eq(schema.topics.id, m.topicId)).get()) return m.topicId;
  const sem = db.select().from(schema.semesters).where(eq(schema.semesters.id, m.semesterId)).get()!;

  if (m.kind === "prereq") {
    return createModuleTopic(sem, m, sem.prereqs.map((p) => ({ key: p.key, title: p.title, summary: p.summary, deps: [] })), null);
  }

  const refs = [...new Set(m.sections.flatMap((s) => s.refs))];
  const secRows = refs.length ? db.select().from(schema.bookSections).where(inArray(schema.bookSections.id, refs)).all() : [];
  const bookRows = secRows.length ? db.select().from(schema.books).where(inArray(schema.books.id, [...new Set(secRows.map((s) => s.bookId))])).all() : [];
  const per = Math.min(25_000, Math.floor(PREPARE_BUDGET / Math.max(1, refs.length)));
  const sectionsText = m.sections
    .map((s, i) => {
      const sources = s.refs
        .map((r) => {
          const row = secRows.find((x) => x.id === r);
          const book = row && bookRows.find((b) => b.id === row.bookId);
          if (!row || !book) return "";
          return `<книга «${book.name}» (${ROLE_LABEL[book.role]}), «${row.title}», стр. ${row.pageFrom}–${row.pageTo}>\n${sectionText(r, per)}\n</книга>`;
        })
        .filter(Boolean);
      return `Раздел ${i + 1}: ${s.title}${s.summary ? ` — ${s.summary}` : ""}${sources.length ? `\n${sources.join("\n")}` : "\n(в материалах ученика этого раздела нет — опирайся на свои знания)"}`;
    })
    .join("\n\n");
  const earlier = semesterModules(sem.id)
    .filter((x) => x.kind === "regular" && x.idx < m.idx)
    .map((x) => x.title);

  const r = await chatAs("strong", "semester-module", null, {
    system: IDEAS_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `Семестр: ${sem.title}. ${LEVELS[sem.level].depth}`,
              sem.goal ? `Цель ученика: ${sem.goal}` : "",
              earlier.length ? `Уже пройденные модули: ${earlier.join("; ")}.` : "",
              `Модуль ${m.idx}: ${m.title}${m.summary ? ` — ${m.summary}` : ""}`,
              sectionsText,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
      },
    ],
    maxTokens: 16000,
  });
  const { ideas, guide } = parseIdeas(jsonObject(r.content.filter(isText).map((b) => b.text).join("")));
  // Without a usable answer each section is one idea: the module is never left without a plan.
  const plan = ideas.length
    ? ideas
    : m.sections.map((s, i) => ({ key: `section-${i + 1}`, title: s.title.slice(0, 80), summary: s.summary, deps: i ? [`section-${i}`] : [] }));
  return createModuleTopic(sem, m, plan, guide || null);
}

const prepKey = (semesterId: number) => `semester-modules:${semesterId}`;
const g = globalThis as unknown as { __tutorPrepErrors?: Map<number, string> };
/** The last failure to prepare a module, per semester, for the page to show. */
export const prepErrors = (g.__tutorPrepErrors ??= new Map<number, string>());

/** Prepare the open module and the one after it, in the background. */
export function prepareAhead(semesterId: number) {
  const mods = semesterModules(semesterId);
  const firstOpen = mods.findIndex((m) => !m.credit);
  if (firstOpen < 0) return;
  const want = mods.slice(firstOpen, firstOpen + 2).filter((m) => !m.preparedAt || !m.topicId);
  if (!want.length) return;
  startJob(prepKey(semesterId), async () => {
    prepErrors.delete(semesterId);
    for (const m of want) {
      try {
        await prepareModule(m.id);
      } catch (e) {
        prepErrors.set(semesterId, `Модуль «${m.title}» не удалось подготовить: ${e instanceof Error ? e.message : e}`);
        // A spending cap or missing setup will fail the next one too.
        if (/лимит|Настройки/i.test(String(e))) return;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Knowing an idea, strictly
// ---------------------------------------------------------------------------

export interface IdeaLevels {
  total: number;
  /** answered right at least once (status beyond "new") */
  studied: number;
  /** mastered by the checks */
  checked: number;
  /** explained in own words, judged correct */
  explained: number;
  /** the review interval has grown to LASTING_DAYS */
  lasting: number;
}

export function ideaLevels(topicId: number | null): IdeaLevels & { perfect: string[] } {
  if (!topicId) return { total: 0, studied: 0, checked: 0, explained: 0, lasting: 0, perfect: [] };
  const db = getDb();
  const nodes = db.select().from(schema.nodes).where(eq(schema.nodes.topicId, topicId)).all();
  const explainedKeys = new Set(
    db
      .select()
      .from(schema.explanations)
      .where(eq(schema.explanations.topicId, topicId))
      .all()
      .filter((e) => e.nodeKey && e.rounds.some((r) => r.review.verdict === "correct" || r.review.score >= 80))
      .map((e) => e.nodeKey!),
  );
  const lasting = (n: (typeof nodes)[number]) => n.status === "mastered" && !!n.card && (n.card.scheduled_days >= LASTING_DAYS || n.card.stability >= LASTING_DAYS);
  return {
    total: nodes.length,
    studied: nodes.filter((n) => n.status !== "new").length,
    checked: nodes.filter((n) => n.status === "mastered").length,
    explained: nodes.filter((n) => explainedKeys.has(n.key)).length,
    lasting: nodes.filter(lasting).length,
    perfect: nodes.filter((n) => lasting(n) && explainedKeys.has(n.key)).map((n) => n.key),
  };
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

export function assessments(semesterId: number) {
  return getDb().select().from(schema.semesterAssessments).where(eq(schema.semesterAssessments.semesterId, semesterId)).orderBy(desc(schema.semesterAssessments.id)).all();
}

/** When the next try is allowed after a failed one (null: now). */
export function nextTry(semesterId: number, kind: AssessmentKind, moduleId: number | null, now = Date.now()): number | null {
  const last = assessments(semesterId).find((a) => a.kind === kind && (moduleId === null || a.moduleId === moduleId));
  if (!last || last.passed) return null;
  const at = last.createdAt + RETAKE_PAUSE_MS;
  return at > now ? at : null;
}

export interface ExamAvailability {
  available: boolean;
  /** Why not, in words. */
  reason: string | null;
  passed: boolean;
  best: number | null;
  nextTryAt: number | null;
  /** Modules the exam covers. */
  moduleIds: number[];
}

export function examAvailability(semesterId: number, kind: "midterm" | "final", now = Date.now()): ExamAvailability {
  const mods = semesterModules(semesterId).filter((m) => m.kind === "regular");
  const passedMods = mods.filter((m) => m.credit);
  const all = assessments(semesterId).filter((a) => a.kind === kind);
  const best = all.length ? Math.max(...all.map((a) => a.score)) : null;
  const passed = all.some((a) => a.passed);
  const nextTryAt = nextTry(semesterId, kind, null, now);
  const need = kind === "final" ? mods.length : Math.ceil(mods.length / 2);
  let reason: string | null = null;
  if (kind === "midterm" && mods.length < 3) reason = "Курс короткий: промежуточного экзамена нет.";
  else if (passedMods.length < need) reason = kind === "final" ? "Откроется, когда все модули будут сданы." : `Откроется после ${need}-го сданного модуля.`;
  else if (nextTryAt) reason = "Пересдача — после разбора ошибок.";
  return { available: !reason, reason, passed, best, nextTryAt, moduleIds: passedMods.map((m) => m.id) };
}

export function examCount(kind: AssessmentKind, ideas: number): number {
  if (kind === "final") return Math.min(30, Math.max(15, ideas));
  if (kind === "midterm") return Math.min(20, Math.max(12, Math.round(ideas * 0.6)));
  if (kind === "placement") return Math.min(16, Math.max(4, ideas * 2));
  return Math.min(20, Math.max(8, Math.round(ideas * 1.5)));
}

function shuffle<T>(a: T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Questions for a checkpoint, the placement test, or a cumulative exam. A
 * cumulative exam takes questions from every module it covers, in proportion
 * to their ideas, so that old material is asked again.
 */
export async function buildAssessment(semesterId: number, kind: AssessmentKind, moduleId: number | null) {
  const sem = getDb().select().from(schema.semesters).where(eq(schema.semesters.id, semesterId)).get();
  if (!sem) throw new Error("Семестр не найден");
  if (sem.status !== "active" && !(sem.status === "finished" && kind !== "placement")) throw new Error("Семестр ещё не начат");
  if (kind === "homework" || kind === "oral") throw new Error("Это не письменный экзамен");

  if (kind === "checkpoint" || kind === "placement") {
    const m = moduleRow(moduleId ?? 0);
    if (m.semesterId !== semesterId) throw new Error("Модуль не из этого семестра");
    if (kind === "placement" && m.kind !== "prereq") throw new Error("Входной тест — только для нулевого модуля");
    const status = moduleStatuses(semesterId).get(m.id);
    if (status === "locked") throw new Error("Модуль ещё закрыт: сначала сдай предыдущий");
    const wait = nextTry(semesterId, kind, m.id);
    if (wait) throw new Error(`Пересдача будет доступна ${new Date(wait).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}. А пока разбери ошибки.`);
    const topicId = await prepareModule(m.id);
    const ideas = planView(getDb(), topicId).length;
    const r = await buildExam(topicId, examCount(kind, ideas), true);
    return { ...r, threshold: kind === "placement" ? 70 : LEVELS[sem.level].threshold, title: kind === "placement" ? "Входной тест" : `Контрольная: ${m.title}` };
  }

  const av = examAvailability(semesterId, kind);
  if (!av.available) throw new Error(av.reason ?? "Экзамен пока недоступен");
  const mods = semesterModules(semesterId).filter((m) => av.moduleIds.includes(m.id) && m.topicId);
  const sizes = mods.map((m) => planView(getDb(), m.topicId!).length);
  const total = examCount(kind, sizes.reduce((a, b) => a + b, 0));
  const sum = sizes.reduce((a, b) => a + b, 0) || 1;
  const items = [];
  let generated = 0;
  for (const [i, m] of mods.entries()) {
    const share = Math.max(2, Math.round((sizes[i] / sum) * total));
    const r = await buildExam(m.topicId!, share, true);
    items.push(...r.items.slice(0, share));
    generated += r.generated;
  }
  return { items: shuffle(items).slice(0, Math.max(total, mods.length * 2)), generated, threshold: LEVELS[sem.level].threshold, title: kind === "final" ? "Итоговый экзамен" : "Промежуточный экзамен" };
}

export type ModuleStatus = "locked" | "open" | "passed";

/** Modules open one by one: each needs all earlier ones closed. */
export function moduleStatuses(semesterId: number): Map<number, ModuleStatus> {
  const out = new Map<number, ModuleStatus>();
  let blocked = false;
  for (const m of semesterModules(semesterId)) {
    if (m.credit) out.set(m.id, "passed");
    else if (blocked) out.set(m.id, "locked");
    else {
      out.set(m.id, "open");
      blocked = true;
    }
  }
  return out;
}

export interface AssessmentResult {
  kind: AssessmentKind;
  moduleId?: number | null;
  score: number;
  details?: { key: string; title: string; got: number; total: number }[];
}

/** Record a finished exam in the grade book and apply its consequences. */
export function recordAssessment(semesterId: number, input: AssessmentResult) {
  const db = getDb();
  const sem = db.select().from(schema.semesters).where(eq(schema.semesters.id, semesterId)).get();
  if (!sem) throw new Error("Семестр не найден");
  if (!["placement", "checkpoint", "midterm", "final"].includes(input.kind)) throw new Error("Неизвестный вид работы");
  const score = Math.round(Math.max(0, Math.min(100, Number(input.score))) * 10) / 10;
  if (!Number.isFinite(score)) throw new Error("Некорректный результат");
  const details = (input.details ?? []).slice(0, 200).map((d) => ({ key: String(d.key).slice(0, 80), title: String(d.title).slice(0, 120), got: Number(d.got) || 0, total: Number(d.total) || 0 }));
  const threshold = input.kind === "placement" ? 70 : LEVELS[sem.level].threshold;
  const passed = score >= threshold;
  const now = Date.now();
  const moduleId = input.moduleId ?? null;
  const m = moduleId ? moduleRow(moduleId) : null;
  if ((input.kind === "checkpoint" || input.kind === "placement") && (!m || m.semesterId !== semesterId)) throw new Error("Модуль не найден");

  db.insert(schema.semesterAssessments).values({ semesterId, moduleId, kind: input.kind, score, passed, details, createdAt: now }).run();

  if (m && m.topicId && (input.kind === "placement" || input.kind === "checkpoint")) {
    // Ideas the learner showed they know (by this exam) count as mastered, also when the module is closed early.
    const strong = new Set(details.filter((d) => d.total > 0 && d.got / d.total >= 0.7).map((d) => d.key.split(":").pop()!));
    const nodes = db.select().from(schema.nodes).where(eq(schema.nodes.topicId, m.topicId)).all();
    const allMastered = nodes.every((n) => n.status === "mastered");
    for (const n of nodes) {
      if (n.status === "mastered") continue;
      // A passed checkpoint or placement test vouches for every idea of the module.
      if (strong.has(n.key) || passed) {
        const k = initialKnownCard();
        db.update(schema.nodes).set({ status: "mastered", card: k.card, dueAt: k.dueAt }).where(eq(schema.nodes.id, n.id)).run();
      }
    }
    if (passed && !m.credit) {
      const credit = input.kind === "placement" ? "placement" : allMastered ? "exam" : "early";
      db.update(schema.semesterModules).set({ credit, passedAt: now }).where(eq(schema.semesterModules.id, m.id)).run();
    }
  }
  if (input.kind === "final" && passed) {
    db.update(schema.semesters).set({ status: "finished", finishedAt: now }).where(eq(schema.semesters.id, semesterId)).run();
  }
  prepareAhead(semesterId);
  return { passed, threshold, score, nextTryAt: passed ? null : now + RETAKE_PAUSE_MS };
}

/** Start the semester: the zero module (if the course has prerequisites) and the first modules get ready. */
export function setupModules(semesterId: number) {
  const db = getDb();
  const sem = db.select().from(schema.semesters).where(eq(schema.semesters.id, semesterId)).get()!;
  const mods = semesterModules(semesterId);
  if (sem.prereqs.length && !mods.some((m) => m.kind === "prereq")) {
    db.insert(schema.semesterModules)
      .values({
        semesterId,
        idx: 0,
        part: "",
        title: "Нулевой модуль: что нужно знать заранее",
        summary: "Входной тест по тому, на что опирается курс. Что окажется слабым, нужно подтянуть до первого модуля.",
        hours: 2,
        kind: "prereq",
        sections: sem.prereqs.map((p) => ({ title: p.title, summary: p.summary, refs: [] })),
      })
      .run();
  }
  prepareAhead(semesterId);
}

/** A module's topic was deleted: forget it so it is prepared again. */
export function forgetTopic(topicId: number) {
  getDb()
    .update(schema.semesterModules)
    .set({ topicId: null, preparedAt: null })
    .where(and(eq(schema.semesterModules.topicId, topicId)))
    .run();
}

/** For a module's topic page: where it belongs and how to close it. */
export function topicSemester(moduleId: number | null) {
  if (!moduleId) return null;
  const db = getDb();
  const m = db.select().from(schema.semesterModules).where(eq(schema.semesterModules.id, moduleId)).get();
  if (!m) return null;
  const sem = db.select().from(schema.semesters).where(eq(schema.semesters.id, m.semesterId)).get();
  if (!sem) return null;
  return {
    semesterId: sem.id,
    semesterTitle: sem.title,
    moduleId: m.id,
    moduleIdx: m.idx,
    kind: m.kind,
    credit: m.credit,
    threshold: m.kind === "prereq" ? 70 : LEVELS[sem.level].threshold,
    status: moduleStatuses(sem.id).get(m.id) ?? "locked",
  };
}
