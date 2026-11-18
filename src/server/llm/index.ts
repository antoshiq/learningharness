import { apiKey, getCustomBaseUrl, getDailyLimit, getRoles, roleProblem } from "../config";
import { spentSince, startOfDay } from "../stats";
import { getDb, schema } from "../db";
import { claudeCodeProvider } from "../agent/claude-code";
import { anthropicProvider } from "./anthropic";
import { codexProvider } from "./codex";
import { geminiProvider } from "./gemini";
import { mockProvider } from "./mock";
import { openAiProvider } from "./openai";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResult } from "./types";
import type { ProviderId, RoleConfig } from "@/lib/types";

export function providerFor(id: ProviderId): LlmProvider {
  switch (id) {
    case "anthropic":
      return anthropicProvider(apiKey("anthropic"));
    case "openrouter":
      return openAiProvider({
        id: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: apiKey("openrouter"),
        openrouter: true,
      });
    case "custom":
      return openAiProvider({ id: "custom", baseUrl: getCustomBaseUrl(), apiKey: apiKey("custom") });
    case "claude-code":
      return claudeCodeProvider();
    case "codex":
      return codexProvider();
    case "gemini-cli":
      return geminiProvider();
    case "mock":
      return mockProvider();
  }
}

/** Run one model call for a role and record its token usage. */
export async function chatAs(
  roleName: "strong" | "cheap",
  purpose: string,
  sessionId: number | null,
  req: Omit<LlmRequest, "model">,
  roleOverride?: RoleConfig,
): Promise<LlmResult> {
  const role = roleOverride ?? getRoles()[roleName];
  const problem = roleProblem(role);
  if (problem) throw new LlmError(`${problem}. Открой «Настройки».`);
  const limit = role.provider === "mock" ? null : getDailyLimit();
  if (limit !== null) {
    const spent = spentSince(startOfDay());
    if (spent >= limit) {
      throw new LlmError(
        `Дневной лимит расходов исчерпан: потрачено $${spent.toFixed(2)} из $${limit.toFixed(2)}. Завтра лимит обновится; поднять его можно в «Настройках».`,
        429,
      );
    }
  }
  const result = await providerFor(role.provider).chat({ ...req, model: role.model });
  getDb()
    .insert(schema.usage)
    .values({
      sessionId,
      purpose,
      provider: role.provider,
      model: role.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      cacheWriteTokens: result.usage.cacheWriteTokens,
      cost: result.usage.cost,
      createdAt: Date.now(),
    })
    .run();
  return result;
}
