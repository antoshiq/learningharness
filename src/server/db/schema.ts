import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ChatMsg } from "../llm/types";
import type { Question, AnswerPayload, SessionSummary, FsrsCardJson } from "@/lib/types";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});

export const topics = sqliteTable("topics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  goal: text("goal").notNull().default(""),
  kind: text("kind").$type<"topic" | "repo">().notNull().default("topic"),
  repoPath: text("repo_path"),
  repoMap: text("repo_map"),
  /** Set when the topic is a module of a semester: lessons then follow its program and books. */
  semesterModuleId: integer("semester_module_id"),
  /** Cheat sheet written by the tutor from what was learned (Markdown). */
  notes: text("notes"),
  /** The quick overview the learner read before starting this topic (Markdown). */
  brief: text("brief"),
  notesAt: integer("notes_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const nodes = sqliteTable(
  "nodes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    topicId: integer("topic_id").notNull(),
    key: text("key").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    deps: text("deps", { mode: "json" }).$type<string[]>().notNull(),
    orderIdx: integer("order_idx").notNull().default(0),
    status: text("status").$type<"new" | "learning" | "mastered">().notNull().default("new"),
    card: text("card", { mode: "json" }).$type<FsrsCardJson | null>(),
    dueAt: integer("due_at"),
    correctCount: integer("correct_count").notNull().default(0),
    wrongCount: integer("wrong_count").notNull().default(0),
  },
  (t) => [uniqueIndex("nodes_topic_key").on(t.topicId, t.key), index("nodes_due").on(t.dueAt)],
);

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  topicId: integer("topic_id"),
  kind: text("kind").$type<"lesson" | "practice" | "review">().notNull(),
  goal: text("goal").notNull().default(""),
  plannedMinutes: integer("planned_minutes"),
  messages: text("messages", { mode: "json" }).$type<ChatMsg[]>().notNull(),
  pending: text("pending", { mode: "json" }).$type<PendingState | null>(),
  /** Claude Code session that holds this lesson's context, and how many of our messages it has seen. */
  cc: text("cc", { mode: "json" }).$type<{ sessionId: string; sent: number } | null>(),
  summary: text("summary", { mode: "json" }).$type<SessionSummary | null>(),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
});

/** A question shown to the learner whose tool_result has not been written yet. */
export interface PendingState {
  toolUseId: string;
  attemptId: number;
  /** Results of sibling tool calls from the same assistant message, already executed. */
  siblingResults: { tool_use_id: string; content: string; is_error?: boolean }[];
  invalidCount: number;
}

export const attempts = sqliteTable(
  "attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id").notNull(),
    topicId: integer("topic_id"),
    nodeKey: text("node_key"),
    toolUseId: text("tool_use_id").notNull(),
    purpose: text("purpose").notNull(),
    kind: text("kind").notNull(),
    question: text("question", { mode: "json" }).$type<Question>().notNull(),
    answer: text("answer", { mode: "json" }).$type<AnswerPayload | null>(),
    /** null = not answered / awaiting the model's grade */
    outcome: text("outcome").$type<"correct" | "partial" | "wrong" | "skipped" | null>(),
    autoGraded: integer("auto_graded", { mode: "boolean" }).notNull().default(false),
    confidence: integer("confidence"),
    hintsUsed: integer("hints_used").notNull().default(0),
    misconceptionType: text("misconception_type"),
    misconception: text("misconception"),
    masteryApplied: integer("mastery_applied", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    answeredAt: integer("answered_at"),
  },
  (t) => [index("attempts_session").on(t.sessionId), index("attempts_topic").on(t.topicId)],
);

export const parking = sqliteTable("parking", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  topicId: integer("topic_id"),
  sessionId: integer("session_id"),
  text: text("text").notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export const sideMessages = sqliteTable(
  "side_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id").notNull(),
    role: text("role").$type<"user" | "assistant">().notNull(),
    text: text("text").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("side_session").on(t.sessionId)],
);

export const usage = sqliteTable(
  "usage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id"),
    purpose: text("purpose").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    /** USD; null when the price is unknown (custom endpoints, unlisted models). */
    cost: real("cost"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("usage_session").on(t.sessionId)],
);

/**
 * A stored question asked again without the tutor: the daily review queue and
 * mistake practice. Graded in the browser (or by the learner), costs nothing.
 */
export const drills = sqliteTable(
  "drills",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceAttemptId: integer("source_attempt_id").notNull(),
    topicId: integer("topic_id"),
    nodeKey: text("node_key"),
    mode: text("mode").$type<"review" | "mistakes" | "exam" | "explain">().notNull(),
    /** Set when the question is a card, not a lesson attempt (then sourceAttemptId is 0). */
    cardId: integer("card_id"),
    outcome: text("outcome").$type<"correct" | "partial" | "wrong">().notNull(),
    selfGraded: integer("self_graded", { mode: "boolean" }).notNull().default(false),
    confidence: integer("confidence"),
    hintsUsed: integer("hints_used").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("drills_source").on(t.sourceAttemptId), index("drills_topic").on(t.topicId), index("drills_created").on(t.createdAt)],
);

/** A quick overview ("экскурс") of a topic, some files or a repository, in theses. */
export const briefs = sqliteTable("briefs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").$type<"topic" | "files" | "repo" | "url" | "changes" | "review">().notNull(),
  title: text("title").notNull(),
  /** topic: the request; repo: the folder; files: the file names. */
  source: text("source").notNull(),
  /** Reading time it is written for, in minutes: 1, 5 or 15. */
  depth: integer("depth").notNull(),
  text: text("text").notNull(),
  /** Theses the learner opened, keyed by the thesis text: the elaboration (Markdown). */
  expansions: text("expansions", { mode: "json" }).$type<Record<string, string>>().notNull(),
  /** Files that were read to write it (repo and files). */
  files: text("files", { mode: "json" }).$type<string[]>().notNull(),
  topicId: integer("topic_id"),
  /** Files the overview was written from (topic and files kinds); they become the topic's materials. */
  materials: text("materials", { mode: "json" }).$type<{ name: string; content: string }[] | null>(),
  /** repo and changes: the commit the overview describes, so "what changed" knows where to start. */
  commit: text("commit"),
  createdAt: integer("created_at").notNull(),
});

/**
 * A practice question that did not come from a lesson: made from an overview or
 * a cheat sheet, or for an exam. Each card has its own review schedule.
 */
export const cards = sqliteTable(
  "cards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    topicId: integer("topic_id").notNull(),
    briefId: integer("brief_id"),
    nodeKey: text("node_key"),
    origin: text("origin").$type<"brief" | "notes" | "exam">().notNull(),
    question: text("question", { mode: "json" }).$type<Question>().notNull(),
    card: text("card", { mode: "json" }).$type<FsrsCardJson | null>(),
    dueAt: integer("due_at").notNull(),
    lastOutcome: text("last_outcome").$type<"correct" | "partial" | "wrong" | null>(),
    reps: integer("reps").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("cards_topic").on(t.topicId), index("cards_due").on(t.dueAt)],
);

export interface RepoChatMsg {
  role: "user" | "assistant";
  text: string;
  /** assistant: files that were read to answer */
  files?: string[];
  at: number;
}

/** Questions about a project, answered from its files. */
export const repoChats = sqliteTable("repo_chats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Local folder; for a GitHub link, the clone in data/repos. */
  repo: text("repo").notNull(),
  /** The GitHub link it was opened from, if any. */
  url: text("url"),
  title: text("title").notNull(),
  messages: text("messages", { mode: "json" }).$type<RepoChatMsg[]>().notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Files the learner attached to a topic: the tutor teaches from them. Text only (PDFs are extracted). */
export const topicFiles = sqliteTable(
  "topic_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    topicId: integer("topic_id").notNull(),
    name: text("name").notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("topic_files_topic").on(t.topicId)],
);

export interface ExplainRound {
  /** The learner's explanation (first round) or answer to the follow-up question. */
  text: string;
  review: {
    score: number;
    verdict: "correct" | "partial" | "wrong";
    good: string[];
    gaps: string[];
    errors: string[];
    followup: string;
    model: string;
  };
  at: number;
}

/** "Explain it in your own words": the learner teaches an idea back, the tutor finds the gaps. */
export const explanations = sqliteTable(
  "explanations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    topicId: integer("topic_id").notNull(),
    nodeKey: text("node_key"),
    concept: text("concept").notNull(),
    rounds: text("rounds", { mode: "json" }).$type<ExplainRound[]>().notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("explanations_topic").on(t.topicId)],
);

/** Getting ready for a date: an exam or a deadline, over one or more topics. The schedule is computed. */
export const studyPlans = sqliteTable("study_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  /** Local midnight of the exam day. */
  examDate: integer("exam_date").notNull(),
  topicIds: text("topic_ids", { mode: "json" }).$type<number[]>().notNull(),
  createdAt: integer("created_at").notNull(),
});

// ---------------------------------------------------------------------------
// Books: long sources (textbooks, problem books, lecture notes) kept page by
// page and split into sections, so a lesson reads only the part it needs.
// ---------------------------------------------------------------------------

export type BookRole = "main" | "problems" | "lectures" | "extra";
export type BookStatus = "reading" | "ocr" | "outlining" | "ready" | "error";
/** Where the table of contents came from, from the most to the least reliable. */
export type OutlineSource = "bookmarks" | "toc" | "headings" | "model" | "pages";

export const books = sqliteTable(
  "books",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    semesterId: integer("semester_id"),
    name: text("name").notNull(),
    role: text("role").$type<BookRole>().notNull().default("main"),
    /** pdf: real pages; text: fragments of about the same size. */
    format: text("format").$type<"pdf" | "text">().notNull(),
    pages: integer("pages").notNull().default(0),
    chars: integer("chars").notNull().default(0),
    /** The original file in data/books, for the page viewer and for OCR. */
    file: text("file"),
    /** Scanned pages (no text layer) to recognize, and how many are done. */
    ocrTotal: integer("ocr_total").notNull().default(0),
    ocrDone: integer("ocr_done").notNull().default(0),
    status: text("status").$type<BookStatus>().notNull().default("reading"),
    outlineSource: text("outline_source").$type<OutlineSource>(),
    /** PDF bookmarks or Markdown headings found while reading, kept until the outline is built. */
    bookmarks: text("bookmarks", { mode: "json" }).$type<{ title: string; level: number; page: number }[] | null>(),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("books_semester").on(t.semesterId)],
);

export const bookPages = sqliteTable(
  "book_pages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id").notNull(),
    /** 1-based, as the PDF viewer counts. */
    page: integer("page").notNull(),
    text: text("text").notNull(),
    /** 0: the PDF's own text; 1: scanned, waiting for OCR; 2: recognized by OCR. */
    ocr: integer("ocr").notNull().default(0),
  },
  (t) => [uniqueIndex("book_pages_page").on(t.bookId, t.page)],
);

export const bookSections = sqliteTable(
  "book_sections",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id").notNull(),
    idx: integer("idx").notNull(),
    /** 1 = chapter, 2 = section, 3 = subsection. */
    level: integer("level").notNull(),
    title: text("title").notNull(),
    pageFrom: integer("page_from").notNull(),
    pageTo: integer("page_to").notNull(),
    /** Written when a module that uses the section is prepared. */
    summary: text("summary"),
  },
  (t) => [index("book_sections_book").on(t.bookId, t.idx)],
);

// ---------------------------------------------------------------------------
// Semester: a whole course taken to the end. A program (parts, modules,
// sections) is built from books and/or a topic with a level; each module
// becomes a topic with lessons, closed by a checkpoint; cumulative exams,
// homework and a grade book on top.
// ---------------------------------------------------------------------------

export type SemesterLevel = "base" | "standard" | "advanced";
export type SemesterStatus = "preparing" | "draft" | "active" | "finished";

export interface ProgramSection {
  title: string;
  summary: string;
  /** book_sections ids this section is taught from; empty = not in the learner's materials. */
  refs: number[];
}

export interface Prereq {
  key: string;
  title: string;
  summary: string;
}

export const semesters = sqliteTable("semesters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  /** What the learner asked for: "матанализ, полный курс". May be empty when only books are given. */
  request: text("request").notNull().default(""),
  level: text("level").$type<SemesterLevel>().notNull(),
  goal: text("goal").notNull().default(""),
  weeks: integer("weeks").notNull(),
  hoursPerWeek: integer("hours_per_week").notNull(),
  /** Local midnight of the first day. */
  startDate: integer("start_date").notNull(),
  status: text("status").$type<SemesterStatus>().notNull(),
  /** What preparation is doing right now, for the progress view. */
  step: text("step"),
  error: text("error"),
  /** The model's estimate of the whole program. */
  estimateHours: real("estimate_hours"),
  prereqs: text("prereqs", { mode: "json" }).$type<Prereq[]>().notNull(),
  /** Honest remarks about the program: volume, what is missing, what was added. */
  notes: text("notes", { mode: "json" }).$type<string[]>().notNull(),
  /** Books to get, suggested when the semester has none. */
  recommended: text("recommended", { mode: "json" }).$type<string[]>().notNull(),
  createdAt: integer("created_at").notNull(),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
  /** Set while the semester is frozen (holiday, illness): the calendar stands still. */
  pausedAt: integer("paused_at"),
});

export const semesterModules = sqliteTable(
  "semester_modules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    semesterId: integer("semester_id").notNull(),
    idx: integer("idx").notNull(),
    /** Large courses are split into parts; modules of one part share the name. */
    part: text("part").notNull().default(""),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    hours: real("hours").notNull().default(4),
    /** prereq: the "zero" module with what the course assumes. */
    kind: text("kind").$type<"regular" | "prereq">().notNull().default("regular"),
    sections: text("sections", { mode: "json" }).$type<ProgramSection[]>().notNull(),
    topicId: integer("topic_id"),
    /** Book exercises and section summaries found while preparing, for lessons. */
    guide: text("guide"),
    preparedAt: integer("prepared_at"),
    /** How the module was closed: checkpoint passed, passed before learning, or the placement test. */
    credit: text("credit").$type<"exam" | "early" | "placement" | null>(),
    passedAt: integer("passed_at"),
  },
  (t) => [index("semester_modules_semester").on(t.semesterId, t.idx)],
);

export type AssessmentKind = "placement" | "checkpoint" | "midterm" | "final" | "homework" | "oral";

/** The grade book: every graded piece of work. */
export const semesterAssessments = sqliteTable(
  "semester_assessments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    semesterId: integer("semester_id").notNull(),
    moduleId: integer("module_id"),
    /** For homework: which task it grades (an appeal changes this row). */
    homeworkId: integer("homework_id"),
    kind: text("kind").$type<AssessmentKind>().notNull(),
    /** Percent, 0–100. */
    score: real("score").notNull(),
    passed: integer("passed", { mode: "boolean" }).notNull(),
    /** Per idea: key, title, got, total. */
    details: text("details", { mode: "json" }).$type<{ key: string; title: string; got: number; total: number }[]>().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("semester_assessments_semester").on(t.semesterId)],
);

export interface HomeworkCriterion {
  criterion: string;
  points: number;
}

export interface HomeworkReview {
  scores: { criterion: string; got: number; max: number; comment: string }[];
  total: number;
  feedback: string;
}

/** A weekly task that ties several ideas together, graded against a rubric. */
export const semesterHomework = sqliteTable(
  "semester_homework",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    semesterId: integer("semester_id").notNull(),
    week: integer("week").notNull(),
    moduleIds: text("module_ids", { mode: "json" }).$type<number[]>().notNull(),
    title: text("title").notNull(),
    task: text("task").notNull(),
    rubric: text("rubric", { mode: "json" }).$type<HomeworkCriterion[]>().notNull(),
    answer: text("answer"),
    review: text("review", { mode: "json" }).$type<HomeworkReview | null>(),
    /** The learner's objection to the grade, and the grade before it was reconsidered. */
    appeal: text("appeal"),
    firstReview: text("first_review", { mode: "json" }).$type<HomeworkReview | null>(),
    status: text("status").$type<"open" | "graded">().notNull().default("open"),
    createdAt: integer("created_at").notNull(),
    gradedAt: integer("graded_at"),
  },
  (t) => [index("semester_homework_semester").on(t.semesterId)],
);
