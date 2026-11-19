// Lessons on a GitHub Copilot plan (Free, Pro, Pro+, Business…) without an API
// key. The owner signs in to GitHub once in Settings (the device flow: a code
// typed on github.com); the long-lived GitHub token is kept with the other
// keys. For each request it is exchanged for a short-lived Copilot token, and
// the Copilot chat API (OpenAI-compatible, with real tool calls) is called.
//
// This is the same sign-in the Copilot editor plugins use. GitHub does not
// document it for other programs, so it may change; meant for personal use.
import { apiKey } from "../config";
import { openAiProvider, type Connection } from "./openai";
import { LlmError, type LlmProvider } from "./types";

/** The public OAuth app of the Copilot editor plugins (VS Code, Copilot CLI). */
const CLIENT_ID = "Iv1.b507a08c87ecfe98";
const EDITOR = {
  "editor-version": "vscode/1.106.0",
  "editor-plugin-version": "copilot-chat/0.33.0",
  "user-agent": "GitHubCopilotChat/0.33.0",
};
const LOGIN = "GitHub Copilot: не выполнен вход. Открой «Настройки» → «GitHub Copilot» и войди через GitHub.";

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds between polls. */
  interval: number;
  expiresAt: number;
}

async function githubForm(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "user-agent": EDITOR["user-agent"] },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new LlmError(`GitHub: нет соединения. ${e instanceof Error ? e.message : ""}`, 0);
  }
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok && !j.error) throw new LlmError(`GitHub: ошибка ${res.status}`, res.status);
  return j;
}

/** Step 1 of signing in: GitHub gives a code for the owner to type on github.com/login/device. */
export async function startDeviceLogin(): Promise<DeviceCode> {
  const j = await githubForm("https://github.com/login/device/code", { client_id: CLIENT_ID, scope: "read:user" });
  if (typeof j.device_code !== "string" || typeof j.user_code !== "string") {
    throw new LlmError(`GitHub не выдал код входа: ${String(j.error_description ?? j.error ?? "неизвестная ошибка")}`);
  }
  return {
    deviceCode: j.device_code,
    userCode: j.user_code,
    verificationUri: typeof j.verification_uri === "string" ? j.verification_uri : "https://github.com/login/device",
    interval: Number(j.interval) || 5,
    expiresAt: Date.now() + (Number(j.expires_in) || 900) * 1000,
  };
}

export type PollResult = { status: "pending" | "slow_down" } | { status: "done"; token: string };

/** Step 2: ask whether the owner has entered the code yet. */
export async function pollDeviceLogin(deviceCode: string): Promise<PollResult> {
  const j = await githubForm("https://github.com/login/oauth/access_token", {
    client_id: CLIENT_ID,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  if (typeof j.access_token === "string" && j.access_token) return { status: "done", token: j.access_token };
  if (j.error === "authorization_pending") return { status: "pending" };
  if (j.error === "slow_down") return { status: "slow_down" };
  if (j.error === "expired_token") throw new LlmError("Код входа истёк. Начни вход заново.");
  if (j.error === "access_denied") throw new LlmError("Вход отменён на GitHub.");
  throw new LlmError(`GitHub: ${String(j.error_description ?? j.error ?? "неизвестная ошибка")}`);
}

interface CopilotToken {
  token: string;
  expiresAt: number;
  api: string;
  /** The GitHub token it was made from (a new sign-in invalidates it). */
  from: string;
}
let cached: CopilotToken | null = null;

/** The short-lived Copilot token for a GitHub token, renewed a minute before it expires. */
export async function copilotToken(github: string): Promise<CopilotToken> {
  if (cached && cached.from === github && cached.expiresAt - 60_000 > Date.now()) return cached;
  let res: Response;
  try {
    res = await fetch("https://api.github.com/copilot_internal/v2/token", {
      headers: { authorization: `token ${github}`, accept: "application/json", ...EDITOR },
    });
  } catch (e) {
    throw new LlmError(`GitHub Copilot: нет соединения. ${e instanceof Error ? e.message : ""}`, 0);
  }
  if (res.status === 401) throw new LlmError("GitHub Copilot: вход устарел. Войди через GitHub заново в «Настройках».", 401);
  if (res.status === 403 || res.status === 404) {
    throw new LlmError("GitHub Copilot: у этого аккаунта GitHub нет доступа к Copilot. Включи Copilot (есть бесплатный план) на github.com/settings/copilot.", 403);
  }
  if (!res.ok) throw new LlmError(`GitHub Copilot: ошибка ${res.status} при получении токена.`, res.status);
  const j = (await res.json()) as { token?: string; expires_at?: number; endpoints?: { api?: string } };
  if (!j.token) throw new LlmError("GitHub Copilot: токен не выдан.");
  cached = {
    token: j.token,
    expiresAt: (j.expires_at ?? Date.now() / 1000 + 600) * 1000,
    api: (j.endpoints?.api ?? "https://api.githubcopilot.com").replace(/\/+$/, ""),
    from: github,
  };
  return cached;
}

async function connect(): Promise<Connection> {
  const github = apiKey("copilot");
  if (!github) throw new LlmError(LOGIN, 401);
  const t = await copilotToken(github);
  return {
    baseUrl: t.api,
    apiKey: t.token,
    headers: { ...EDITOR, "copilot-integration-id": "vscode-chat", "openai-intent": "conversation-panel", "x-initiator": "user" },
  };
}

/** Chat models that answer on /chat/completions (some newer ones only speak the Responses API). */
function pickModels(list: Record<string, unknown>[]): string[] {
  return list
    .filter((m) => {
      const caps = m.capabilities as { type?: string } | undefined;
      if (caps?.type && caps.type !== "chat") return false;
      if (m.model_picker_enabled === false) return false;
      const ends = m.supported_endpoints;
      return !Array.isArray(ends) || ends.length === 0 || ends.includes("/chat/completions");
    })
    .map((m) => m.id as string);
}

export function copilotProvider(): LlmProvider {
  return openAiProvider({
    id: "copilot",
    label: "GitHub Copilot",
    connect,
    visionHeaders: { "copilot-vision-request": "true" },
    unauthorized: "GitHub Copilot: вход устарел. Войди через GitHub заново в «Настройках».",
    pickModels,
  });
}
