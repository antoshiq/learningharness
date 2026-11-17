// Browser-side code execution. Python keeps one warm worker (loading Pyodide
// takes a few seconds once); JavaScript gets a fresh worker per run.
// Lessons use runCode (graded runs, serialized); the sandbox has its own Python
// worker so a long experiment never blocks a lesson, and it can be stopped.
import type { Language, RunResult } from "./types";

export interface ErrorAt {
  file: string;
  line: number;
}

export interface RunOutcome extends RunResult {
  /** The runtime itself failed to load (offline, blocked CDN). Not the learner's fault. */
  infra?: boolean;
  /** Where in the learner's code the error happened, when it can be told. */
  errorAt?: ErrorAt | null;
  /** Sandbox: matplotlib figures as base64 PNG. */
  images?: string[];
  /** Sandbox: stopped by the learner. */
  stopped?: boolean;
}

const RUN_TIMEOUT_MS = 10_000;
const SANDBOX_TIMEOUT_MS = 60_000;
const LOAD_TIMEOUT_MS = 90_000;

let pyWorker: Worker | null = null;
let seq = 0;
let queue: Promise<unknown> = Promise.resolve();

interface Job {
  code?: string;
  tests?: string;
  sandbox?: boolean;
  files?: { name: string; content: string }[];
  main?: string;
  stdin?: string;
}

function runIn(
  worker: Worker,
  onDead: () => void,
  persistent: boolean,
  job: Job,
  opts: { timeout: number; onOutput?: (text: string) => void; register?: (stop: () => void) => void },
): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const id = ++seq;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (r: RunOutcome, kill: boolean) => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      if (kill || !persistent) {
        worker.terminate();
        if (persistent) onDead();
      }
      resolve(r);
    };
    const arm = (ms: number, infra: boolean) => {
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          finish(
            infra
              ? { ok: false, stdout: "", error: "Среда выполнения не загрузилась за 90 секунд.", infra: true }
              : { ok: false, stdout: "", error: `Превышено время выполнения (${Math.round(opts.timeout / 1000)} секунд). Возможно, бесконечный цикл.`, timedOut: true },
            true,
          ),
        ms,
      );
    };
    let streamed = "";
    const onMessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.phase === "running") return arm(opts.timeout, false);
      if (m.phase === "out") {
        streamed += m.text;
        opts.onOutput?.(m.text);
        return;
      }
      finish(
        { ok: !!m.ok, stdout: m.stdout ?? "", error: m.error ?? null, infra: !!m.infra, errorAt: m.errorAt ?? null, images: m.images ?? [] },
        !!m.infra,
      );
    };
    const onError = (e: ErrorEvent) =>
      finish({ ok: false, stdout: "", error: e.message || "Не удалось запустить среду выполнения", infra: true }, true);
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    opts.register?.(() => finish({ ok: false, stdout: streamed, error: "Остановлено.", stopped: true }, true));
    arm(LOAD_TIMEOUT_MS, true);
    worker.postMessage({ id, ...job });
  });
}

/** Run code (optionally followed by tests in the same namespace). Runs are serialized. */
export function runCode(language: Language, code: string, tests?: string): Promise<RunOutcome> {
  const job = queue.then(async () => {
    let r: RunOutcome;
    if (language === "python") {
      pyWorker ??= new Worker("/py-worker.js", { type: "module" });
      r = await runIn(pyWorker, () => (pyWorker = null), true, { code, tests }, { timeout: RUN_TIMEOUT_MS });
      // Lessons run code and tests as one "<exec>": a line past the code is in the tests.
      if (r.errorAt && r.errorAt.line > code.split("\n").length) r.errorAt = null;
    } else {
      r = await runIn(new Worker("/js-worker.js"), () => {}, false, { code, tests }, { timeout: RUN_TIMEOUT_MS });
    }
    return r;
  });
  queue = job.catch(() => undefined);
  return job;
}

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

let sandboxPy: Worker | null = null;
let stopCurrent: (() => void) | null = null;

export interface SandboxRun {
  language: Language;
  files: { name: string; content: string }[];
  main: string;
  stdin?: string;
  onOutput?: (text: string) => void;
}

/** Run a sandbox project: several files, stdin, streamed output, figures. One run at a time. */
export async function runSandbox(r: SandboxRun): Promise<RunOutcome> {
  stopSandbox();
  const job: Job = { sandbox: true, files: r.files, main: r.main, stdin: r.stdin ?? "" };
  const register = (stop: () => void) => (stopCurrent = stop);
  try {
    if (r.language === "python") {
      sandboxPy ??= new Worker("/py-worker.js", { type: "module" });
      return await runIn(sandboxPy, () => (sandboxPy = null), true, job, { timeout: SANDBOX_TIMEOUT_MS, onOutput: r.onOutput, register });
    }
    return await runIn(new Worker("/js-worker.js"), () => {}, false, job, { timeout: SANDBOX_TIMEOUT_MS, onOutput: r.onOutput, register });
  } finally {
    stopCurrent = null;
  }
}

/** Stop the running sandbox program. Python then reloads (a few seconds) on the next run. */
export function stopSandbox() {
  stopCurrent?.();
  stopCurrent = null;
}

/** Turn an error's place into a line of a given file, if it is that file. */
export const lineIn = (at: ErrorAt | null | undefined, file: string) => (at && at.file === file ? at.line : null);
