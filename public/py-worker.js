// Runs learner Python in the browser (Pyodide, WebAssembly). Nothing here can
// touch the computer's files: the code lives inside this worker's sandbox.
// The runtime is served by the app itself from /pyodide/ (see scripts/copy-pyodide.mjs);
// only extra packages such as numpy are downloaded from the CDN on first use.
//
// Lesson runs: {id, code, tests}. Sandbox runs add {sandbox: true, files, main,
// stdin}: several files (importable as modules), input() from stdin, output
// streamed while running, matplotlib figures returned as PNG.
const MAX_OUT = 20000;
const MAX_OUT_SANDBOX = 400000;

let ready = null;
function init() {
  if (!ready) {
    ready = (async () => {
      const base = self.location.origin + "/pyodide/";
      const { version } = await (await fetch(base + "version.json")).json();
      // Pyodide only supports module workers; this file is loaded with { type: "module" }.
      const { loadPyodide } = await import(base + "pyodide.mjs");
      const py = await loadPyodide({
        indexURL: base,
        // Served under a neutral extension: download managers intercept ".zip".
        stdLibURL: base + "python_stdlib.data",
        packageBaseUrl: `https://cdn.jsdelivr.net/pyodide/v${version}/full/`,
      });
      // Plots render to images, never to a window.
      py.runPython('import os, warnings\nos.environ["MPLBACKEND"] = "AGG"\nwarnings.filterwarnings("ignore", message=".*non-interactive.*")');
      return py;
    })();
  }
  return ready;
}

// Keep the part of the traceback that refers to the learner's code.
function shortError(message, file) {
  const lines = String(message).split("\n");
  const i = lines.findIndex((l) => l.includes(`File "${file}"`) || l.includes('File "<exec>"'));
  const kept = (i >= 0 ? lines.slice(i) : lines).filter((l) => l.trim() !== "");
  return kept.slice(-14).join("\n");
}

/** The last place in the learner's own files where the error happened. */
function errorLine(message, files) {
  let found = null;
  const re = /File "([^"]+)", line (\d+)/g;
  let m;
  while ((m = re.exec(String(message)))) {
    if (files.includes(m[1])) found = { file: m[1], line: Number(m[2]) };
  }
  return found;
}

const FIGURES = `
import sys as _s
_imgs = []
if "matplotlib.pyplot" in _s.modules:
    import io as _io, base64 as _b64
    _plt = _s.modules["matplotlib.pyplot"]
    for _n in _plt.get_fignums():
        _buf = _io.BytesIO()
        _plt.figure(_n).savefig(_buf, format="png", dpi=110, bbox_inches="tight")
        _imgs.append(_b64.b64encode(_buf.getvalue()).decode())
    _plt.close("all")
_imgs
`;

let written = [];

self.onmessage = async (e) => {
  const { id, code, tests, sandbox, files, main, stdin } = e.data;
  let py;
  try {
    py = await init();
  } catch (err) {
    ready = null;
    self.postMessage({ id, infra: true, ok: false, stdout: "", error: String((err && err.message) || err) });
    return;
  }

  const limit = sandbox ? MAX_OUT_SANDBOX : MAX_OUT;
  let out = "";
  let pending = "";
  let timer = null;
  const flush = () => {
    timer = null;
    if (pending) self.postMessage({ id, phase: "out", text: pending });
    pending = "";
  };
  const sink = {
    batched: (s) => {
      if (out.length >= limit) return;
      out += s + "\n";
      if (sandbox) {
        pending += s + "\n";
        timer ??= setTimeout(flush, 60);
      }
    },
  };
  py.setStdout(sink);
  py.setStderr(sink);
  // input(): lines given in the sandbox, end of input otherwise.
  const lines = typeof stdin === "string" && stdin.length ? stdin.replace(/\r\n?/g, "\n").split("\n") : [];
  py.setStdin({ stdin: () => (lines.length ? lines.shift() : undefined) });

  self.postMessage({ id, phase: "running" });
  const fileNames = sandbox ? (files || []).map((f) => f.name) : [];
  const mainName = sandbox ? main || "main.py" : "<exec>";
  const source = sandbox ? ((files || []).find((f) => f.name === mainName) || { content: code || "" }).content : code;

  if (sandbox) {
    // The other files become importable modules; stale ones from the last run are removed.
    for (const name of written) if (!fileNames.includes(name)) try { py.FS.unlink(name); } catch {}
    for (const f of files || []) py.FS.writeFile(f.name, f.content);
    written = fileNames;
    const mods = fileNames.filter((n) => n.endsWith(".py")).map((n) => n.slice(0, -3));
    py.globals.set("_mods", py.toPy(mods));
    py.runPython("import sys, importlib\nfor _m in _mods: sys.modules.pop(_m, None)\nimportlib.invalidate_caches()\nif '' not in sys.path: sys.path.insert(0, '')");
  }

  const ns = py.globals.get("dict")();
  ns.set("__name__", "__main__");
  let images = [];
  try {
    await py.loadPackagesFromImports(source + "\n" + (sandbox ? (files || []).map((f) => f.content).join("\n") : ""));
    await py.runPythonAsync(source, { globals: ns, filename: mainName });
    if (tests) await py.runPythonAsync(tests, { globals: ns });
    if (sandbox) images = (await py.runPythonAsync(FIGURES)).toJs();
    if (timer) clearTimeout(timer), flush();
    self.postMessage({ id, ok: true, stdout: out, error: null, images });
  } catch (err) {
    const message = (err && err.message) || String(err);
    if (sandbox) {
      try {
        images = (await py.runPythonAsync(FIGURES)).toJs();
      } catch {}
    }
    if (timer) clearTimeout(timer), flush();
    self.postMessage({ id, ok: false, stdout: out, error: shortError(message, mainName), errorAt: errorLine(message, sandbox ? fileNames : ["<exec>"]), images });
  } finally {
    ns.destroy();
  }
};
