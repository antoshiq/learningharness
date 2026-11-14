import Anthropic from "@anthropic-ai/sdk";
import { anthropicCost } from "./pricing";
import { LlmError, type Block, type LlmProvider, type LlmRequest, type LlmResult, type StopReason } from "./types";

export function anthropicProvider(apiKey: string | undefined): LlmProvider {
  // With no saved key the SDK resolves credentials from the environment itself.
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();

  return {
    id: "anthropic",

    async chat(req: LlmRequest): Promise<LlmResult> {
      const tools: Anthropic.Tool[] | undefined = req.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.schema as Anthropic.Tool.InputSchema,
        // Inputs stream as generated; every tool input is validated with Zod before use.
        eager_input_streaming: true,
      }));
      try {
        const stream = client.messages.stream(
          {
            model: req.model,
            max_tokens: req.maxTokens ?? 32000,
            // Stable prefix first: the system prompt is cached, and the top-level
            // marker caches the growing conversation up to its last block.
            cache_control: { type: "ephemeral" },
            system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
            messages: req.messages as Anthropic.MessageParam[],
            ...(tools?.length ? { tools } : {}),
          },
          { signal: req.signal },
        );
        if (req.onText) stream.on("text", (delta) => req.onText!(delta));
        const msg = await stream.finalMessage();

        const usage = {
          inputTokens: msg.usage.input_tokens ?? 0,
          outputTokens: msg.usage.output_tokens ?? 0,
          cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
        };
        const stop: StopReason =
          msg.stop_reason === "tool_use"
            ? "tool_use"
            : msg.stop_reason === "max_tokens"
              ? "max_tokens"
              : msg.stop_reason === "refusal"
                ? "refusal"
                : "end";
        return {
          // Stored verbatim: thinking blocks must be replayed unchanged.
          content: msg.content as unknown as Block[],
          stopReason: stop,
          usage: { ...usage, cost: anthropicCost(req.model, usage) },
        };
      } catch (e) {
        throw mapError(e);
      }
    },

    async listModels() {
      const out: string[] = [];
      try {
        for await (const m of client.models.list()) out.push(m.id);
      } catch (e) {
        throw mapError(e);
      }
      return out;
    },
  };
}

function mapError(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError) return new LlmError("Anthropic: неверный API-ключ", 401);
  if (e instanceof Anthropic.PermissionDeniedError) return new LlmError("Anthropic: нет доступа к этой модели", 403);
  if (e instanceof Anthropic.NotFoundError) return new LlmError("Anthropic: модель не найдена", 404);
  if (e instanceof Anthropic.RateLimitError) return new LlmError("Anthropic: превышен лимит запросов, попробуй позже", 429);
  if (e instanceof Anthropic.BadRequestError) return new LlmError(`Anthropic отклонил запрос: ${e.message}`, 400);
  if (e instanceof Anthropic.APIConnectionError) return new LlmError("Нет соединения с Anthropic", 0);
  if (e instanceof Anthropic.APIError) return new LlmError(`Ошибка Anthropic ${e.status ?? ""}: ${e.message}`, e.status);
  return e instanceof Error ? e : new Error(String(e));
}
