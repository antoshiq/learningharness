// Lessons on a ChatGPT plan (Plus, Pro, Business…) without an API key: the app
// runs the Codex command-line program (`codex exec`), signed in with the
// owner's ChatGPT account. Codex is a coding agent; here it is kept to plain
// replies: no user config, a read-only sandbox in an empty folder, no web
// search, and our own instructions in place of its built-in ones.
import { checkModel, envWithout, finish, preparePrompt, runJsonLines, tempFile, workDir } from "./cli";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResult } from "./types";

export const CODEX_MODELS = ["default", "gpt-6.2-sol", "gpt-6.1-sol", "gpt-6-sol", "gpt-5.5"];

const LOGIN = "Codex: не выполнен вход. Открой терминал, запусти `codex login` и войди через ChatGPT.";

function describe(detail: string): string {
  if (/not logged in|unauthori[sz]ed|\b401\b|codex login|token.*(expired|invalid)|refresh token/i.test(detail)) return LOGIN;
  if (/usage limit|rate limit|\b429\b|quota/i.test(detail)) return "Достигнут лимит подписки ChatGPT для Codex. Попробуй позже или выбери другую модель.";
  if (/model.*(not (found|supported|available))|does not exist|unsupported model/i.test(detail)) {
    return "Codex: такая модель недоступна на твоей подписке. Выбери другую в настройках (или «default»).";
  }
  if (/unexpected argument|unrecognized|unknown option/i.test(detail)) {
    return "Codex устарел для этого приложения. Обнови его: `npm install -g @openai/codex@latest`.";
  }
  return `Codex: ${detail.trim().slice(0, 500) || "неизвестная ошибка"}`;
}

async function chat(req: LlmRequest): Promise<LlmResult> {
  const model = req.model.trim();
  if (model !== "default") checkModel(model, "Codex");
  const { system, prompt } = preparePrompt(req);
  const instructions = tempFile("codex-prompts", system);

  const texts: string[] = [];
  const failures: string[] = [];
  let usage = { input: 0, cached: 0, output: 0 };
  try {
    const args = [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config", // the owner's MCP servers, profiles and the like stay out
      "--sandbox",
      "read-only",
      "-C",
      workDir("codex"),
      "-c",
      // TOML literal string: forward slashes and no escaping needed.
      `model_instructions_file='${instructions.file.replace(/\\/g, "/")}'`,
      "-c",
      "web_search='disabled'",
      ...(model !== "default" ? ["-m", model] : []),
      "-", // read the prompt from stdin
    ];
    const r = await runJsonLines({
      bin: process.env.TUTOR_CODEX_PATH || "codex",
      args,
      input: prompt,
      cwd: workDir("codex"),
      // With an API key in the environment Codex could bill it instead of the plan.
      env: envWithout(["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL"]),
      signal: req.signal,
      onEvent: (ev) => {
        const item = ev.item as { type?: string; text?: string } | undefined;
        if (ev.type === "item.completed" && item?.type === "agent_message" && item.text) texts.push(item.text);
        else if (ev.type === "turn.completed") {
          const u = ev.usage as { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number } | undefined;
          usage = { input: u?.input_tokens ?? 0, cached: u?.cached_input_tokens ?? 0, output: u?.output_tokens ?? 0 };
        } else if (ev.type === "turn.failed") failures.push(String((ev.error as { message?: string } | undefined)?.message ?? ""));
        else if (ev.type === "error" && typeof ev.message === "string") failures.push(ev.message);
      },
    });
    if (r.missing) throw new LlmError("Не удалось запустить Codex. Установи его (`npm install -g @openai/codex`) и войди: `codex login`.");
    if (!texts.length && (failures.length || r.code !== 0)) throw new LlmError(describe(failures.join("; ") || r.stderr));
  } catch (e) {
    throw e instanceof LlmError ? e : new LlmError(describe(e instanceof Error ? e.message : String(e)));
  } finally {
    instructions.remove();
  }

  return finish(
    texts.join("\n\n"),
    req,
    { inputTokens: Math.max(0, usage.input - usage.cached), outputTokens: usage.output, cacheReadTokens: usage.cached, cacheWriteTokens: 0, cost: null },
    false,
  );
}

export function codexProvider(): LlmProvider {
  return {
    id: "codex",
    async listModels() {
      return CODEX_MODELS;
    },
    chat,
  };
}
