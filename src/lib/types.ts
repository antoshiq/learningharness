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
  | { type: "done" };

export type TurnInput =
  | { type: "start" }
  /** Re-run the model after a failed call; the learner's input is already saved. */
  | { type: "retry" }
  | { type: "answer"; attemptId: number; answer: AnswerPayload }
  | { type: "invalid_question"; attemptId: number; detail: string }
  | { type: "message"; text: string }
  | { type: "finish" };

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: number | null;
  costKnown: boolean;
}

export type ProviderId = "anthropic" | "openrouter" | "custom" | "claude-code" | "mock";
export interface RoleConfig {
  provider: ProviderId;
  model: string;
}
export interface AppConfig {
  roles: { strong: RoleConfig; cheap: RoleConfig };
  customBaseUrl: string;
  has: { anthropic: boolean; openrouter: boolean; custom: boolean; customKey: boolean };
  mockEnabled: boolean;
}

export const MISCONCEPTION_TYPES = [
  "пробел в предпосылке",
  "неверная ментальная модель",
  "непонимание условия",
  "вычислительная ошибка",
  "синтаксис",
  "невнимательность",
  "другое",
] as const;
