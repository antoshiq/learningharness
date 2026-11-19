// Python on the server, for the tutor to check its own calculations before
// showing them (a worked example, the key of a math question). It runs in
// Pyodide (WebAssembly) in a worker thread: no files, no network from Python,
// and a run that takes too long is cut off by killing the worker.
import path from "node:path";
import { Worker } from "node:worker_threads";
import { DATA_DIR, ROOT } from "./paths";

const RUN_MS = 20_000;
/** The first run also starts Pyodide and may download sympy or numpy. */
const FIRST_RUN_MS = 120_000;
const MAX_OUT = 4000;

interface Job {
  id: number;
  resolve: (r: { out: string; error?: string }) => void;
}

const g = globalThis as unknown as { __tutorPy?: { worker: Worker; warm: boolean; jobs: Map<number, Job> } | null };
let seq = 0;

function worker() {
  if (g.__tutorPy) return g.__tutorPy;
  // Built from a path at run time so the bundler leaves the script (and Pyodide) alone.
  const file = path.join(ROOT, "scripts", "py-worker.mjs");
  const w = new Worker(file, { workerData: { cacheDir: path.join(DATA_DIR, "pyodide-cache") } });
  const state = { worker: w, warm: false, jobs: new Map<number, Job>() };
  w.on("message", (m: { id: number; out: string; error?: string }) => {
    state.warm = true;
    state.jobs.get(m.id)?.resolve(m);
    state.jobs.delete(m.id);
  });
  const fail = (why: string) => {
    for (const j of state.jobs.values()) j.resolve({ out: "", error: why });
    state.jobs.clear();
    if (g.__tutorPy === state) g.__tutorPy = null;
  };
  w.on("error", (e) => fail(`Python не запустился: ${e.message}`));
  w.on("exit", () => fail("Python остановлен."));
  w.unref();
  g.__tutorPy = state;
  return state;
}

const clip = (s: string) => (s.length > MAX_OUT ? s.slice(0, MAX_OUT) + "\n…(вывод обрезан)" : s);

/** Run a piece of Python and return what it printed, or the error. One run at a time. */
let queue: Promise<unknown> = Promise.resolve();
export function runPython(code: string): Promise<{ ok: boolean; text: string }> {
  const job = queue.then(
    () =>
      new Promise<{ ok: boolean; text: string }>((resolve) => {
        const state = worker();
        const id = ++seq;
        const limit = state.warm ? RUN_MS : FIRST_RUN_MS;
        const timer = setTimeout(() => {
          state.jobs.delete(id);
          void state.worker.terminate();
          resolve({ ok: false, text: `Время вышло (${limit / 1000} с): программа зациклилась или считает слишком долго. Упрости вычисление.` });
        }, limit);
        state.jobs.set(id, {
          id,
          resolve: (r) => {
            clearTimeout(timer);
            const out = r.out.trimEnd();
            if (r.error) resolve({ ok: false, text: clip([out, `Ошибка:\n${r.error}`].filter(Boolean).join("\n")) });
            else resolve({ ok: true, text: clip(out || "(программа ничего не напечатала: выводи результат через print)") });
          },
        });
        state.worker.postMessage({ id, code });
      }),
  );
  queue = job.catch(() => {});
  return job;
}
