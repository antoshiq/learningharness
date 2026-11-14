import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Rating } from "ts-fsrs";
import { gradeAuto, normalizeOutput, parsonsLines, seededShuffle } from "@/lib/grading";
import { isAvailable, topoOrder, validatePlan } from "@/lib/plan";
import { nextStatus, ratingFor, schedule } from "@/server/mastery";
import { toOpenAiMessages } from "@/server/llm/openai";
import { normalizeRel, scanRepo } from "@/server/repo/scan";
import { listDir, readFile, searchCode } from "@/server/repo/tools";
import type { Question } from "@/lib/types";

describe("plan", () => {
  it("accepts a DAG and orders prerequisites first", () => {
    const nodes = [
      { key: "c", title: "C", deps: ["b"] },
      { key: "a", title: "A" },
      { key: "b", title: "B", deps: ["a"] },
    ];
    expect(validatePlan(nodes)).toEqual([]);
    expect(topoOrder(nodes)).toEqual(["a", "b", "c"]);
  });
  it("rejects cycles, unknown deps, duplicate and malformed keys", () => {
    expect(validatePlan([{ key: "a", title: "A", deps: ["b"] }, { key: "b", title: "B", deps: ["a"] }]).join()).toMatch(/цикл/);
    expect(validatePlan([{ key: "a", title: "A", deps: ["x"] }, { key: "b", title: "B" }]).join()).toMatch(/несуществующий/);
    expect(validatePlan([{ key: "a", title: "A" }, { key: "a", title: "B" }]).join()).toMatch(/Повторяющийся/);
    expect(validatePlan([{ key: "Плохой ключ", title: "A" }, { key: "b", title: "B" }]).join()).toMatch(/Некорректный key/);
  });
  it("makes a node available only when all prerequisites are mastered", () => {
    expect(isAvailable({ deps: ["a", "b"] }, { a: "mastered", b: "learning" })).toBe(false);
    expect(isAvailable({ deps: ["a", "b"] }, { a: "mastered", b: "mastered" })).toBe(true);
    expect(isAvailable({ deps: [] }, {})).toBe(true);
  });
});

describe("grading", () => {
  const q = (o: Partial<Question>): Question => ({ purpose: "check", kind: "choice", prompt: "?", ...o });
  it("grades choice", () => {
    expect(gradeAuto(q({ options: ["a", "b"], correct_option: 1 }), { choice: 1 })).toBe("correct");
    expect(gradeAuto(q({ options: ["a", "b"], correct_option: 1 }), { choice: 0 })).toBe("wrong");
  });
  it("compares predicted output against the real output, ignoring trailing whitespace", () => {
    const p = q({ kind: "predict_output", language: "python", code: "print(2)" });
    expect(gradeAuto(p, { text: "2 ", actualOutput: "2\r\n" })).toBe("correct");
    expect(gradeAuto(p, { text: "3", actualOutput: "2\n" })).toBe("wrong");
    expect(gradeAuto(p, { text: "2" })).toBeNull(); // no real output: cannot grade
  });
  it("grades code by the test run and parsons by line order", () => {
    const c = q({ kind: "code", language: "python", solution: "x", tests: "y" });
    expect(gradeAuto(c, { code: "", run: { ok: true, stdout: "", error: null } })).toBe("correct");
    expect(gradeAuto(c, { code: "", run: { ok: false, stdout: "", error: "AssertionError" } })).toBe("wrong");
    const p = q({ kind: "parsons", language: "python", solution: "a = 1\n\nif a:\n    print(a)\n" });
    expect(parsonsLines(p.solution!)).toEqual(["a = 1", "if a:", "    print(a)"]);
    expect(gradeAuto(p, { lines: ["a = 1", "if a:", "    print(a)"] })).toBe("correct");
    expect(gradeAuto(p, { lines: ["if a:", "a = 1", "    print(a)"] })).toBe("wrong");
  });
  it("leaves free and math answers to the model", () => {
    expect(gradeAuto(q({ kind: "free", reference_answer: "x" }), { text: "y" })).toBeNull();
    expect(gradeAuto(q({ kind: "math", reference_answer: "x" }), { text: "y" })).toBeNull();
  });
  it("normalizes output and never shuffles into the solved order", () => {
    expect(normalizeOutput("a  \r\nb\n\n")).toBe("a\nb");
    for (let seed = 1; seed < 50; seed++) {
      const s = seededShuffle(["1", "2", "3"], seed);
      expect(s.slice().sort()).toEqual(["1", "2", "3"]);
      expect(s).not.toEqual(["1", "2", "3"]);
    }
  });
});

describe("mastery", () => {
  it("maps answers to FSRS grades", () => {
    expect(ratingFor("wrong", 0, 3)).toBe(Rating.Again);
    expect(ratingFor("partial", 0, 3)).toBe(Rating.Hard);
    expect(ratingFor("correct", 1, 3)).toBe(Rating.Hard); // used a hint
    expect(ratingFor("correct", 0, 1)).toBe(Rating.Hard); // guessed
    expect(ratingFor("correct", 0, 2)).toBe(Rating.Good);
    expect(ratingFor("correct", 0, 3)).toBe(Rating.Easy);
    expect(ratingFor("skipped", 0, 3)).toBeNull();
  });
  it("grows intervals on success and shrinks them on a lapse", () => {
    const t0 = new Date("2026-01-01T10:00:00Z");
    let s = schedule(null, Rating.Good, t0);
    const gaps: number[] = [];
    let now = t0;
    for (let i = 0; i < 5; i++) {
      now = new Date(s.dueAt);
      const next = schedule(s.card, Rating.Good, now);
      gaps.push(next.dueAt - now.getTime());
      s = next;
    }
    expect(gaps[4]).toBeGreaterThan(gaps[1]);
    expect(gaps[4]).toBeGreaterThan(5 * 86400_000);
    const lapse = schedule(s.card, Rating.Again, new Date(s.dueAt));
    expect(lapse.dueAt - s.dueAt).toBeLessThan(gaps[4]);
  });
  it("moves node status", () => {
    expect(nextStatus("new", "correct")).toBe("mastered");
    expect(nextStatus("mastered", "wrong")).toBe("learning");
    expect(nextStatus("new", "partial")).toBe("learning");
    expect(nextStatus("mastered", "partial")).toBe("mastered");
  });
});

describe("openai message conversion", () => {
  it("puts tool results right after the calling assistant message and drops opaque blocks", () => {
    const out = toOpenAiMessages("sys", [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "", signature: "x" },
          { type: "text", text: "ok" },
          { type: "tool_use", id: "t1", name: "set_plan", input: { nodes: [] } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "done" }, { type: "text", text: "next" }] },
    ]);
    expect(out.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "user"]);
    const a = out[2] as { content: string; tool_calls: { id: string; function: { name: string; arguments: string } }[] };
    expect(a.content).toBe("ok");
    expect(a.tool_calls[0]).toMatchObject({ id: "t1", function: { name: "set_plan", arguments: '{"nodes":[]}' } });
    expect(out[3]).toEqual({ role: "tool", tool_call_id: "t1", content: "done" });
  });
});

describe("repository access", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-repo-"));
  const w = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  w("README.md", "# demo\n");
  w("src/main.py", "def main():\n    return 42\n");
  w("src/util/helpers.py", "SECRET_NAME = 'x'\n");
  w(".env", "API_KEY=supersecret\n");
  w("config/secrets.json", '{"k":"v"}');
  w("node_modules/pkg/index.js", "module.exports = 1\n");
  w("dist/bundle.js", "x\n");
  w("ignored.log", "log\n");
  w("sub/.gitignore", "local.txt\n");
  w("sub/local.txt", "nope\n");
  w("sub/keep.txt", "yes\n");
  w(".gitignore", "*.log\n");
  w("image.png", "binary");

  it("includes sources and excludes dependencies, builds, secrets, binaries and gitignored files", () => {
    const scan = scanRepo(root);
    const paths = scan.files.map((f) => f.path).sort();
    expect(paths).toEqual([".gitignore", "README.md", "src/main.py", "src/util/helpers.py", "sub/.gitignore", "sub/keep.txt"]);
    expect(scan.skippedSecrets).toBe(2);
  });
  it("reads only scanned files and refuses escapes and secrets", () => {
    expect(readFile(root, "src/main.py")).toContain("return 42");
    expect(() => readFile(root, ".env")).toThrow(/недоступен/);
    expect(() => readFile(root, "config/secrets.json")).toThrow(/недоступен/);
    expect(() => readFile(root, "node_modules/pkg/index.js")).toThrow(/недоступен/);
    expect(() => readFile(root, "../outside.txt")).toThrow(/за пределы/);
    expect(() => readFile(root, "src/../../etc/passwd")).toThrow(/за пределы/);
    expect(() => normalizeRel("..\\..\\x")).toThrow();
    expect(normalizeRel("./src\\util/../main.py")).toBe("src/main.py");
  });
  it("lists and searches within the scan", () => {
    expect(listDir(root, "src")).toContain("util/ (1 файлов)");
    expect(searchCode(root, "return 42")).toContain("src/main.py:2");
    expect(searchCode(root, "supersecret")).toMatch(/Ничего не найдено/);
    expect(searchCode(root, "SECRET", "*.py")).toContain("helpers.py:1");
  });
});
