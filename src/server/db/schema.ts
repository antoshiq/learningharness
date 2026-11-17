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
