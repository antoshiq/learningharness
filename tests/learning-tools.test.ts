// Theory by idea, marks on steps, function plots and the tutor's Python checks.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { StreamEvent, TurnInput } from "@/lib/types";
import type { ChatMsg } from "@/server/llm/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-tools-"));
process.env.TUTOR_DATA_DIR = dir;
process.env.TUTOR_SECRETS_FILE = path.join(dir, "secrets.json");
process.env.TUTOR_MOCK = "1";

let theory: typeof import("@/server/theory");
let feedback: typeof import("@/server/feedback");
let run: typeof import("@/server/agent/run");
let sessions: typeof import("@/server/sessions");
let dbmod: typeof import("@/server/db");
let plot: typeof import("@/lib/plot");

beforeAll(async () => {
  theory = await import("@/server/theory");
  feedback = await import("@/server/feedback");
  run = await import("@/server/agent/run");
  sessions = await import("@/server/sessions");
  dbmod = await import("@/server/db");
  plot = await import("@/lib/plot");
});

const long = (s: string) => `${s} ${"Подробное объяснение идеи. ".repeat(15)}`;
const ask = (id: string, node: string) => ({ type: "tool_use" as const, id, name: "ask_question", input: { node_key: node } });

function newTopic(title: string) {
  const db = dbmod.getDb();
  const now = Date.now();
  return db.insert(dbmod.schema.topics).values({ title, goal: "", kind: "topic", createdAt: now, updatedAt: now }).returning().get();
}

describe("theory by idea", () => {
  it("takes the explanations since the previous question, without short remarks", () => {
    const messages: ChatMsg[] = [
      { role: "assistant", content: [{ type: "text", text: long("Про сложение.") }, ask("q1", "sum")] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "q1", content: "верно" }] },
      { role: "assistant", content: [{ type: "text", text: "Верно!" }, { type: "text", text: long("Функция — это правило.") }] },
      { role: "user", content: [{ type: "text", text: "[система] Дальше" }] },
      { role: "assistant", content: [{ type: "text", text: long("Пример функции.") }, ask("q2", "func")] },
    ];
    const got = theory.theoryBefore(messages, "q2");
    expect(got).toHaveLength(2);
    expect(got[0]).toMatch(/^Функция — это правило/);
    expect(got[1]).toMatch(/^Пример функции/);
    expect(theory.theoryBefore(messages, "q1")).toHaveLength(1);
    expect(theory.theoryBefore(messages, "nope")).toEqual([]);
  });

  it("files theory under the idea once and lists it in plan order", () => {
    const db = dbmod.getDb();
    const topic = newTopic("Теория");
    db.insert(dbmod.schema.nodes).values([
      { topicId: topic.id, key: "a", title: "Первая", deps: [], orderIdx: 0 },
      { topicId: topic.id, key: "b", title: "Вторая", deps: ["a"], orderIdx: 1 },
    ] as never).run();
    const messages: ChatMsg[] = [{ role: "assistant", content: [{ type: "text", text: long("Идея B.") }, ask("x1", "b")] }];
    const a = { topicId: topic.id, sessionId: null, nodeKey: "b", toolUseId: "x1" };
    theory.captureTheory(db, a, messages);
    theory.captureTheory(db, a, messages);
    const nodes = theory.topicTheory(db, topic.id);
    expect(nodes.map((n) => [n.key, n.title, n.entries.length])).toEqual([["b", "Вторая", 1]]);
    expect(theory.theoryForNotes(db, topic.id)).toContain("### b — Вторая");
    theory.deleteTheory(db, topic.id, nodes[0].entries[0].id);
    expect(theory.topicTheory(db, topic.id)).toEqual([]);
  });
});

describe("marks on steps", () => {
  it("toggles a mark, passes it to the tutor once, and keeps a log", async () => {
    const db = dbmod.getDb();
    const topic = newTopic("Отзывы");
    const id = sessions.createSession({ topicId: topic.id, kind: "lesson" });
    const turn = async (input: TurnInput) => {
      const ev: StreamEvent[] = [];
      await run.runTurn(id, input, (e) => ev.push(e));
      return ev;
    };
    await turn({ type: "start" });
    const step = "Длинное объяснение, которое было непонятным.";

    feedback.addFeedback(db, id, "unclear", step);
    feedback.addFeedback(db, id, "unclear", step); // pressed again: taken back
    expect(feedback.sessionFeedback(db, id)).toEqual([]);
    feedback.addFeedback(db, id, "unclear", step);
    feedback.addFeedback(db, id, "wrong", step, "знак перепутан");
    expect(sessions.getSessionView(id)!.feedback).toHaveLength(2);

    await turn({ type: "message", text: "Продолжим" });
    const s = db.select().from(dbmod.schema.sessions).all().find((r) => r.id === id)!;
    const sent = s.messages
      .filter((m) => m.role === "user")
      .flatMap((m) => m.content)
      .map((b) => ("text" in b ? String(b.text) : ""))
      .join("\n");
    expect(sent).toContain("Ученик отметил прошлые шаги");
    expect(sent).toContain("знак перепутан");
    // Hidden from the transcript, and not sent twice.
    expect(sessions.getSessionView(id)!.transcript.some((t) => t.type === "user" && t.text.includes("отметил"))).toBe(false);
    expect(feedback.takeFeedback(db, id)).toBeNull();

    const log = feedback.feedbackLog(db);
    expect(log.counts).toMatchObject({ unclear: 1, wrong: 1 });
    expect(log.items[0]).toMatchObject({ topicTitle: "Отзывы" });
    expect(() => feedback.addFeedback(db, id, "bad" as never, step)).toThrow();
  });
});

describe("plots", () => {
  it("evaluates expressions safely, with implicit multiplication and the usual functions", () => {
    const f = (s: string, x: number) => plot.compile(s)(x);
    expect(f("2x^2 - 3x + 1", 2)).toBe(3);
    expect(f("-x^2", 3)).toBe(-9);
    expect(f("2^3^2", 0)).toBe(512);
    expect(f("sin(pi/2) + ln(e) + lg(100)", 0)).toBeCloseTo(4);
    expect(f("(x+1)(x-1)", 3)).toBe(8);
    expect(f("3sin x", Math.PI / 2)).toBeCloseTo(3);
    expect(f("sin^2(x) + cos^2(x)", 0.7)).toBeCloseTo(1);
    expect(f("sqrt(x)", -1)).toBeNaN();
    expect(() => plot.compile("alert(1)")).toThrow(/неизвестное имя/);
    expect(() => plot.compile("(x+1")).toThrow(/скобка/);
  });

  it("reads a plot block", () => {
    const spec = plot.parsePlot("y = sin(x) | синус\nf(x) = x^2/4\nx = 1\npoint 1, 0.84 | A\nx: -2pi..2pi\ny: -2..4\n# комментарий");
    expect(spec.curves.map((c) => c.label)).toEqual(["синус", "f(x) = x^2/4"]);
    expect(spec.vlines).toEqual([{ x: 1, label: "x = 1" }]);
    expect(spec.points).toEqual([{ x: 1, y: 0.84, label: "A" }]);
    expect(spec.x[0]).toBeCloseTo(-2 * Math.PI);
    expect(spec.y).toEqual([-2, 4]);
    expect(() => plot.parsePlot("z = 3")).toThrow(/z = 3/);
    expect(plot.ticks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
    const [lo, hi] = plot.autoY(plot.parsePlot("y = 1/x"));
    expect(hi - lo).toBeLessThan(100);
  });
});

describe("python for the tutor", () => {
  it("prints, reports errors and keeps runs apart", async () => {
    const { runPython } = await import("@/server/python");
    expect(await runPython("from fractions import Fraction\nprint(Fraction(1, 3) + Fraction(1, 6))")).toEqual({ ok: true, text: "1/2" });
    const bad = await runPython("print('до')\n1/0");
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain("до");
    expect(bad.text).toContain("ZeroDivisionError");
    await runPython("secret = 42");
    expect((await runPython("print('secret' in globals())")).text).toBe("False");
  }, 180_000);
});
