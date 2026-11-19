// Lessons on a Google account through Google Antigravity, without an API key:
// the app runs the Antigravity CLI (`agy`) in print mode, signed in with the
// owner's Google account. It replaced Gemini CLI, which stopped working.
//
// agy is a coding agent and has no switch for its system prompt, so our
// instructions go at the top of the message and the run happens in an empty
// folder. In print mode its tools ask for permission nobody can give, so they
// are denied; only reading files inside that folder (the photos) goes through.
import { spawn } from "node:child_process";
import path from "node:path";
import { envWithout, finish, imageFiles, preparePrompt, runJsonLines, streamer, workDir } from "./cli";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResult } from "./types";

/** "default" leaves the choice to agy: the model picked in its own settings (/model). */
export const ANTIGRAVITY_MODELS = ["default"];

const BIN = () => process.env.TUTOR_AGY_PATH || "agy";
const LOGIN = "Antigravity: не выполнен вход. Открой терминал, запусти `agy` и войди через Google.";

/** Model names are shown as "Gemini 3.5 Pro (High)": letters, digits, spaces and brackets only. */
function checkModel(model: string) {
  if (!/^[\w .:/()+-]+$/.test(model)) throw new LlmError(`Antigravity: недопустимое имя модели «${model}».`);
}

function describe(detail: string): string {
  if (/not logged in|log ?in|sign ?in|unauthenticated|\b401\b|token source/i.test(detail)) return LOGIN;
  if (/quota|RESOURCE_EXHAUSTED|\b429\b|rate limit|limit reached/i.test(detail)) {
    return "Достигнут лимит Antigravity для твоего аккаунта. Попробуй позже или выбери другую модель.";
  }
  if (/model not specified|must specify a valid model|unknown model|invalid model|model.*not (found|available)/i.test(detail)) {
    return "Antigravity: такая модель недоступна. В «Настройках» нажми «Загрузить список моделей» и выбери из него, или поставь default.";
  }
  if (/flag provided but not defined|unknown (flag|option)/i.test(detail)) return "Antigravity CLI устарел для этого приложения. Обнови его: `agy update`.";
  if (/TLS handshake|timeout|dial tcp|no such host|connection refused/i.test(detail)) return "Antigravity: нет соединения с серверами Google. Проверь интернет или VPN.";
  return `Antigravity: ${detail.trim().slice(0, 500) || "неизвестная ошибка"}`;
}

const MISSING = "Не удалось запустить Antigravity CLI (`agy`). Установи Antigravity CLI и войди: запусти `agy` в терминале. Путь к программе можно задать в TUTOR_AGY_PATH.";

/** The top of every message: who is speaking and what not to do (agy's own prompt is about coding). */
function frame(system: string, photos: string[]): string {
  const see = photos.length
    ? `\n\nК последнему сообщению ученика приложены фотографии: ${photos.map((p) => `\`${p}\``).join(", ")}. Открой их инструментом просмотра файлов (view_file) и прочитай; другие инструменты не используй.`
    : "";
  return (
    "Ты работаешь не как агент для кода, а как модель внутри приложения-репетитора. Не используй свои инструменты " +
    "(команды, файлы, браузер, поиск), не создавай артефакты и планы: отвечай только текстом по инструкциям ниже." +
    see +
    `\n\n<instructions>\n${system}\n</instructions>`
  );
}

async function chat(req: LlmRequest): Promise<LlmResult> {
  const model = req.model.trim() || "default";
  checkModel(model);
  const { system, prompt } = preparePrompt(req);
  const cwd = workDir("antigravity");
  const images = imageFiles(req, path.join("antigravity", "img"));
  const photos = images.files.map((f) => path.relative(cwd, f).replace(/\\/g, "/"));
  const message = `${frame(system, photos)}\n\n${prompt}`;
  const live = streamer(req);

  // The prompt goes on stdin as one stream-json message: a command line is too short for a lesson.
  const args = ["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"];
  if (model !== "default") args.push("--model", model);
  args.push("--print=");

  const deltas: string[] = [];
  let response = "";
  let failure = "";
  let ok = false;
  let usage = { input: 0, cached: 0, output: 0 };
  try {
    const r = await runJsonLines({
      bin: BIN(),
      args,
      input: JSON.stringify({ event: "user", message: { content: message } }) + "\n",
      cwd,
      // A key in the environment would switch it from the Google sign-in to the paid API.
      env: envWithout(["GEMINI_API_KEY", "GOOGLE_API_KEY"]),
      signal: req.signal,
      onEvent: (ev) => {
        if (ev.event === "step_update") {
          const s = ev.step_update as { step_type?: string; text_delta?: string } | undefined;
          if (s?.step_type === "agent_response" && typeof s.text_delta === "string" && s.text_delta) {
            deltas.push(s.text_delta);
            live?.push(s.text_delta);
          }
        } else if (ev.event === "result") {
          const res = ev.result as
            | { status?: string; response?: string; error?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_read_tokens?: number } }
            | undefined;
          if (res?.status === "SUCCESS") ok = true;
          else failure = res?.error || res?.status || "";
          if (typeof res?.response === "string") response = res.response;
          const u = res?.usage;
          usage = { input: u?.input_tokens ?? 0, cached: u?.cache_read_tokens ?? 0, output: u?.output_tokens ?? 0 };
        }
      },
    });
    live?.end();
    if (r.missing) throw new LlmError(MISSING);
    if (!ok) throw new LlmError(describe(failure || r.stderr));
  } catch (e) {
    throw e instanceof LlmError ? e : new LlmError(describe(e instanceof Error ? e.message : String(e)));
  } finally {
    images.remove();
  }

  // The final answer; the streamed pieces only if agy left it out.
  const reply = response || deltas.join("");
  if (!reply.trim()) throw new LlmError("Antigravity: пустой ответ модели.");
  return finish(
    reply,
    req,
    { inputTokens: Math.max(0, usage.input - usage.cached), outputTokens: usage.output, cacheReadTokens: usage.cached, cacheWriteTokens: 0, cost: null },
    !!live,
  );
}

/** Model names from `agy models`, one per line, as agy prints them. */
export function parseModelList(out: string): string[] {
  const names = out
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/\x1b\[[0-9;]*m/g, "")
        .replace(/^[\s*>•✓✔-]+/, "")
        .replace(/\s+\((current|default|selected)\)\s*$/i, "")
        .trim(),
    )
    .filter((l) => l && !/^(fetching|available models|error|usage)\b/i.test(l) && !l.endsWith(":") && /^[\w .:/()+-]+$/.test(l));
  return [...new Set(names)];
}

function listModels(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const win = process.platform === "win32";
    const child = spawn(BIN(), ["models"], { cwd: workDir("antigravity"), env: envWithout(["GEMINI_API_KEY", "GOOGLE_API_KEY"]), shell: win, windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), 60_000);
    child.stdout.setEncoding("utf8").on("data", (c: string) => (out += c));
    child.stderr.setEncoding("utf8").on("data", (c: string) => (err += c));
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new LlmError(e.code === "ENOENT" ? MISSING : describe(e.message)));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (/is not recognized as an internal or external command|не является внутренней или внешней/i.test(err)) return reject(new LlmError(MISSING));
      const models = parseModelList(out);
      if (code !== 0 || !models.length) return reject(new LlmError(describe(`${err} ${out}`.replace(/Fetching available models\.*/i, "") || "список моделей пуст")));
      resolve(["default", ...models]);
    });
  });
}

export function antigravityProvider(): LlmProvider {
  return { id: "antigravity", listModels, chat };
}
