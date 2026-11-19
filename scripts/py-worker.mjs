// Python for the tutor's own checks (src/server/python.ts): one Pyodide kept
// warm in a worker thread. Each run gets a fresh namespace; packages named in
// imports (sympy, numpy…) are fetched once from the Pyodide CDN and cached.
// The main thread kills this worker when a run takes too long.
import { parentPort, workerData } from "node:worker_threads";
import { loadPyodide } from "pyodide";

const ready = loadPyodide({ packageCacheDir: workerData?.cacheDir });

parentPort.on("message", async ({ id, code }) => {
  let out = "";
  const write = (s) => {
    if (out.length < 20_000) out += s + "\n";
  };
  try {
    const py = await ready;
    py.setStdout({ batched: write });
    py.setStderr({ batched: write });
    await py.loadPackagesFromImports(code, { messageCallback: () => {}, errorCallback: () => {} });
    const ns = py.toPy({});
    try {
      await py.runPythonAsync(code, { globals: ns });
    } finally {
      ns.destroy();
    }
    parentPort.postMessage({ id, out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // A Python traceback: its last lines say what went wrong.
    parentPort.postMessage({ id, out, error: msg.split("\n").slice(-6).join("\n") });
  }
});
