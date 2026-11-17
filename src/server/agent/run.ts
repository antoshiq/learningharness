// One application turn: take the learner's input, append it to the saved
// history, then let the model work (possibly several calls with tools) until
// it asks a question, ends the session, or finishes speaking.
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Db } from "../db";
import { getRoles } from "../config";
import { chatAs } from "../llm";
import { isToolUse, type Block, type ChatMsg, type ToolResultBlock } from "../llm/types";
import { applyAttempt } from "../mastery";
import { gradeAuto, normalizeOutput } from "@/lib/grading";
import type { AnswerPayload, Outcome, Question, StreamEvent, TurnInput } from "@/lib/types";
import { systemPrompt } from "./prompts";
import { initialState, planStateText, STATE_PREFIX, SYSTEM_PREFIX } from "./state";
import { executeTool, toolDefs } from "./tools";
import { runClaudeCodeTurn } from "./claude-code";
import type { PendingState } from "../db/schema";

const MAX_STEPS = 40;
const g = globalThis as unknown as { __tutorRunning?: Set<number>; __tutorInvalid?: Map<number, number> };
const running = (g.__tutorRunning ??= new Set());
const invalidStreak = (g.__tutorInvalid ??= new Map());

export const isRunning = (sessionId: number) => running.has(sessionId);
export const anyRunning = () => running.size > 0;

export class TurnError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const OUTCOME_RU: Record<Outcome, string> = { correct: "верно", partial: "частично", wrong: "неверно", skipped: "пропущен" };

/** Text of the tool_result the model receives for an answered question. */
export function answerResultText(attemptId: number, q: Question, a: AnswerPayload, auto: Outcome | null): string {
  const lines = [`attempt_id: ${attemptId}`];
  switch (q.kind) {
    case "choice":
      lines.push(`Ученик выбрал вариант ${a.choice}: ${q.options?.[a.choice ?? -1] ?? "?"}`);
      break;
    case "predict_output":
      lines.push(`Ответ ученика:\n${a.text ?? ""}`);
      lines.push(`Настоящий вывод программы:\n${normalizeOutput(a.actualOutput ?? "")}`);
      break;
    case "code":
    case "find_bug":
      lines.push(`Код ученика:\n${a.code ?? ""}`);
      if (a.run) {
        if (a.run.stdout) lines.push(`Вывод:\n${a.run.stdout.slice(0, 2000)}`);
        if (a.run.error) lines.push(`Ошибка при запуске с тестами:\n${a.run.error.slice(0, 2000)}`);
      }
      break;
    case "parsons":
      lines.push(`Порядок строк ученика:\n${(a.lines ?? []).join("\n")}`);
      break;
    default:
      lines.push(`Ответ ученика:\n${a.text ?? ""}`);
  }
  lines.push(
    auto
      ? `Авто-проверка: ${OUTCOME_RU[auto]}.`
      : "Авто-проверки нет: оцени ответ и вызови grade_answer с этим attempt_id.",
  );
  if (a.confidence) lines.push(`Уверенность: ${a.confidence} из 3.`);
  if (a.hintsUsed) lines.push(`Использовано подсказок: ${a.hintsUsed}.`);
  if (a.thinking?.trim()) lines.push(`Мысли вслух:\n${a.thinking.trim()}`);
  return lines.join("\n");
}

function loadSession(db: Db, id: number) {
  const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();
  if (!session) throw new TurnError("Сессия не найдена", 404);
  const topic = db.select().from(schema.topics).where(eq(schema.topics.id, session.topicId!)).get();
  if (!topic) throw new TurnError("Тема не найдена", 404);
  return { session, topic };
}

/** Close a pending question that the learner did not answer. */
function skipPending(db: Db, pending: PendingState, note: string, markInvalid = false): Block[] {
  db.update(schema.attempts)
    .set({ outcome: "skipped", answeredAt: Date.now(), misconceptionType: markInvalid ? "invalid_question" : null })
    .where(eq(schema.attempts.id, pending.attemptId))
    .run();
  return [
    ...pending.siblingResults.map((r) => ({ type: "tool_result" as const, ...r })),
    { type: "tool_result", tool_use_id: pending.toolUseId, content: note, is_error: markInvalid },
  ];
}

/** Build the user message for this input and persist it. Returns false when nothing was appended. */
function appendInput(db: Db, sessionId: number, input: TurnInput, emit: (e: StreamEvent) => void): void {
  const { session } = loadSession(db, sessionId);
  if (session.endedAt) throw new TurnError("Сессия уже завершена");
  const messages = session.messages;
  const pending = session.pending;
  let content: Block[] = [];

  switch (input.type) {
    case "start":
      if (messages.length) return; // already started: just continue the loop
      content = [{ type: "text", text: initialState(db, sessionId) }, { type: "text", text: `${SYSTEM_PREFIX} Начинай.` }];
      break;

    case "retry":
      if (!messages.length || messages[messages.length - 1].role !== "user") {
        throw new TurnError("Нечего повторять");
      }
      return;

    case "answer": {
      if (!pending || pending.attemptId !== input.attemptId) throw new TurnError("Этот вопрос уже не активен", 409);
      const attempt = db.select().from(schema.attempts).where(eq(schema.attempts.id, pending.attemptId)).get()!;
      const a = input.answer;
      const auto = gradeAuto(attempt.question, a);
      db.update(schema.attempts)
        .set({
          answer: a,
          outcome: auto,
          autoGraded: auto !== null,
          confidence: a.confidence ?? null,
          hintsUsed: Math.max(0, Math.min(3, a.hintsUsed ?? 0)),
          answeredAt: Date.now(),
        })
        .where(eq(schema.attempts.id, attempt.id))
        .run();
      invalidStreak.delete(sessionId);
      let text = answerResultText(attempt.id, attempt.question, a, auto);
      if (auto) {
        emit({ type: "graded", attemptId: attempt.id, outcome: auto });
        const line = applyAttempt(db, attempt.id);
        if (line) text += `\n${STATE_PREFIX} ${line}\n${planStateText(db, session.topicId!)}`;
      }
      content = [
        ...pending.siblingResults.map((r) => ({ type: "tool_result" as const, ...r })),
        { type: "tool_result", tool_use_id: pending.toolUseId, content: text },
      ];
      break;
    }

    case "invalid_question": {
      if (!pending || pending.attemptId !== input.attemptId) throw new TurnError("Этот вопрос уже не активен", 409);
      const streak = (invalidStreak.get(sessionId) ?? 0) + 1;
      invalidStreak.set(sessionId, streak);
      const advice =
        streak >= 2
          ? " Это уже не первая неудача подряд: задай вместо этого вопрос типа choice или free."
          : " Исправь и задай вопрос заново.";
      content = skipPending(
        db,
        pending,
        `Вопрос не показан ученику: проверка перед показом не прошла. ${input.detail.slice(0, 1500)}${advice}`,
        true,
      );
      break;
    }

    case "message": {
      const text = input.text.trim();
      if (!text) throw new TurnError("Пустое сообщение");
      if (pending) content = skipPending(db, pending, "Ученик не ответил на вопрос, а написал сообщение (см. ниже).");
      content.push({ type: "text", text });
      break;
    }

    case "finish":
      if (pending) content = skipPending(db, pending, "Ученик не ответил на вопрос: он завершает сессию.");
      content.push({ type: "text", text: `${SYSTEM_PREFIX} Ученик завершает сессию. Подведи итог: вызови end_session.` });
      break;
  }

  db.update(schema.sessions)
    .set({ messages: [...messages, { role: "user", content }], pending: null })
    .where(eq(schema.sessions.id, sessionId))
    .run();
}

export async function runTurn(sessionId: number, input: TurnInput, emit: (e: StreamEvent) => void): Promise<void> {
  const db = getDb();
  if (running.has(sessionId)) throw new TurnError("В этой сессии уже идёт ход", 409);
  running.add(sessionId);
  try {
    appendInput(db, sessionId, input, emit);

    // On a Claude subscription the model side runs inside Claude Code, which
    // owns the tool loop; it mirrors everything back into the same history.
    if (getRoles().strong.provider === "claude-code") {
      await runClaudeCodeTurn(sessionId, emit);
      return;
    }

    for (let step = 0; step < MAX_STEPS; step++) {
      const { session, topic } = loadSession(db, sessionId);
      emit({ type: "status", text: step === 0 ? "Думаю…" : "Продолжаю…" });

      let streamed = false;
      const result = await chatAs("strong", session.kind, sessionId, {
        system: systemPrompt(session.kind, topic.kind),
        messages: session.messages,
        tools: toolDefs(topic.kind),
        onText: (delta) => {
          streamed = true;
          emit({ type: "text", delta });
        },
      });
      if (streamed) emit({ type: "text_end" });

      const toolUses = result.content.filter(isToolUse);
      if (result.stopReason === "refusal") {
        emit({ type: "error", message: "Модель отказалась отвечать на этот запрос. Попробуй переформулировать." });
        return;
      }
      if (result.stopReason === "max_tokens" && toolUses.length) {
        // A truncated tool call must not run; the message is not saved, so "retry" repeats the call.
        emit({ type: "error", message: "Ответ модели оборвался по лимиту длины. Нажми «Повторить»." });
        return;
      }

      const assistant: ChatMsg = { role: "assistant", content: result.content };
      const history = [...session.messages, assistant];
      if (!toolUses.length) {
        db.update(schema.sessions).set({ messages: history }).where(eq(schema.sessions.id, sessionId)).run();
        return;
      }

      // Save the assistant message before running tools so tools see current state.
      db.update(schema.sessions).set({ messages: history }).where(eq(schema.sessions.id, sessionId)).run();
      const ctx = { db, session: { ...session, messages: history }, topic };
      const results: ToolResultBlock[] = [];
      let pending: { toolUseId: string; attemptId: number } | null = null;
      let ended = false;

      for (const tu of toolUses) {
        if (tu.name === "ask_question" && pending) {
          results.push({ type: "tool_result", tool_use_id: tu.id, content: "За один раз можно задать только один вопрос.", is_error: true });
          continue;
        }
        if (tu.name === "read_file" || tu.name === "search_code" || tu.name === "list_dir") {
          emit({ type: "status", text: "Читаю репозиторий…" });
        }
        const out = executeTool(ctx, tu.name, tu.id, tu.input);
        if (out.pendingAttemptId !== undefined) {
          pending = { toolUseId: tu.id, attemptId: out.pendingAttemptId };
          continue;
        }
        if (out.ended) ended = true;
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
      }

      if (pending) {
        // The question's own result is written when the learner answers.
        const state: PendingState = {
          ...pending,
          siblingResults: results.map(({ tool_use_id, content, is_error }) => ({ tool_use_id, content, is_error })),
          invalidCount: invalidStreak.get(sessionId) ?? 0,
        };
        db.update(schema.sessions).set({ pending: state }).where(eq(schema.sessions.id, sessionId)).run();
        return;
      }

      db.update(schema.sessions)
        .set({ messages: [...history, { role: "user", content: results }] })
        .where(eq(schema.sessions.id, sessionId))
        .run();
      if (ended) return;
    }
    emit({ type: "error", message: "Слишком много шагов подряд без вопроса к тебе. Напиши сообщение, чтобы продолжить." });
  } finally {
    running.delete(sessionId);
  }
}
