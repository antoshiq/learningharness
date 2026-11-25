// Context shaping and size estimation for lesson turns.
//
// Full history stays in SQLite (`session.messages`) so the UI transcript and
// theory capture never lose anything. Before sending history to a model, old
// heavy tool payloads (book pages, repository files, Python runs, duplicate
// plan snapshots, bulky fields of already-answered questions) are collapsed to
// compact stubs while keeping strict tool_use / tool_result pairing intact.
import { renderConversation, toolInstructions } from "../llm/text-tools";
import { isImage, isText, isToolResult, isToolUse, type Block, type ChatMsg, type ToolDef } from "../llm/types";

export const CONTEXT_LIMIT_CHARS = 1_000_000;
export const CONTEXT_WARN_CHARS = 800_000;
export const CONTEXT_CRITICAL_CHARS = 900_000;

/** Last N messages stay verbatim (roughly 2–4 learner/tutor exchanges). */
const RECENT_MESSAGES = 8;
/** Even inside the recent window, keep at most this many full read_book / read_file dumps. */
const KEEP_RECENT_HEAVY_READS = 2;

const PLAN_BLOCK_RE = /План \(✓ освоен, ◐ в процессе, ○ новый, 🔒 предпосылки не освоены\):[\s\S]*?(?:Доступны сейчас: [^\n]+|Все узлы освоены\.)/g;

export type ContextLevel = "ok" | "warn" | "critical";

export interface SessionContextInfo {
  /** Estimated character count of the optimized payload sent to the model. */
  chars: number;
  /** Estimated character count before optimization (for diagnostics / tooltip). */
  rawChars: number;
  /** Characters saved by optimization. */
  savedChars: number;
  limit: number;
  warnAt: number;
  criticalAt: number;
  level: ContextLevel;
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function stripSupersededPlan(text: string): string {
  return text.replace(PLAN_BLOCK_RE, "[актуальный план см. ниже]");
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function summarizeBookResult(input: Record<string, unknown> | null, len: number): string {
  const b = input?.book_id !== undefined ? ` книги b${input.book_id}` : "";
  const pages =
    input?.page_from !== undefined && input?.page_to !== undefined
      ? `стр. ${input.page_from}–${input.page_to}`
      : "страницы";
  return `[${pages}${b} прочитаны ранее (${len} симв.); при необходимости вызови read_book снова]`;
}

function summarizeFileResult(input: Record<string, unknown> | null, len: number): string {
  const p = typeof input?.path === "string" ? ` «${input.path}»` : "";
  const range =
    input?.start_line !== undefined || input?.end_line !== undefined
      ? ` (строки ${input.start_line ?? 1}–${input.end_line ?? "…"})`
      : "";
  return `[файл${p}${range} прочитан ранее (${len} симв.); при необходимости вызови read_file снова]`;
}

function compactOldAnswerResult(content: string): string {
  if (content.length <= 1600) return content;
  // Keep the header + learner answer prefix and the grading/state tail.
  const head = content.slice(0, 1100);
  const tail = content.slice(-350);
  return `${head}\n… [фрагмент ответа/вывода сокращён, всего ${content.length} симв.] …\n${tail}`;
}

function hasThinkingBlock(content: Block[]): boolean {
  return content.some((b) => b.type === "thinking" || b.type === "redacted_thinking");
}

function compactToolUseInput(
  name: string,
  input: unknown,
  opts: { invalid: boolean; hasNewerPlan: boolean },
): unknown {
  const obj = asObj(input);
  if (!obj) return input;

  if (name === "save_repo_map") {
    const ov = typeof obj.overview === "string" ? obj.overview : "";
    if (ov.length > 300) return { overview: `[карта проекта сохранена ранее (${ov.length} симв.)]` };
    return input;
  }

  if (name === "run_python") {
    const code = typeof obj.code === "string" ? obj.code : "";
    if (code.length > 300) return { code: `# код Python (${code.length} симв.) выполнен ранее` };
    return input;
  }

  if (name === "set_plan" && opts.hasNewerPlan && Array.isArray(obj.nodes)) {
    const slim = obj.nodes.map((n) => {
      const item = asObj(n);
      if (!item) return n;
      return { key: item.key, title: item.title };
    });
    return { nodes: slim };
  }

  if (name === "ask_question") {
    if (opts.invalid) {
      return {
        ...(obj.node_key ? { node_key: obj.node_key } : {}),
        purpose: obj.purpose,
        kind: obj.kind,
        prompt: "[вопрос отклонён проверкой перед показом]",
      };
    }
    const prompt = typeof obj.prompt === "string" ? clip(obj.prompt, 500) : "";
    const out: Record<string, unknown> = {
      ...(obj.node_key ? { node_key: obj.node_key } : {}),
      purpose: obj.purpose,
      kind: obj.kind,
      prompt,
    };
    if (typeof obj.code === "string" && obj.code.length <= 300) out.code = obj.code;
    return out;
  }

  return input;
}

/**
 * Produce an optimized copy of `messages` for the LLM call without mutating
 * the stored session history. Keeps recent turns verbatim and preserves all
 * tool_use / tool_result IDs and message alternation.
 */
export function compactMessagesForLlm(messages: ChatMsg[]): ChatMsg[] {
  if (messages.length <= 2) return messages;

  const toolById = new Map<string, { name: string; input: unknown }>();
  const invalidToolIds = new Set<string>();
  const readBookIds: string[] = [];
  const readFileIds: string[] = [];
  let lastPlanMsgIdx = -1;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    for (const b of m.content) {
      if (isToolUse(b)) {
        toolById.set(b.id, { name: b.name, input: b.input });
      } else if (isToolResult(b)) {
        const meta = toolById.get(b.tool_use_id);
        if (meta?.name === "read_book") readBookIds.push(b.tool_use_id);
        else if (meta?.name === "read_file") readFileIds.push(b.tool_use_id);
        if (b.is_error && b.content.includes("Вопрос не показан ученику")) {
          invalidToolIds.add(b.tool_use_id);
        }
        if (PLAN_BLOCK_RE.test(b.content)) lastPlanMsgIdx = i;
        PLAN_BLOCK_RE.lastIndex = 0;
      } else if (isText(b)) {
        if (PLAN_BLOCK_RE.test(b.text)) lastPlanMsgIdx = i;
        PLAN_BLOCK_RE.lastIndex = 0;
      }
    }
  }

  const keepBookIds = new Set(readBookIds.slice(-KEEP_RECENT_HEAVY_READS));
  const keepFileIds = new Set(readFileIds.slice(-KEEP_RECENT_HEAVY_READS));
  const recentStart = Math.max(0, messages.length - RECENT_MESSAGES);

  return messages.map((m, i): ChatMsg => {
    const isOld = i < recentStart;

    if (m.role === "assistant") {
      if (!isOld || hasThinkingBlock(m.content)) return m;
      let changed = false;
      const content = m.content.map((b) => {
        if (!isToolUse(b)) return b;
        const nextInput = compactToolUseInput(b.name, b.input, {
          invalid: invalidToolIds.has(b.id),
          hasNewerPlan: lastPlanMsgIdx > i,
        });
        if (nextInput === b.input) return b;
        changed = true;
        return { ...b, input: nextInput };
      });
      return changed ? { ...m, content } : m;
    }

    let changed = false;
    const content = m.content.map((b) => {
      if (isText(b)) {
        if (i < lastPlanMsgIdx && PLAN_BLOCK_RE.test(b.text)) {
          PLAN_BLOCK_RE.lastIndex = 0;
          changed = true;
          return { ...b, text: stripSupersededPlan(b.text) };
        }
        PLAN_BLOCK_RE.lastIndex = 0;
        return b;
      }

      if (!isToolResult(b)) return b;

      const meta = toolById.get(b.tool_use_id);
      const name = meta?.name ?? "";
      const inputObj = asObj(meta?.input);
      let next = b.content;

      if (i < lastPlanMsgIdx && PLAN_BLOCK_RE.test(next)) {
        PLAN_BLOCK_RE.lastIndex = 0;
        next = stripSupersededPlan(next);
      }
      PLAN_BLOCK_RE.lastIndex = 0;

      if (name === "read_book" && next.length > 600 && (isOld || !keepBookIds.has(b.tool_use_id))) {
        next = summarizeBookResult(inputObj, b.content.length);
      } else if (name === "read_file" && next.length > 600 && (isOld || !keepFileIds.has(b.tool_use_id))) {
        next = summarizeFileResult(inputObj, b.content.length);
      } else if (isOld) {
        if ((name === "search_book" || name === "search_code" || name === "list_dir") && next.length > 400) {
          next = `[результат ${name} скрыт (${b.content.length} симв.); при необходимости вызови снова]`;
        } else if (name === "run_python" && next.length > 350) {
          next = `${next.slice(0, 200)}\n… [вывод run_python сокращён, всего ${b.content.length} симв.]`;
        } else if (invalidToolIds.has(b.tool_use_id) && next.length > 250) {
          next = clip(next, 200);
        } else if (name === "ask_question" && next.length > 1600) {
          next = compactOldAnswerResult(next);
        }
      }

      if (next === b.content) return b;
      changed = true;
      return { ...b, content: next };
    });

    return changed ? { ...m, content } : m;
  });
}

function payloadChars(system: string, messages: ChatMsg[], tools: ToolDef[]): number {
  const sysChars = system.length + (tools.length ? toolInstructions(tools).length : 0);
  if (!messages.length) return sysChars;
  let imageChars = 0;
  for (const m of messages) {
    for (const b of m.content) {
      if (isImage(b)) imageChars += b.source.data.length;
    }
  }
  return sysChars + renderConversation(messages).length + imageChars;
}

export function measureSessionContext(system: string, messages: ChatMsg[], tools: ToolDef[]): SessionContextInfo {
  const rawChars = payloadChars(system, messages, tools);
  const compacted = compactMessagesForLlm(messages);
  const chars = compacted === messages ? rawChars : payloadChars(system, compacted, tools);
  const savedChars = Math.max(0, rawChars - chars);
  const level: ContextLevel =
    chars >= CONTEXT_CRITICAL_CHARS ? "critical" : chars >= CONTEXT_WARN_CHARS ? "warn" : "ok";
  return {
    chars,
    rawChars,
    savedChars,
    limit: CONTEXT_LIMIT_CHARS,
    warnAt: CONTEXT_WARN_CHARS,
    criticalAt: CONTEXT_CRITICAL_CHARS,
    level,
  };
}
