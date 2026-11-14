// Runs learner Python in the browser (Pyodide, WebAssembly). Nothing here can
// touch the computer's files: the code lives inside this worker's sandbox.
// The runtime is served by the app itself from /pyodide/ (see scripts/copy-pyodide.mjs);
// only extra packages such as numpy are downloaded from the CDN on first use.
const MAX_OUT = 20000;

let ready = null;
function init() {
  if (!ready) {
    ready = (async () => {
      const base = self.location.origin + "/pyodide/";
      const { version } = await (await fetch(base + "version.json")).json();
      // Pyodide only supports module workers; this file is loaded with { type: "module" }.
      const { loadPyodide } = await import(base + "pyodide.mjs");
      return await loadPyodide({
        indexURL: base,
        // Served under a neutral extension: download managers intercept ".zip".
        stdLibURL: base + "python_stdlib.data",
        packageBaseUrl: `https://cdn.jsdelivr.net/pyodide/v${version}/full/`,
      });
    })();
  }
  return ready;
}

// Keep the part of the traceback that refers to the learner's code.
function shortError(message) {
  const lines = String(message).split("\n");
  const i = lines.findIndex((l) => l.includes('File "<exec>"'));
  const kept = (i >= 0 ? lines.slice(i) : lines).filter((l) => l.trim() !== "");
  return kept.slice(-14).join("\n");
}

self.onmessage = async (e) => {
  const { id, code, tests } = e.data;
  let py;
  try {
    py = await init();
  } catch (err) {
    ready = null;
    self.postMessage({ id, infra: true, ok: false, stdout: "", error: String((err && err.message) || err) });
    return;
  }
  let out = "";
  const sink = { batched: (s) => { if (out.length < MAX_OUT) out += s + "\n"; } };
  py.setStdout(sink);
  py.setStderr(sink);
  self.postMessage({ id, phase: "running" });
  const ns = py.globals.get("dict")();
  ns.set("__name__", "__main__");
  try {
    await py.loadPackagesFromImports(code);
    await py.runPythonAsync(code, { globals: ns });
    if (tests) await py.runPythonAsync(tests, { globals: ns });
    self.postMessage({ id, ok: true, stdout: out, error: null });
  } catch (err) {
    self.postMessage({ id, ok: false, stdout: out, error: shortError((err && err.message) || err) });
  } finally {
    ns.destroy();
  }
};
