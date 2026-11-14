import type { AnswerPayload, Outcome, Question } from "./types";

/** Compare program output leniently: line endings and trailing whitespace don't matter. */
export function normalizeOutput(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .trim();
}

/** Lines of a Parsons problem: the reference program without blank lines. */
export function parsonsLines(solution: string): string[] {
  return solution
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "");
}

/** Deterministic shuffle so a reload shows the same order. */
export function seededShuffle<T>(items: T[], seed: number): T[] {
  const a = [...items];
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  // Never present the already-correct order.
  if (a.length > 1 && a.every((x, i) => x === items[i])) [a[0], a[1]] = [a[1], a[0]];
  return a;
}

/**
 * Grade what can be graded mechanically. Returns null when the model has to
 * judge the answer (free text, step-by-step math).
 */
export function gradeAuto(q: Question, a: AnswerPayload): Outcome | null {
  switch (q.kind) {
    case "choice":
      return a.choice === q.correct_option ? "correct" : "wrong";
    case "predict_output":
      if (typeof a.actualOutput !== "string") return null;
      return normalizeOutput(a.text ?? "") === normalizeOutput(a.actualOutput) ? "correct" : "wrong";
    case "code":
    case "find_bug":
      if (!a.run) return null;
      return a.run.ok ? "correct" : "wrong";
    case "parsons": {
      const want = parsonsLines(q.solution ?? "");
      const got = (a.lines ?? []).map((l) => l.replace(/\s+$/, ""));
      return want.length === got.length && want.every((l, i) => l === got[i]) ? "correct" : "wrong";
    }
    default:
      return null;
  }
}
