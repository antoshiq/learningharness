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
