// USD per 1M tokens for Anthropic first-party models. Used only to estimate
// cost; OpenRouter reports the real cost itself, custom endpoints stay unknown.
const PRICES: Record<string, { in: number; out: number; cacheRead: number }> = {
  "claude-fable-5-2": { in: 8, out: 40, cacheRead: 0.2 },
  "claude-fable-5-1": { in: 10, out: 50, cacheRead: 1 },
  "claude-fable-5": { in: 10, out: 50, cacheRead: 1 },
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2 },
  "claude-opus-5": { in: 5, out: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { in: 5, out: 25, cacheRead: 0.5 },
  "claude-opus-4-7": { in: 5, out: 25, cacheRead: 0.5 },
  "claude-opus-4-6": { in: 5, out: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.1 },
  "claude-sonnet-5": { in: 2, out: 10, cacheRead: 0.2 },
  "claude-sonnet-4-6": { in: 3, out: 15, cacheRead: 0.3 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01 },
  "claude-haiku-4-5": { in: 1, out: 5, cacheRead: 0.1 },
};

export function anthropicCost(
  model: string,
  u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
): number | null {
  const p = PRICES[model];
  if (!p) return null;
  return (
    (u.inputTokens * p.in + u.cacheWriteTokens * p.in * 1.25 + u.cacheReadTokens * p.cacheRead + u.outputTokens * p.out) /
    1_000_000
  );
}

/** Input price per 1M tokens, if known (for the repository analysis estimate). */
export const inputPrice = (model: string): number | null => PRICES[model]?.in ?? null;
