// Types shared by the server and the browser.

export type QuestionKind = "choice" | "free" | "math" | "code" | "predict_output" | "find_bug" | "parsons";
export type Purpose = "probe" | "predict" | "check" | "practice" | "review";
export type Language = "python" | "javascript";
export type Outcome = "correct" | "partial" | "wrong" | "skipped";

export const KIND_LABEL: Record<QuestionKind, string> = {
  choice: "Выбор ответа",
  free: "Свободный ответ",
  math: "Решение по шагам",
  code: "Напиши код",
  predict_output: "Предскажи вывод",
  find_bug: "Найди ошибку",
  parsons: "Собери программу",
};

export const PURPOSE_LABEL: Record<Purpose, string> = {
  probe: "Диагностика",
  predict: "Предсказание",
  check: "Проверка",
  practice: "Практика",
  review: "Повторение",
};

/** Full question as produced by the agent (stored server-side and sent to the browser). */
export interface Question {
  node_key?: string;
  purpose: Purpose;
  kind: QuestionKind;
  prompt: string;
  options?: string[];
  correct_option?: number;
  language?: Language;
  code?: string;
  solution?: string;
  tests?: string;
  distractors?: string[];
  reference_answer?: string;
  hints?: string[];
  explanation?: string;
}

export interface RunResult {
  ok: boolean;
  stdout: string;
  error: string | null;
  timedOut?: boolean;
}

/** What the browser sends when the learner answers. */
export interface AnswerPayload {
  /** choice: selected index */
  choice?: number;
  /** free / math / predict_output: typed text */
  text?: string;
  /** code / find_bug: submitted source */
  code?: string;
  /** parsons: lines in the order chosen */
  lines?: string[];
  /** code kinds: result of running submitted code against the tests in the browser */
  run?: RunResult;
  /** predict_output: real program output obtained by running it in the browser */
  actualOutput?: string;
  confidence?: 1 | 2 | 3 | null;
  hintsUsed?: number;
  thinking?: string;
}

export interface SessionSummary {
  learned: string[];
  weak: string[];
  next: string;
}

export interface FsrsCardJson {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: string;
}

export type NodeStatus = "new" | "learning" | "mastered";

export interface PlanNodeView {
  key: string;
  title: string;
  summary: string;
  deps: string[];
  status: NodeStatus;
  available: boolean;
  dueAt: number | null;
  correctCount: number;
  wrongCount: number;
}

/** Items of the visible transcript, derived from stored messages. */
export type TranscriptItem =
  | { type: "assistant"; text: string }
  | { type: "user"; text: string }
  | {
      type: "question";
      attemptId: number;
      question: Question;
      answer: AnswerPayload | null;
      outcome: Outcome | null;
      autoGraded: boolean;
      pending: boolean;
    }
  | { type: "event"; text: string };

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "text_end" }
  | { type: "status"; text: string }
  | { type: "graded"; attemptId: number; outcome: Outcome }
  | { type: "error"; message: string }
  /** Something new was stored, e.g. a quick overview; carries its id. */
  | { type: "saved"; id: number }
  | { type: "done" };

export type TurnInput =
  | { type: "start" }
  /** Re-run the model after a failed call; the learner's input is already saved. */
  | { type: "retry" }
  | { type: "answer"; attemptId: number; answer: AnswerPayload }
  | { type: "invalid_question"; attemptId: number; detail: string }
  | { type: "message"; text: string }
  /** The learner has read a theory step and wants the next one. */
  | { type: "continue" }
  /** "Explain in more detail": the current idea, deeper (an open question is set aside and asked again). */
  | { type: "more" }
  | { type: "finish" };

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: number | null;
  costKnown: boolean;
}

export type ProviderId = "anthropic" | "openrouter" | "custom" | "claude-code" | "codex" | "antigravity" | "copilot" | "mock";
export interface RoleConfig {
  provider: ProviderId;
  model: string;
}
export interface AppConfig {
  roles: { strong: RoleConfig; cheap: RoleConfig };
  customBaseUrl: string;
  has: { anthropic: boolean; openrouter: boolean; custom: boolean; customKey: boolean; copilot: boolean };
  mockEnabled: boolean;
  /** Daily spending cap in USD, or null. */
  dailyLimit: number | null;
  spentToday: number;
  /** Answers per day the learner aims for. */
  dailyGoal: number;
  /** How much theory the tutor gives on a new idea. */
  theoryDepth: TheoryDepth;
}

export type TheoryDepth = "brief" | "balanced" | "detailed";
export const THEORY_DEPTHS: TheoryDepth[] = ["brief", "balanced", "detailed"];

export const MISCONCEPTION_TYPES = [
  "пробел в предпосылке",
  "неверная ментальная модель",
  "непонимание условия",
  "вычислительная ошибка",
  "синтаксис",
  "невнимательность",
  "другое",
] as const;

/** A stored question offered again without the tutor (review queue, mistake practice). */
export interface DrillItem {
  /** The lesson attempt the question comes from, or minus the card id for a card. */
  attemptId: number;
  /** Set for cards (made from an overview, a cheat sheet or for an exam). */
  cardId?: number;
  question: Question;
  topic: { id: number; title: string };
  node: { key: string; title: string } | null;
  /** What happened the last time this question was answered. */
  last: { outcome: Outcome | null; answer: AnswerPayload | null; misconception: string | null; at: number };
  /** Review only: how many days the node is overdue. */
  overdueDays?: number;
}

/** Topics whose due ideas have no stored question to reuse: only the tutor can review them. */
export interface TutorReview {
  topicId: number;
  title: string;
  nodes: number;
}

export type SelfGrade = "correct" | "partial" | "wrong";

/** Kinds the browser cannot check; the learner compares with the reference answer. */
export const SELF_GRADED: QuestionKind[] = ["free", "math"];

/** One calendar day of activity, keyed by local date "YYYY-MM-DD". */
export interface DayActivity {
  date: string;
  answers: number;
  correct: number;
  /** Of `answers`, how many were practice without the tutor. */
  drills: number;
}

export interface DayCost {
  date: string;
  cost: number;
  tokens: number;
  /** Some calls had no known price (subscription, custom server). */
  unknown: boolean;
}

export interface Stats {
  today: string;
  days: DayActivity[];
  streak: { current: number; longest: number; activeDays: number };
  /** Today's answers against the daily goal, and how many recent days met it. */
  goal: { target: number; today: number; metDays: number };
  totals: { answers: number; correct: number; drills: number; minutes: number; sessions: number };
  topics: { id: number; title: string; answers: number; correct: number; mastered: number; total: number }[];
  calibration: { level: number; total: number; correct: number }[];
  cost: { days: DayCost[]; today: number; month: number; all: number; known: boolean; limit: number | null };
}
