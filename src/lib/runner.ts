// Browser-side code execution. Python keeps one warm worker (loading Pyodide
// takes a few seconds once); JavaScript gets a fresh worker per run.
import type { Language, RunResult } from "./types";

export interface RunOutcome extends RunResult {
  /** The runtime itself failed to load (offline, blocked CDN). Not the learner's fault. */
  infra?: boolean;
}

const RUN_TIMEOUT_MS = 10_000;
const LOAD_TIMEOUT_MS = 90_000;

let pyWorker: Worker | null = null;
let seq = 0;
let queue: Promise<unknown> = Promise.resolve();

function runIn(worker: Worker, persistent: boolean, code: string, tests?: string): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const id = ++seq;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (r: RunOutcome, kill: boolean) => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      if (kill || !persistent) {
        worker.terminate();
        if (persistent) pyWorker = null;
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
              : { ok: false, stdout: "", error: "Превышено время выполнения (10 секунд). Возможно, бесконечный цикл.", timedOut: true },
            true,
          ),
        ms,
      );
    };
    const onMessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.phase === "running") return arm(RUN_TIMEOUT_MS, false);
      finish({ ok: !!m.ok, stdout: m.stdout ?? "", error: m.error ?? null, infra: !!m.infra }, !!m.infra);
    };
    const onError = (e: ErrorEvent) =>
      finish({ ok: false, stdout: "", error: e.message || "Не удалось запустить среду выполнения", infra: true }, true);
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    arm(LOAD_TIMEOUT_MS, true);
    worker.postMessage({ id, code, tests });
  });
}

/** Run code (optionally followed by tests in the same namespace). Runs are serialized. */
export function runCode(language: Language, code: string, tests?: string): Promise<RunOutcome> {
  const job = queue.then(() => {
    if (language === "python") {
      pyWorker ??= new Worker("/py-worker.js", { type: "module" });
      return runIn(pyWorker, true, code, tests);
    }
    return runIn(new Worker("/js-worker.js"), false, code, tests);
  });
  queue = job.catch(() => undefined);
  return job;
}
