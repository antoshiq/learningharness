// OpenAI-compatible chat-completions adapter: OpenRouter and custom endpoints
// (Ollama, LM Studio, vLLM, any other compatible server).
import {
  LlmError,
  isText,
  isToolResult,
  isToolUse,
  type Block,
  type ChatMsg,
  type LlmProvider,
  type LlmRequest,
  type LlmResult,
  type StopReason,
} from "./types";

type OaiMsg =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

/** Convert the neutral history to chat-completions messages. Exported for tests. */
export function toOpenAiMessages(system: string, messages: ChatMsg[]): OaiMsg[] {
  const out: OaiMsg[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "assistant") {
      const text = m.content.filter(isText).map((b) => b.text).join("");
      const calls = m.content.filter(isToolUse).map((b) => ({
        id: b.id,
        type: "function" as const,
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
      // Provider-specific blocks (thinking etc.) are not representable here and are dropped.
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      // Tool results must directly follow the assistant message that made the calls.
      for (const b of m.content.filter(isToolResult)) {
        out.push({ role: "tool", tool_call_id: b.tool_use_id, content: (b.is_error ? "ОШИБКА: " : "") + b.content });
      }
      const text = m.content.filter(isText).map((b) => b.text).join("\n\n");
      if (text) out.push({ role: "user", content: text });
    }
  }
  return out;
}

interface Opts {
  id: string;
  baseUrl: string;
  apiKey?: string;
  /** OpenRouter: ask for real cost in the usage object. */
  openrouter?: boolean;
}

export function openAiProvider(opts: Opts): LlmProvider {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
  const label = opts.openrouter ? "OpenRouter" : "Сервер модели";

  async function fail(res: Response): Promise<never> {
    let detail = "";
    try {
      const body = await res.text();
      try {
        const j = JSON.parse(body);
        detail = j?.error?.message ?? j?.message ?? body.slice(0, 300);
      } catch {
        detail = body.slice(0, 300);
      }
    } catch {}
    if (res.status === 401) throw new LlmError(`${label}: неверный API-ключ`, 401);
    if (res.status === 402) throw new LlmError(`${label}: недостаточно средств на счёте`, 402);
    if (res.status === 404) throw new LlmError(`${label}: модель или адрес не найдены. ${detail}`, 404);
    if (res.status === 429) throw new LlmError(`${label}: превышен лимит запросов`, 429);
    throw new LlmError(`${label}: ошибка ${res.status}. ${detail}`, res.status);
  }

  return {
    id: opts.id,

    async chat(req: LlmRequest): Promise<LlmResult> {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: toOpenAiMessages(req.system, req.messages),
        stream: true,
        stream_options: { include_usage: true },
      };
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.schema },
        }));
      }
      if (opts.openrouter) {
        body.usage = { include: true };
        body.max_tokens = req.maxTokens ?? 32000;
      }

      let res: Response;
      try {
        res = await fetch(`${opts.baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: req.signal,
        });
      } catch (e) {
        throw new LlmError(`${label}: нет соединения (${opts.baseUrl}). ${e instanceof Error ? e.message : ""}`, 0);
      }
      if (!res.ok || !res.body) await fail(res);

      let text = "";
      const calls = new Map<number, { id: string; name: string; args: string }>();
      let finish: string | null = null;
      let usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: null as number | null };

      const handle = (data: string) => {
        if (data === "[DONE]") return;
        let j: any; // eslint-disable-line @typescript-eslint/no-explicit-any
        try {
          j = JSON.parse(data);
        } catch {
          return;
        }
        if (j.error) throw new LlmError(`${label}: ${j.error.message ?? JSON.stringify(j.error)}`);
        if (j.usage) {
          const cached = j.usage.prompt_tokens_details?.cached_tokens ?? 0;
          usage = {
            inputTokens: Math.max(0, (j.usage.prompt_tokens ?? 0) - cached),
            outputTokens: j.usage.completion_tokens ?? 0,
            cacheReadTokens: cached,
            cacheWriteTokens: 0,
            cost: typeof j.usage.cost === "number" ? j.usage.cost : null,
          };
        }
        const choice = j.choices?.[0];
        if (!choice) return;
        const d = choice.delta ?? {};
        if (typeof d.content === "string" && d.content) {
          text += d.content;
          req.onText?.(d.content);
        }
        for (const tc of d.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const cur = calls.get(idx) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(idx, cur);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      };

      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, "");
          buf = buf.slice(nl + 1);
          if (line.startsWith("data:")) handle(line.slice(5).trim());
        }
      }
      if (buf.startsWith("data:")) handle(buf.slice(5).trim());

      const content: Block[] = [];
      if (text) content.push({ type: "text", text });
      let n = 0;
      for (const [, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
        let input: unknown;
        try {
          input = c.args.trim() ? JSON.parse(c.args) : {};
        } catch {
          input = { __invalid_json: c.args };
        }
        content.push({ type: "tool_use", id: c.id || `call_${Date.now()}_${n++}`, name: c.name, input });
      }
      const stop: StopReason =
        calls.size > 0 ? "tool_use" : finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : "end";
      return { content, stopReason: stop, usage };
    },

    async listModels() {
      let res: Response;
      try {
        res = await fetch(`${opts.baseUrl}/models`, { headers });
      } catch {
        throw new LlmError(`${label}: нет соединения (${opts.baseUrl})`, 0);
      }
      if (!res.ok) await fail(res);
      const j = await res.json();
      const list: { id: string }[] = Array.isArray(j) ? j : (j.data ?? []);
      return list.map((m) => m.id).filter(Boolean).sort();
    },
  };
}
