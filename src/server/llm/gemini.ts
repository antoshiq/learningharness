// Lessons on a Google account (free Gemini CLI quota or a Google AI plan)
// without an API key: the app runs the Gemini CLI program in headless mode,
// signed in with the owner's Google account. Its built-in tools are switched
// off and its system prompt is replaced with ours, so it only writes replies.
import fs from "node:fs";
import path from "node:path";
import { checkModel, envWithout, finish, preparePrompt, runJsonLines, streamer, tempFile, workDir } from "./cli";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResult } from "./types";

export const GEMINI_MODELS = ["auto", "pro", "flash", "flash-lite", "gemini-3.1-pro-preview", "gemini-3.5-flash", "gemini-2.5-pro"];

const SETTINGS = {
  // An allowlist that matches nothing: no shell, files, web or memory tools.
  tools: { core: ["none"] },
  skills: { enabled: false },
  // No GEMINI.md project notes are looked up (the folder is empty anyway).
  context: { fileName: "TUTOR_NO_CONTEXT.md" },
};

/** An empty working folder whose project settings disable Gemini CLI's own tools. */
function geminiDir(): string {
  const dir = workDir("gemini");
  const file = path.join(dir, ".gemini", "settings.json");
  const body = JSON.stringify(SETTINGS, null, 2);
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== body) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  return dir;
}

function describe(detail: string): string {
  if (/auth|login|credential|sign in|\b401\b|\b403\b/i.test(detail)) {
    return "Gemini CLI: не выполнен вход. Открой терминал, запусти `gemini` и войди через Google (Login with Google).";
  }
  if (/quota|RESOURCE_EXHAUSTED|\b429\b|rate limit/i.test(detail)) return "Достигнут лимит Gemini для твоего аккаунта. Попробуй позже или выбери модель flash.";
  if (/model.*(not found|not supported|invalid)|\b404\b/i.test(detail)) return "Gemini CLI: такая модель недоступна. Выбери другую в настройках (например auto).";
  if (/Unknown argument|Unknown arguments/i.test(detail)) return "Gemini CLI устарел для этого приложения. Обнови его: `npm install -g @google/gemini-cli@latest`.";
  return `Gemini CLI: ${detail.trim().slice(0, 500) || "неизвестная ошибка"}`;
}

async function chat(req: LlmRequest): Promise<LlmResult> {
  const model = req.model.trim();
  checkModel(model, "Gemini CLI");
  const { system, prompt } = preparePrompt(req);
  const systemFile = tempFile("gemini-prompts", system);
  const live = streamer(req);

  let reply = "";
  const failures: string[] = [];
  let ok = false;
  let usage = { input: 0, cached: 0, output: 0 };
  try {
    const r = await runJsonLines({
      bin: process.env.TUTOR_GEMINI_PATH || "gemini",
      args: ["--output-format", "stream-json", "--skip-trust", "--model", model],
      input: prompt,
      cwd: geminiDir(),
      env: {
        // Keys in the environment would switch it away from the Google login.
        ...envWithout(["GEMINI_API_KEY", "GOOGLE_API_KEY"]),
        GEMINI_SYSTEM_MD: systemFile.file,
      },
      signal: req.signal,
      onEvent: (ev) => {
        if (ev.type === "message" && ev.role === "assistant" && typeof ev.content === "string") {
          reply += ev.content;
          live?.push(ev.content);
        } else if (ev.type === "result") {
          const s = ev.stats as { input_tokens?: number; output_tokens?: number; cached?: number } | undefined;
          usage = { input: s?.input_tokens ?? 0, cached: s?.cached ?? 0, output: s?.output_tokens ?? 0 };
          if (ev.status === "success") ok = true;
          else failures.push(String((ev.error as { message?: string } | undefined)?.message ?? ""));
        } else if (ev.type === "error" && ev.severity === "error" && typeof ev.message === "string") failures.push(ev.message);
      },
    });
    live?.end();
    if (r.missing) throw new LlmError("Не удалось запустить Gemini CLI. Установи его (`npm install -g @google/gemini-cli`) и войди: запусти `gemini`.");
    if (!ok && !reply) throw new LlmError(describe(failures.join("; ") || r.stderr));
  } catch (e) {
    throw e instanceof LlmError ? e : new LlmError(describe(e instanceof Error ? e.message : String(e)));
  } finally {
    systemFile.remove();
  }

  return finish(
    reply,
    req,
    { inputTokens: Math.max(0, usage.input - usage.cached), outputTokens: usage.output, cacheReadTokens: usage.cached, cacheWriteTokens: 0, cost: null },
    !!live,
  );
}

export function geminiProvider(): LlmProvider {
  return {
    id: "gemini-cli",
    async listModels() {
      return GEMINI_MODELS;
    },
    chat,
  };
}
