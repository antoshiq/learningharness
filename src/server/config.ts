import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { SECRETS_FILE } from "./paths";
import { getDb, schema } from "./db";
import { spentSince, startOfDay } from "./stats";
import type { AppConfig, ProviderId, RoleConfig } from "@/lib/types";

interface Secrets {
  anthropic?: string;
  openrouter?: string;
  custom?: string;
}

export function readSecrets(): Secrets {
  try {
    return JSON.parse(fs.readFileSync(SECRETS_FILE, "utf8")) as Secrets;
  } catch {
    return {};
  }
}

export function writeSecrets(patch: Secrets) {
  const next = { ...readSecrets() };
  for (const k of ["anthropic", "openrouter", "custom"] as const) {
    if (patch[k] === undefined) continue;
    if (patch[k] === "") delete next[k];
    else next[k] = patch[k]!.trim();
  }
  fs.mkdirSync(path.dirname(SECRETS_FILE), { recursive: true });
  const tmp = SECRETS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SECRETS_FILE);
}

export function apiKey(provider: "anthropic" | "openrouter" | "custom"): string | undefined {
  const saved = readSecrets()[provider];
  if (saved) return saved;
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY || undefined;
  if (provider === "openrouter") return process.env.OPENROUTER_API_KEY || undefined;
  return undefined;
}

export const mockEnabled = () => process.env.TUTOR_MOCK === "1";

const DEFAULT_ROLES: AppConfig["roles"] = {
  strong: { provider: "anthropic", model: "claude-opus-5-5" },
  cheap: { provider: "anthropic", model: "claude-haiku-5-5" },
};

function getSetting<T>(key: string, fallback: T): T {
  const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return row ? (row.value as T) : fallback;
}

function setSetting(key: string, value: unknown) {
  getDb()
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .run();
}

export function getRoles(): AppConfig["roles"] {
  if (mockEnabled()) {
    const mock: RoleConfig = { provider: "mock", model: "mock" };
    return { strong: mock, cheap: mock };
  }
  return { ...DEFAULT_ROLES, ...getSetting<Partial<AppConfig["roles"]>>("roles", {}) };
}

export const getCustomBaseUrl = () => getSetting<string>("customBaseUrl", "");

/** Daily spending cap in USD; null means no cap. */
export const getDailyLimit = () => getSetting<number | null>("dailyLimit", null);

/** Answers per day the learner aims for (lessons and practice together). */
export const DEFAULT_GOAL = 10;
export const getDailyGoal = () => getSetting<number>("dailyGoal", DEFAULT_GOAL);

export function getConfig(): AppConfig {
  return {
    roles: getRoles(),
    customBaseUrl: getCustomBaseUrl(),
    has: {
      anthropic: !!apiKey("anthropic"),
      openrouter: !!apiKey("openrouter"),
      custom: !!getCustomBaseUrl(),
      customKey: !!apiKey("custom"),
    },
    mockEnabled: mockEnabled(),
    dailyLimit: getDailyLimit(),
    spentToday: spentSince(startOfDay()),
    dailyGoal: getDailyGoal(),
  };
}

const PROVIDERS: ProviderId[] = ["anthropic", "openrouter", "custom", "claude-code"];

export function updateConfig(patch: {
  roles?: Partial<AppConfig["roles"]>;
  customBaseUrl?: string;
  keys?: Secrets;
  dailyLimit?: number | null;
  dailyGoal?: number;
}) {
  if (patch.dailyGoal !== undefined) {
    const g = Math.round(Number(patch.dailyGoal));
    if (!Number.isFinite(g) || g < 1 || g > 500) throw new Error("Цель — от 1 до 500 ответов в день");
    setSetting("dailyGoal", g);
  }
  if (patch.dailyLimit !== undefined) {
    const v = patch.dailyLimit;
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 10_000)) throw new Error("Лимит должен быть положительным числом долларов");
    if (v === null) getDb().delete(schema.settings).where(eq(schema.settings.key, "dailyLimit")).run();
    else setSetting("dailyLimit", Math.round(v * 100) / 100);
  }
  if (patch.roles) {
    const next = { ...getRoles() };
    for (const r of ["strong", "cheap"] as const) {
      const v = patch.roles[r];
      if (!v) continue;
      if (!PROVIDERS.includes(v.provider) || typeof v.model !== "string" || !v.model.trim()) {
        throw new Error("Некорректная модель");
      }
      next[r] = { provider: v.provider, model: v.model.trim() };
    }
    setSetting("roles", next);
  }
  if (patch.customBaseUrl !== undefined) {
    const url = patch.customBaseUrl.trim().replace(/\/+$/, "");
    if (url && !/^https?:\/\//i.test(url)) throw new Error("Адрес должен начинаться с http:// или https://");
    setSetting("customBaseUrl", url);
  }
  if (patch.keys) writeSecrets(patch.keys);
}

/** Is the given role usable right now? Returns a human-readable problem or null. */
export function roleProblem(role: RoleConfig): string | null {
  if (role.provider === "mock") return null;
  if (role.provider === "anthropic" && !apiKey("anthropic")) return "Не задан ключ Anthropic";
  if (role.provider === "openrouter" && !apiKey("openrouter")) return "Не задан ключ OpenRouter";
  if (role.provider === "custom" && !getCustomBaseUrl()) return "Не задан адрес своего сервера";
  return null;
}
