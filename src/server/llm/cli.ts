// Running a model through a command-line program installed on this computer
// (Codex for a ChatGPT plan, Gemini CLI for a Google account). The program is
// signed in with the owner's own account, so no API key is involved.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "../paths";
import { imagesOf, LlmError, type Block, type LlmRequest, type LlmResult, type LlmUsage } from "./types";
import { parseReply, renderConversation, toolInstructions, VisibleText } from "./text-tools";

const TIMEOUT_MS = 10 * 60_000;

/** Model names go on the command line, so only plain identifiers are allowed. */
export function checkModel(model: string, label: string) {
  if (!/^[\w.:/-]+$/.test(model)) throw new LlmError(`${label}: недопустимое имя модели «${model}».`);
}

/** cmd.exe quoting for the Windows shell (needed to start npm's .cmd launchers). */
function winQuote(arg: string): string {
  if (/^[\w.:/\\=,+-]+$/.test(arg)) return arg;
  if (/["%!^]/.test(arg)) throw new LlmError(`Недопустимый символ в параметре запуска: ${arg}`);
  return `"${arg}"`;
}

/** A private folder under data/, created on demand. */
export function workDir(...parts: string[]): string {
  const dir = path.join(DATA_DIR, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write text to a one-off file and return its path and a cleanup function. */
export function tempFile(dir: string, text: string): { file: string; remove: () => void } {
  const file = path.join(workDir(dir), `${randomUUID()}.md`);
  fs.writeFileSync(file, text, "utf8");
  return { file, remove: () => fs.rmSync(file, { force: true }) };
}

export interface CliRun {
  bin: string;
  args: string[];
  input: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** Called for every JSON object the program prints, one per line. */
  onEvent: (ev: Record<string, unknown>) => void;
}

/** Start the program, feed the prompt on stdin and read JSON lines from stdout. */
export function runJsonLines(run: CliRun): Promise<{ code: number | null; stderr: string; missing: boolean }> {
  return new Promise((resolve, reject) => {
    const win = process.platform === "win32";
    const child = spawn(win ? winQuote(run.bin) : run.bin, win ? run.args.map(winQuote) : run.args, {
      cwd: run.cwd,
      env: run.env,
      shell: win,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    let pending = "";
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    const abort = () => child.kill();
    run.signal?.addEventListener("abort", abort);

    const line = (s: string) => {
      const t = s.trim();
      if (!t.startsWith("{")) return;
      try {
        run.onEvent(JSON.parse(t) as Record<string, unknown>);
      } catch {
        /* not an event line */
      }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      lines.forEach(line);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 20_000) stderr += chunk;
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (e.code === "ENOENT") resolve({ code: null, stderr: e.message, missing: true });
      else reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      run.signal?.removeEventListener("abort", abort);
      line(pending);
      // The Windows shell reports a missing program as text, not as ENOENT.
      const missing = /is not recognized as an internal or external command|не является внутренней или внешней/i.test(stderr);
      resolve({ code, stderr, missing });
    });
    child.stdin.on("error", () => {
      /* the program exited before reading everything; reported via close */
    });
    child.stdin.end(run.input, "utf8");
  });
}

/** Environment without the given variables (API keys that would bypass the subscription). */
export function envWithout(keys: string[]): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of keys) delete env[k];
  return env;
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** The request's pictures written to files in `dir` (the programs take pictures as files). */
export function imageFiles(req: LlmRequest, dir: string): { files: string[]; remove: () => void } {
  const files = imagesOf(req.messages).map((img) => {
    const file = path.join(workDir(dir), `${randomUUID()}.${EXT[img.source.media_type] ?? "jpg"}`);
    fs.writeFileSync(file, Buffer.from(img.source.data, "base64"));
    return file;
  });
  return { files, remove: () => files.forEach((f) => fs.rmSync(f, { force: true })) };
}

/** The pieces every text-only connection needs: system prompt, prompt and reply parsing. */
export function preparePrompt(req: LlmRequest) {
  const system = req.tools?.length ? req.system + toolInstructions(req.tools) : req.system;
  const prompt = renderConversation(req.messages);
  return { system, prompt };
}

let seq = 0;

/** Turn the model's whole reply into blocks, streaming the visible part if the program did not. */
export function finish(reply: string, req: LlmRequest, usage: LlmUsage, streamed: boolean): LlmResult {
  const prefix = `call_${Date.now().toString(36)}`;
  const content: Block[] = req.tools?.length ? parseReply(reply, () => `${prefix}_${seq++}`) : [{ type: "text", text: reply }];
  if (!streamed && req.onText) {
    const visible = content.find((b) => b.type === "text") as { text: string } | undefined;
    if (visible?.text) req.onText(visible.text);
  }
  return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", usage };
}

/** Stream text deltas to the caller, hiding tool-call blocks when the request has tools. */
export function streamer(req: LlmRequest) {
  if (!req.onText) return null;
  return req.tools?.length ? new VisibleText(req.onText) : { push: req.onText, end: () => {} };
}
