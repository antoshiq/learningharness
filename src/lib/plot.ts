// Function plots for lessons: the ```plot block. A small safe expression
// language (no eval): numbers, x, + - * / ^, brackets, implicit
// multiplication (2x, 3sin(x), (x+1)(x-1)), the usual functions and pi, e.
//
//   ```plot
//   y = sin(x) | синус
//   y = x^2/4
//   x = 1          (a vertical line)
//   point 1, 0.84 | A
//   x: -6..6       (range; "x = -6..6" works too)
//   y: -2..4
//   ```

export type Fn = (x: number) => number;

const FUNCS: Record<string, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  tg: Math.tan,
  cot: (v) => 1 / Math.tan(v),
  ctg: (v) => 1 / Math.tan(v),
  asin: Math.asin,
  arcsin: Math.asin,
  acos: Math.acos,
  arccos: Math.acos,
  atan: Math.atan,
  arctg: Math.atan,
  arctan: Math.atan,
  sinh: Math.sinh,
  sh: Math.sinh,
  cosh: Math.cosh,
  ch: Math.cosh,
  tanh: Math.tanh,
  th: Math.tanh,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log,
  lg: Math.log10,
  log10: Math.log10,
  log2: Math.log2,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  sign: Math.sign,
  sgn: Math.sign,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] {
  const s = src.replace(/\\cdot|·|×/g, "*").replace(/π/g, "pi").replace(/−/g, "-").replace(/\*\*/g, "^").replace(/\\/g, "");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i))!;
      if (!m) throw new Error(`непонятное число в «${src}»`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (/[a-zA-Z]/.test(c)) {
      const m = /^(log10|log2|[a-zA-Z]+)/.exec(s.slice(i))!;
      // "xsin" or "2pix": split known names off the front.
      let w = m[0];
      while (w) {
        const name = ["x", ...Object.keys(FUNCS), ...Object.keys(CONSTS)]
          .filter((n) => w.toLowerCase().startsWith(n))
          .sort((a, b) => b.length - a.length)[0];
        if (!name) throw new Error(`неизвестное имя «${w}»`);
        out.push({ t: "id", v: name });
        w = w.slice(name.length);
      }
      i += m[0].length;
    } else if ("+-*/^(),".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else if (c === "[" || c === "{") {
      out.push({ t: "op", v: "(" });
      i++;
    } else if (c === "]" || c === "}") {
      out.push({ t: "op", v: ")" });
      i++;
    } else if (c === "|") {
      throw new Error("модуль пиши как abs(...)");
    } else {
      throw new Error(`непонятный знак «${c}»`);
    }
  }
  return out;
}

/** Compile an expression in x. Throws with a readable reason. */
export function compile(src: string): Fn {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;
  const startsFactor = () => {
    const t = peek();
    return !!t && (t.t === "num" || t.t === "id" || (t.t === "op" && t.v === "("));
  };

  // expr := term (('+'|'-') term)*
  const expr = (): Fn => {
    let a = term();
    while (isOp("+") || isOp("-")) {
      const op = toks[p++].v;
      const l = a;
      const r = term();
      a = op === "+" ? (x) => l(x) + r(x) : (x) => l(x) - r(x);
    }
    return a;
  };
  // term := unary (('*'|'/'|implicit) unary)*
  const term = (): Fn => {
    let a = unary();
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const op = toks[p++].v;
        const l = a;
        const r = unary();
        a = op === "*" ? (x) => l(x) * r(x) : (x) => l(x) / r(x);
      } else if (startsFactor()) {
        const l = a;
        const r = power();
        a = (x) => l(x) * r(x);
      } else return a;
    }
  };
  // unary := '-' unary | '+' unary | power   (so -x^2 is -(x^2))
  const unary = (): Fn => {
    if (isOp("-")) {
      p++;
      const a = unary();
      return (x) => -a(x);
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    return power();
  };
  // power := atom ('^' unary)?   (right-associative)
  const power = (): Fn => {
    const base = atom();
    if (isOp("^")) {
      p++;
      const ex = unary();
      return (x) => Math.pow(base(x), ex(x));
    }
    return base;
  };
  const atom = (): Fn => {
    const t = toks[p++];
    if (!t) throw new Error("выражение оборвалось");
    if (t.t === "num") return () => t.v;
    if (t.t === "op" && t.v === "(") {
      const a = expr();
      if (!isOp(")")) throw new Error("не закрыта скобка");
      p++;
      return a;
    }
    if (t.t === "id") {
      if (t.v === "x") return (x) => x;
      if (t.v in CONSTS) {
        const c = CONSTS[t.v];
        return () => c;
      }
      const f = FUNCS[t.v];
      // sin x, sin^2(x) and sin(x) are all accepted.
      let pow: Fn | null = null;
      if (isOp("^")) {
        p++;
        pow = atom();
      }
      const arg = isOp("(") ? atom() : power();
      return pow ? (x) => Math.pow(f(arg(x)), pow!(x)) : (x) => f(arg(x));
    }
    throw new Error(`лишний знак «${t.v}»`);
  };

  const fn = expr();
  if (p < toks.length) throw new Error(`лишнее в конце: «${toks.slice(p).map((t) => t.v).join("")}»`);
  return fn;
}

export interface PlotSpec {
  curves: { label: string; fn: Fn }[];
  vlines: { x: number; label: string }[];
  points: { x: number; y: number; label: string }[];
  x: [number, number];
  y: [number, number] | null;
}

const num = (s: string) => {
  const v = compile(s)(0);
  if (!Number.isFinite(v)) throw new Error(`не число: «${s}»`);
  return v;
};
const range = (s: string): [number, number] => {
  const [a, b] = s.split("..");
  const lo = num(a);
  const hi = num(b);
  if (!(hi > lo)) throw new Error(`пустой диапазон «${s}»`);
  return [lo, hi];
};

/** Read a ```plot block. Throws with the line that is wrong. */
export function parsePlot(src: string): PlotSpec {
  const spec: PlotSpec = { curves: [], vlines: [], points: [], x: [-5, 5], y: null };
  for (const raw of src.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [body, ...rest] = line.split("|");
    const label = rest.join("|").trim();
    const b = body.trim();
    try {
      let m: RegExpExecArray | null;
      if ((m = /^x\s*[:=]\s*(.+\.\..+)$/i.exec(b))) spec.x = range(m[1]);
      else if ((m = /^y\s*[:=]\s*(.+\.\..+)$/i.exec(b))) spec.y = range(m[1]);
      else if ((m = /^(?:point|точка)\s+(.+),(.+)$/i.exec(b))) spec.points.push({ x: num(m[1]), y: num(m[2]), label });
      else if ((m = /^x\s*=\s*(.+)$/i.exec(b))) spec.vlines.push({ x: num(m[1]), label: label || `x = ${m[1].trim()}` });
      else if ((m = /^(?:y|[a-zA-Z]\s*\(\s*x\s*\))\s*=\s*(.+)$/.exec(b))) {
        const name = /^[a-zA-Z]\s*\(\s*x\s*\)/.exec(b)?.[0].replace(/\s/g, "");
        spec.curves.push({ label: label || (name ? `${name} = ${m[1].trim()}` : `y = ${m[1].trim()}`), fn: compile(m[1]) });
      } else throw new Error("ожидалось y = …, x = …, x: a..b, y: a..b или point x, y");
    } catch (e) {
      throw new Error(`«${b}»: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (!spec.curves.length && !spec.points.length && !spec.vlines.length) throw new Error("нечего рисовать");
  return spec;
}

/** Round tick steps: 1, 2, 5 × 10^k, about `count` of them over the span. */
export function ticks(lo: number, hi: number, count = 8): number[] {
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  return out;
}

/** A y range that shows the curves well: the middle of the values, ignoring blow-ups near asymptotes. */
export function autoY(spec: PlotSpec): [number, number] {
  const vals: number[] = [];
  const [a, b] = spec.x;
  for (const c of spec.curves) {
    for (let i = 0; i <= 200; i++) {
      const v = c.fn(a + ((b - a) * i) / 200);
      if (Number.isFinite(v)) vals.push(v);
    }
  }
  for (const p of spec.points) vals.push(p.y);
  if (!vals.length) return [-5, 5];
  vals.sort((p, q) => p - q);
  let lo = vals[Math.floor(vals.length * 0.03)];
  let hi = vals[Math.ceil(vals.length * 0.97) - 1];
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.1;
  return [lo - pad, hi + pad];
}
