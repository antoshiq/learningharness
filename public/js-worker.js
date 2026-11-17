// Runs learner JavaScript in an isolated worker (a fresh one per run).
// Lesson runs: {id, code, tests}. Sandbox runs add {sandbox: true, files, main,
// stdin}: several files joined by require("./name"), input() from stdin and
// output streamed while running.
const MAX_OUT = 20000;
const MAX_OUT_SANDBOX = 400000;
// new Function / AsyncFunction put two lines of their own before the body.
const WRAPPER_LINES = 2;

// Node-like formatting so predicted output matches what learners expect.
function inspect(v, depth, nested) {
  if (typeof v === "string") return nested ? "'" + v.replace(/'/g, "\\'") + "'" : v;
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "bigint") return v + "n";
  if (typeof v === "function") return v.name ? `[Function: ${v.name}]` : "[Function (anonymous)]";
  if (typeof v === "symbol") return v.toString();
  if (typeof v !== "object") return String(v);
  if (v instanceof Error) return v.stack ? `${v.name}: ${v.message}` : String(v);
  if (depth > 2) return Array.isArray(v) ? "[Array]" : "[Object]";
  if (Array.isArray(v)) return v.length ? `[ ${v.map((x) => inspect(x, depth + 1, true)).join(", ")} ]` : "[]";
  if (v instanceof Map) {
    const items = [...v.entries()].map(([k, x]) => `${inspect(k, depth + 1, true)} => ${inspect(x, depth + 1, true)}`);
    return `Map(${v.size}) {${items.length ? " " + items.join(", ") + " " : ""}}`;
  }
  if (v instanceof Set) {
    const items = [...v].map((x) => inspect(x, depth + 1, true));
    return `Set(${v.size}) {${items.length ? " " + items.join(", ") + " " : ""}}`;
  }
  const keys = Object.keys(v);
  const name = v.constructor && v.constructor.name !== "Object" ? v.constructor.name + " " : "";
  if (!keys.length) return name + "{}";
  const body = keys.map((k) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : "'" + k + "'"}: ${inspect(v[k], depth + 1, true)}`);
  return `${name}{ ${body.join(", ")} }`;
}

/** Where in the learner's own files the error was thrown, from the stack. */
function errorLine(err, files) {
  const stack = String((err && err.stack) || "");
  for (const f of files) {
    const re = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":(\\d+):(\\d+)");
    const m = re.exec(stack);
    if (m) return { file: f, line: Math.max(1, Number(m[1]) - WRAPPER_LINES) };
  }
  return null;
}

self.onmessage = async (e) => {
  const { id, code, tests, sandbox, files, main, stdin } = e.data;
  const limit = sandbox ? MAX_OUT_SANDBOX : MAX_OUT;
  let out = "";
  let pending = "";
  let timer = null;
  const flush = () => {
    timer = null;
    if (pending) self.postMessage({ id, phase: "out", text: pending });
    pending = "";
  };
  const write = (...args) => {
    if (out.length >= limit) return;
    const line = args.map((a) => inspect(a, 0, false)).join(" ") + "\n";
    out += line;
    if (sandbox) {
      pending += line;
      timer ??= setTimeout(flush, 60);
    }
  };
  const fakeConsole = { log: write, info: write, warn: write, error: write, debug: write, table: write };
  const assert = (cond, message) => {
    if (!cond) throw new Error("Проверка не прошла" + (message ? ": " + message : ""));
  };
  const assertEqual = (got, want, message) => {
    const a = inspect(got, 0, true);
    const b = inspect(want, 0, true);
    if (a !== b) throw new Error(`${message ? message + ": " : ""}получено ${a}, ожидалось ${b}`);
  };
  const lines = typeof stdin === "string" && stdin.length ? stdin.replace(/\r\n?/g, "\n").split("\n") : [];
  const input = (promptText) => {
    if (promptText) write(String(promptText));
    return lines.length ? lines.shift() : null;
  };

  const all = sandbox ? files || [] : [];
  const mainName = sandbox ? main || "main.js" : "code.js";
  const source = sandbox ? (all.find((f) => f.name === mainName) || { content: code || "" }).content : code;

  // CommonJS between the sandbox files: require("./utils") or require("./utils.js").
  const cache = {};
  const require = (spec) => {
    const name = String(spec).replace(/^\.\//, "");
    const file = all.find((f) => f.name === name || f.name === name + ".js");
    if (!file) throw new Error(`Модуль "${spec}" не найден. Доступны: ${all.map((f) => "./" + f.name).join(", ") || "нет других файлов"}`);
    if (cache[file.name]) return cache[file.name].exports;
    const module = { exports: {} };
    cache[file.name] = module;
    const fn = new Function("module", "exports", "require", "console", "input", "prompt", file.content + "\n//# sourceURL=" + file.name);
    fn(module, module.exports, require, fakeConsole, input, input);
    return module.exports;
  };

  self.postMessage({ id, phase: "running" });
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const body = source + "\n;\n" + (tests || "") + "\n//# sourceURL=" + mainName;
    const fn = new AsyncFunction("console", "assert", "assertEqual", "require", "input", "prompt", "module", "exports", body);
    const module = { exports: {} };
    await fn(fakeConsole, assert, assertEqual, require, input, input, module, module.exports);
    if (timer) clearTimeout(timer), flush();
    self.postMessage({ id, ok: true, stdout: out, error: null });
  } catch (err) {
    const name = err && err.name ? err.name : "Error";
    const message = err && err.message ? err.message : String(err);
    if (timer) clearTimeout(timer), flush();
    let at = errorLine(err, sandbox ? all.map((f) => f.name) : [mainName]);
    // A failing test is not a line of the learner's code.
    if (at && !sandbox && at.line > String(code).split("\n").length) at = null;
    self.postMessage({ id, ok: false, stdout: out, error: `${name}: ${message}`, errorAt: at });
  }
};
