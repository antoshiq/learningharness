// Lessons on a Claude subscription. Instead of calling the API with a key, the
// app drives the Claude Code program installed on this computer (through the
// official Agent SDK), which is signed in with the owner's own Claude account.
//
// Claude Code keeps the conversation in its own session and runs the tool
// loop itself, so this module mirrors what happens into our saved history:
// the transcript, pending questions and mastery work exactly as with an API key.
import fs from "node:fs";
import path from "node:path";
import { createSdkMcpServer, query, tool, type Options } from "@anthropic-ai/claude-agent-sdk";
import { eq } from "drizzle-orm";
import { getRoles } from "../config";
import { getDb, schema } from "../db";
import type { PendingState } from "../db/schema";
import {
  isText,
  isToolResult,
  isToolUse,
  LlmError,
  type Block,
  type ChatMsg,
  type LlmProvider,
  type LlmRequest,
  type LlmResult,
  type TextBlock,
  type ToolResultBlock,
  type ToolUseBlock,
} from "../llm/types";
import { DATA_DIR } from "../paths";
import type { StreamEvent } from "@/lib/types";
import { systemPrompt } from "./prompts";
import { executeTool, semesterBookIds, toolShapes } from "./tools";

const SERVER = "tutor";
const MAX_TURNS = 60;

const ENV_NOTE = `

# Среда
Твои инструменты доступны с префиксом mcp__${SERVER}__ (например, mcp__${SERVER}__ask_question). Других инструментов нет.
После вызова ask_question или end_session ход останавливается автоматически: ничего не пиши после них.`;

/** Environment for the Claude Code process: the owner's login, never an API key. */
function childEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  for (const k of [
    // With these set Claude Code would bill an API key instead of using the subscription.
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    // Markers of a Claude Code session this server may have been started from.
    "CLAUDECODE",
    "CLAUDE_PID",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_SESSION_ID",
  ]) {
    delete env[k];
  }
  return env;
}

function baseOptions(model: string, system: string): Options {
  // An empty working folder: Claude Code finds no project files, CLAUDE.md or settings there.
  const cwd = path.join(DATA_DIR, "claude-code");
  fs.mkdirSync(cwd, { recursive: true });
  return {
    model,
    systemPrompt: system,
    tools: [], // none of Claude Code's own tools (files, shell, web)
    settingSources: [], // ignore the owner's Claude Code hooks, plugins, MCP servers and memory
    permissionMode: "dontAsk",
    includePartialMessages: true,
    cwd,
    env: childEnv(),
    ...(process.env.TUTOR_CLAUDE_PATH ? { pathToClaudeCodeExecutable: process.env.TUTOR_CLAUDE_PATH } : {}),
  };
}

const ERRORS: Record<string, string> = {
  authentication_failed: "Claude Code: не выполнен вход. Открой терминал, запусти `claude` и выполни /login.",
  oauth_org_not_allowed: "Claude Code: эта организация не разрешает такой вход.",
  account_on_hold: "Claude Code: аккаунт приостановлен.",
  verification_required: "Claude Code: аккаунт требует подтверждения. Запусти `claude` в терминале.",
  billing_error: "Claude Code: проблема с оплатой подписки.",
  rate_limit: "Достигнут лимит подписки Claude. Лимит общий с Claude Code и claude.ai; попробуй позже.",
  overloaded: "Серверы Claude перегружены. Попробуй через минуту.",
  model_not_found: "Claude Code: такая модель недоступна на твоей подписке. Выбери другую в настройках.",
};

function describeFailure(code: string | undefined, detail: string): string {
  if (code && ERRORS[code]) return ERRORS[code];
  if (/ENOENT|not found|spawn/i.test(detail)) {
    return "Не удалось запустить Claude Code. Проверь, что он установлен и что в нём выполнен вход (команда `claude`).";
  }
  return `Claude Code: ${detail || code || "неизвестная ошибка"}`;
}

const text = (m: ChatMsg) =>
  m.content
    .filter(isText)
    .map((b) => b.text)
    .join("\n\n");

/**
 * What to tell Claude Code this turn. Normally only the newest learner message
 * is new to it. If the lesson so far ran elsewhere (API key, lost session), the
 * earlier part is replayed as a transcript.
 */
export function renderPrompt(messages: ChatMsg[], sent: number): string {
  const fresh = messages.slice(sent);
  if (!fresh.length) return "Продолжай.";

  const last = fresh[fresh.length - 1];
  const lastPart = (() => {
    if (last.role !== "user") return "Продолжай.";
    // Results of sibling tool calls were already delivered inside Claude Code's
    // own loop; only the question's answer (always the last result) is news.
    const results = last.content.filter(isToolResult);
    const answer = results.length ? results[results.length - 1].content : "";
    return [answer, text(last)].filter(Boolean).join("\n\n") || "Продолжай.";
  })();
  if (fresh.length === 1 && last.role === "user") return lastPart;

  const lines: string[] = [];
  for (const m of fresh.slice(0, last.role === "user" ? -1 : undefined)) {
    for (const b of m.content) {
      if (isText(b)) lines.push(`${m.role === "user" ? "Ученик/система" : "Репетитор"}: ${b.text}`);
      else if (isToolUse(b)) lines.push(`[репетитор вызвал ${b.name}: ${JSON.stringify(b.input).slice(0, 3000)}]`);
      else if (isToolResult(b)) lines.push(`[результат: ${b.content.slice(0, 3000)}]`);
    }
  }
  return [
    "Этот урок уже шёл раньше через другое подключение. Ниже его запись. Продолжай с того места, где он остановился.",
    "<запись>",
    lines.join("\n\n"),
    "</запись>",
    lastPart,
  ].join("\n\n");
}

type Usage = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

function recordUsage(sessionId: number | null, purpose: string, model: string, u: Usage | undefined) {
  if (!u) return;
  getDb()
    .insert(schema.usage)
    .values({
      sessionId,
      purpose,
      provider: "claude-code",
      model,
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      // A subscription is not billed per token, so there is no cost to show.
      cost: null,
      createdAt: Date.now(),
    })
    .run();
}

const isMissingSession = (detail: string) => /no conversation found|session.*(not found|does not exist)/i.test(detail);

/** Run the model side of one turn through Claude Code. The learner's input is already saved. */
export async function runClaudeCodeTurn(sessionId: number, emit: (e: StreamEvent) => void): Promise<void> {
  const db = getDb();
  const first = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get()!;
  try {
    await attempt(sessionId, first.cc ?? null, emit);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (first.cc && isMissingSession(detail)) {
      // Claude Code no longer has that session: start a new one and replay the lesson so far.
      db.update(schema.sessions).set({ cc: null }).where(eq(schema.sessions.id, sessionId)).run();
      await attempt(sessionId, null, emit);
      return;
    }
    throw e instanceof LlmError ? e : new LlmError(describeFailure(undefined, detail));
  }
}

async function attempt(sessionId: number, cc: { sessionId: string; sent: number } | null, emit: (e: StreamEvent) => void) {
  const db = getDb();
  const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get()!;
  const topic = db.select().from(schema.topics).where(eq(schema.topics.id, session.topicId!)).get()!;
  const model = getRoles().strong.model;
  const ctx = { db, session, topic };

  let history = session.messages;
  let ccSessionId = cc?.sessionId ?? null;
  // Blocks of the assistant step being produced, and the results of its tool calls.
  let texts: TextBlock[] = [];
  let calls: ToolUseBlock[] = [];
  let results: ToolResultBlock[] = [];
  let pending: { toolUseId: string; attemptId: number } | null = null;
  let stop = false; // a question was shown or the session ended: nothing more this turn
  let seq = 0;

  /** Write the finished step into our own history. */
  const flush = () => {
    if (!texts.length && !calls.length) return;
    history = [...history, { role: "assistant", content: [...texts, ...calls] }];
    const set: Partial<typeof schema.sessions.$inferInsert> = {};
    if (pending) {
      // The question's own result is written when the learner answers.
      const state: PendingState = {
        ...pending,
        siblingResults: results.map(({ tool_use_id, content, is_error }) => ({ tool_use_id, content, is_error })),
        invalidCount: 0,
      };
      set.pending = state;
    } else if (calls.length) {
      history = [...history, { role: "user", content: results }];
    }
    set.messages = history;
    if (ccSessionId) set.cc = { sessionId: ccSessionId, sent: history.length };
    db.update(schema.sessions).set(set).where(eq(schema.sessions.id, sessionId)).run();
    texts = [];
    calls = [];
    results = [];
  };

  const specs = toolShapes(topic.kind, semesterBookIds(db, topic).length > 0);
  const server = createSdkMcpServer({
    name: SERVER,
    version: "1.0.0",
    tools: specs.map((s) =>
      tool(s.name, s.description, s.shape, async (args: unknown) => {
        const reply = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], isError });
        if (stop) return reply("Ход уже остановлен: дождись ответа ученика.", true);
        if (s.name === "read_file" || s.name === "search_code" || s.name === "list_dir") {
          emit({ type: "status", text: "Читаю репозиторий…" });
        }
        if (s.name === "read_book" || s.name === "search_book") emit({ type: "status", text: "Читаю учебник…" });
        const id = `cc_${Date.now().toString(36)}_${seq++}`;
        calls.push({ type: "tool_use", id, name: s.name, input: args });
        const out = executeTool(ctx, s.name, id, args);
        if (out.pendingAttemptId !== undefined) {
          pending = { toolUseId: id, attemptId: out.pendingAttemptId };
          stop = true;
          return reply("Вопрос показан ученику. Ход окончен: его ответ придёт следующим сообщением.");
        }
        if (out.ended) stop = true;
        results.push({ type: "tool_result", tool_use_id: id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
        return reply(out.content, !!out.isError);
      }),
    ),
  });

  const q = query({
    prompt: renderPrompt(history, cc?.sent ?? 0),
    options: {
      ...baseOptions(model, systemPrompt(session.kind, topic.kind) + ENV_NOTE),
      ...(cc ? { resume: cc.sessionId } : {}),
      mcpServers: { [SERVER]: server },
      allowedTools: specs.map((s) => `mcp__${SERVER}__${s.name}`),
      maxTurns: MAX_TURNS,
      hooks: {
        // Halt Claude Code's loop once a question is on screen or the session has ended.
        PostToolUse: [{ hooks: [async () => (stop ? { continue: false, stopReason: "Ожидание ученика" } : { continue: true })] }],
      },
    },
  });

  emit({ type: "status", text: "Думаю…" });
  let stepId: string | null = null;
  let streaming = false;
  let failure: string | null = null;

  for await (const m of q) {
    if ("session_id" in m && typeof m.session_id === "string" && m.session_id && !ccSessionId) {
      ccSessionId = m.session_id;
      // Our newest message is now part of Claude Code's session.
      db.update(schema.sessions)
        .set({ cc: { sessionId: ccSessionId, sent: history.length } })
        .where(eq(schema.sessions.id, sessionId))
        .run();
    }

    if (m.type === "stream_event") {
      if (m.parent_tool_use_id || stop) continue;
      const ev = m.event;
      if (ev.type === "content_block_start") streaming = ev.content_block.type === "text";
      else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") emit({ type: "text", delta: ev.delta.text });
      else if (ev.type === "content_block_stop" && streaming) {
        streaming = false;
        emit({ type: "text_end" });
      }
    } else if (m.type === "assistant") {
      if (m.parent_tool_use_id) continue;
      if (m.error) failure = describeFailure(m.error, "");
      // A new API message means the previous step (text + tool calls) is complete.
      if (stepId !== null && m.message.id !== stepId) flush();
      stepId = m.message.id;
      if (stop) continue;
      for (const b of m.message.content) {
        if (b.type === "text" && b.text.trim()) texts.push({ type: "text", text: b.text });
      }
    } else if (m.type === "result") {
      flush();
      recordUsage(sessionId, session.kind, model, m.usage);
      if (!stop && m.subtype !== "success") {
        const detail = "errors" in m ? m.errors.join("; ") : "";
        if (isMissingSession(detail)) throw new Error(detail);
        failure ??=
          m.subtype === "error_max_turns"
            ? "Слишком много шагов подряд без вопроса к тебе. Напиши сообщение, чтобы продолжить."
            : describeFailure(undefined, detail);
      } else if (!stop && m.is_error) {
        // Claude Code reports things like a reached usage limit as the result text.
        failure ??= describeFailure(undefined, "result" in m ? String(m.result) : "");
      }
    }
  }
  flush();
  if (failure && !stop) emit({ type: "error", message: failure });
}

/**
 * Tool-less calls through Claude Code: side questions and the connection test.
 * Lessons do not use this; they go through runClaudeCodeTurn.
 */
export function claudeCodeProvider(): LlmProvider {
  return {
    id: "claude-code",
    async listModels() {
      return ["opus", "sonnet", "haiku"];
    },
    async chat(req: LlmRequest): Promise<LlmResult> {
      if (req.tools?.length) throw new LlmError("Подключение через Claude Code не поддерживает этот вызов.");
      const prompt =
        req.messages.length === 1
          ? text(req.messages[0])
          : req.messages.map((m) => `${m.role === "user" ? "Ученик" : "Помощник"}: ${text(m)}`).join("\n\n") +
            "\n\nОтветь на последнее сообщение ученика.";
      let out = "";
      let usage: Usage | undefined;
      let failure: string | null = null;
      try {
        const q = query({ prompt, options: { ...baseOptions(req.model, req.system), persistSession: false, maxTurns: 1 } });
        for await (const m of q) {
          if (m.type === "stream_event" && !m.parent_tool_use_id) {
            const ev = m.event;
            if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
              out += ev.delta.text;
              req.onText?.(ev.delta.text);
            }
          } else if (m.type === "assistant" && m.error) failure = describeFailure(m.error, "");
          else if (m.type === "result") {
            usage = m.usage;
            if (m.subtype !== "success") failure ??= describeFailure(undefined, m.errors.join("; "));
            else if (m.is_error) failure ??= describeFailure(undefined, m.result);
            else if (!out) out = m.result;
          }
        }
      } catch (e) {
        throw new LlmError(describeFailure(undefined, e instanceof Error ? e.message : String(e)));
      }
      if (failure) throw new LlmError(failure);
      const content: Block[] = [{ type: "text", text: out }];
      return {
        content,
        stopReason: "end",
        usage: {
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
          cost: null,
        },
      };
    },
  };
}
