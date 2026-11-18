// Tool calling over plain text, for connections that only pass text in and out
// (the ChatGPT and Gemini subscriptions, driven through their command-line
// programs). The model writes each call as a tagged JSON block; we parse the
// blocks into ordinary tool_use blocks, so the lesson loop works unchanged.
import { isText, isToolResult, isToolUse, type Block, type ChatMsg, type TextBlock, type ToolDef, type ToolUseBlock } from "./types";

export const CALL_OPEN = "<tool_call>";
export const CALL_CLOSE = "</tool_call>";

/** Appended to the system prompt when the request has tools. */
export function toolInstructions(tools: ToolDef[]): string {
  const list = tools.map((t) => `## ${t.name}\n${t.description}\nВходные данные (JSON Schema): ${JSON.stringify(t.schema)}`).join("\n\n");
  return `

# Инструменты
Тебе доступны только эти инструменты. Встроенные инструменты среды (командная строка, файлы, поиск в интернете) не используй.

${list}

# Как вызвать инструмент
Выведи блок ровно в таком виде, с корректным JSON внутри:
${CALL_OPEN}
{"name": "имя_инструмента", "input": { ... }}
${CALL_CLOSE}

Правила:
- Обычный текст для ученика пиши до первого блока. Можно вызвать несколько инструментов подряд, по одному блоку на вызов.
- После последнего блока ничего не пиши: ход останавливается, а результаты придут в следующем сообщении.
- Никогда не придумывай результаты инструментов и ответы ученика сам.`;
}

const textOf = (m: ChatMsg) =>
  m.content
    .filter(isText)
    .map((b) => b.text)
    .join("\n\n");

/**
 * The conversation as one prompt. A lone user message is sent as is; longer
 * histories become a transcript with the model's own tool calls written back in
 * the same tagged form it is asked to use.
 */
export function renderConversation(messages: ChatMsg[]): string {
  if (messages.length === 1 && messages[0].role === "user" && !messages[0].content.some(isToolResult)) return textOf(messages[0]);

  const names = new Map<string, string>();
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      const lines: string[] = [];
      for (const b of m.content) {
        if (isText(b) && b.text.trim()) lines.push(b.text);
        else if (isToolUse(b)) {
          names.set(b.id, b.name);
          lines.push(`${CALL_OPEN}\n${JSON.stringify({ name: b.name, input: b.input })}\n${CALL_CLOSE}`);
        }
      }
      if (lines.length) parts.push(`### Ты\n${lines.join("\n")}`);
    } else {
      for (const b of m.content) {
        if (isToolResult(b)) {
          const name = names.get(b.tool_use_id) ?? "инструмент";
          parts.push(`### Результат ${name}${b.is_error ? " (ошибка)" : ""}\n${b.content}`);
        }
      }
      const t = textOf(m);
      if (t.trim()) parts.push(`### Ученик\n${t}`);
    }
  }
  return [
    "Ниже весь разговор до этого момента. «Ты» — твои прошлые сообщения.",
    "<разговор>",
    parts.join("\n\n"),
    "</разговор>",
    "Напиши своё следующее сообщение (только его, без заголовка «### Ты»).",
  ].join("\n\n");
}

function parseCall(raw: string, id: string): ToolUseBlock {
  const body = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const v = JSON.parse(body) as { name?: unknown; input?: unknown; arguments?: unknown };
    if (typeof v.name === "string") return { type: "tool_use", id, name: v.name, input: v.input ?? v.arguments ?? {} };
  } catch {
    /* reported below */
  }
  const name = /"name"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? "unknown";
  return { type: "tool_use", id, name, input: { __invalid_json: body } };
}

/**
 * Split a reply into the text for the learner and the tool calls. Text after
 * the first call is dropped: the model was told to stop there, and anything it
 * adds is usually an invented result.
 */
export function parseReply(reply: string, newId: () => string): Block[] {
  const start = reply.indexOf(CALL_OPEN);
  const text = (start < 0 ? reply : reply.slice(0, start)).trim();
  const out: Block[] = text ? [{ type: "text", text } satisfies TextBlock] : [];
  for (let at = start; at >= 0; ) {
    const from = at + CALL_OPEN.length;
    const next = reply.indexOf(CALL_OPEN, from);
    const limit = next >= 0 ? next : reply.length;
    // An unclosed block runs to the next opening tag or to the end of the reply.
    const end = reply.indexOf(CALL_CLOSE, from);
    out.push(parseCall(reply.slice(from, end >= 0 && end < limit ? end : limit), newId()));
    at = next;
  }
  return out;
}

/** Passes streamed text through until a tool call begins; holds back a possible partial tag. */
export class VisibleText {
  private buf = "";
  private done = false;
  constructor(private emit: (delta: string) => void) {}

  push(delta: string) {
    if (this.done) return;
    this.buf += delta;
    const at = this.buf.indexOf(CALL_OPEN);
    if (at >= 0) {
      this.flush(this.buf.slice(0, at).trimEnd());
      this.done = true;
      return;
    }
    // Keep a tail that could be the start of "<tool_call>".
    let keep = 0;
    for (let n = Math.min(CALL_OPEN.length - 1, this.buf.length); n > 0; n--) {
      if (CALL_OPEN.startsWith(this.buf.slice(-n))) {
        keep = n;
        break;
      }
    }
    const tail = this.buf.slice(this.buf.length - keep);
    this.flush(this.buf.slice(0, this.buf.length - keep));
    this.buf = tail;
  }

  end() {
    if (!this.done) this.flush(this.buf);
    this.done = true;
  }

  private flush(s: string) {
    if (s) this.emit(s);
    this.buf = "";
  }
}
