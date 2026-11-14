// Runs learner JavaScript in an isolated worker (a fresh one per run).
const MAX_OUT = 20000;

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

self.onmessage = async (e) => {
  const { id, code, tests } = e.data;
  let out = "";
  const write = (...args) => {
    if (out.length < MAX_OUT) out += args.map((a) => inspect(a, 0, false)).join(" ") + "\n";
  };
  const fakeConsole = { log: write, info: write, warn: write, error: write, debug: write };
  const assert = (cond, message) => {
    if (!cond) throw new Error("Проверка не прошла" + (message ? ": " + message : ""));
  };
  const assertEqual = (got, want, message) => {
    const a = inspect(got, 0, true);
    const b = inspect(want, 0, true);
    if (a !== b) throw new Error(`${message ? message + ": " : ""}получено ${a}, ожидалось ${b}`);
  };
  self.postMessage({ id, phase: "running" });
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction("console", "assert", "assertEqual", code + "\n;\n" + (tests || ""));
    await fn(fakeConsole, assert, assertEqual);
    self.postMessage({ id, ok: true, stdout: out, error: null });
  } catch (err) {
    const name = err && err.name ? err.name : "Error";
    const message = err && err.message ? err.message : String(err);
    self.postMessage({ id, ok: false, stdout: out, error: `${name}: ${message}` });
  }
};
