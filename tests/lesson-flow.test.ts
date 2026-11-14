// End-to-end turn loop against the scripted provider: no network, no API key.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { StreamEvent, TurnInput } from "@/lib/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-data-"));
process.env.TUTOR_DATA_DIR = dir;
process.env.TUTOR_SECRETS_FILE = path.join(dir, "secrets.json");
process.env.TUTOR_MOCK = "1";

let run: typeof import("@/server/agent/run");
let sessions: typeof import("@/server/sessions");
let dbmod: typeof import("@/server/db");

beforeAll(async () => {
  run = await import("@/server/agent/run");
  sessions = await import("@/server/sessions");
  dbmod = await import("@/server/db");
});

async function turn(id: number, input: TurnInput): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  await run.runTurn(id, input, (e) => events.push(e));
  return events;
}

describe("lesson flow", () => {
  it("runs diagnostics, plan, questions, grading, mastery and summary", async () => {
    const db = dbmod.getDb();
    const now = Date.now();
    const topic = db
      .insert(dbmod.schema.topics)
      .values({ title: "Тест", goal: "проверка", kind: "topic", createdAt: now, updatedAt: now })
      .returning()
      .get();
    const id = sessions.createSession({ topicId: topic.id, kind: "lesson" });

    // 1. start -> probe question
    const ev1 = await turn(id, { type: "start" });
    expect(ev1.some((e) => e.type === "text")).toBe(true);
    let view = sessions.getSessionView(id)!;
    expect(view.plan).toHaveLength(0);
    const probe = view.transcript.at(-1)!;
    expect(probe.type).toBe("question");
    if (probe.type !== "question") throw new Error();
    expect(probe.pending).toBe(true);
    expect(view.pendingAttemptId).toBe(probe.attemptId);

    // A stale answer is refused; state must be unchanged.
    await expect(turn(id, { type: "answer", attemptId: 9999, answer: { choice: 1 } })).rejects.toThrow(/не активен/);

    // 2. answer probe -> plan is created -> first check question (predict_output)
    const ev2 = await turn(id, { type: "answer", attemptId: probe.attemptId, answer: { choice: 1, confidence: 3 } });
    expect(ev2).toContainEqual({ type: "graded", attemptId: probe.attemptId, outcome: "correct" });
    view = sessions.getSessionView(id)!;
    expect(view.plan.map((n) => [n.key, n.status, n.available])).toEqual([
      ["sum", "new", true],
      ["func", "new", false],
      ["why", "new", false],
    ]);
    const q1 = view.transcript.at(-1)!;
    if (q1.type !== "question") throw new Error();
    expect(q1.question.kind).toBe("predict_output");

    // 3. wrong prediction -> node goes to "learning", next node stays locked
    await turn(id, { type: "answer", attemptId: q1.attemptId, answer: { text: "11", actualOutput: "2\n", confidence: 3 } });
    view = sessions.getSessionView(id)!;
    expect(view.plan[0].status).toBe("learning");
    expect(view.plan[0].wrongCount).toBe(1);
    expect(view.plan[1].available).toBe(false);
    const q2 = view.transcript.at(-1)!;
    if (q2.type !== "question") throw new Error();
    expect(q2.question.kind).toBe("code");

    // 4. the browser reports that the reference solution fails its tests -> not shown, model is told
    await turn(id, { type: "invalid_question", attemptId: q2.attemptId, detail: "solution не проходит tests" });
    view = sessions.getSessionView(id)!;
    expect(view.pendingAttemptId).toBeNull();
    expect(view.transcript.some((t) => t.type === "question" && t.attemptId === q2.attemptId)).toBe(false);
    expect(view.transcript.at(-1)).toMatchObject({ type: "assistant" });

    // 5. learner writes a message; mock continues with the free question (step 4 of its script is skipped by count)
    await turn(id, { type: "message", text: "Продолжим" });
    view = sessions.getSessionView(id)!;
    expect(view.transcript.some((t) => t.type === "user" && t.text === "Продолжим")).toBe(true);

    // 6. finish -> summary, session closed
    await turn(id, { type: "finish" });
    view = sessions.getSessionView(id)!;
    expect(view.endedAt).not.toBeNull();
    expect(view.summary?.next).toBeTruthy();
    expect(view.usage.inputTokens).toBeGreaterThan(0);
    await expect(turn(id, { type: "message", text: "ещё" })).rejects.toThrow(/завершена/);

    // History stays valid: every tool_use is answered by a tool_result in the next message.
    const s = db.select().from(dbmod.schema.sessions).all().find((x) => x.id === id)!;
    s.messages.forEach((m, i) => {
      if (m.role !== "assistant") return;
      const uses = m.content.filter((b) => b.type === "tool_use").map((b) => (b as { id: string }).id);
      if (!uses.length) return;
      const next = s.messages[i + 1];
      const answered = next.content.filter((b) => b.type === "tool_result").map((b) => (b as { tool_use_id: string }).tool_use_id);
      expect(answered.sort()).toEqual(uses.sort());
    });
    // Hidden context never reaches the visible transcript.
    expect(view.transcript.every((t) => !("text" in t) || !t.text.startsWith("["))).toBe(true);
  });

  it("free answers are graded by the model and schedule a review; review sessions need due nodes", async () => {
    const db = dbmod.getDb();
    const now = Date.now();
    const topic = db
      .insert(dbmod.schema.topics)
      .values({ title: "Тест 2", goal: "", kind: "topic", createdAt: now, updatedAt: now })
      .returning()
      .get();
    expect(() => sessions.createSession({ topicId: topic.id, kind: "practice" })).toThrow(/после первого/);
    const id = sessions.createSession({ topicId: topic.id, kind: "lesson" });
    const pendingId = () => sessions.getSessionView(id)!.pendingAttemptId!;

    await turn(id, { type: "start" });
    await turn(id, { type: "answer", attemptId: pendingId(), answer: { choice: 1 } });
    await turn(id, { type: "answer", attemptId: pendingId(), answer: { text: "2", actualOutput: "2\n", confidence: 2 } });
    let view = sessions.getSessionView(id)!;
    expect(view.plan[0].status).toBe("mastered");
    expect(view.plan[1].available).toBe(true);

    await turn(id, { type: "answer", attemptId: pendingId(), answer: { code: "def add(a,b): return a+b", run: { ok: true, stdout: "", error: null }, hintsUsed: 1 } });
    const freeId = pendingId();
    await turn(id, { type: "answer", attemptId: freeId, answer: { text: "Чтобы не повторять код", thinking: "вроде так" } });

    view = sessions.getSessionView(id)!;
    expect(view.plan.map((n) => n.status)).toEqual(["mastered", "mastered", "mastered"]);
    const free = db.select().from(dbmod.schema.attempts).all().find((a) => a.id === freeId)!;
    expect(free.autoGraded).toBe(false);
    expect(free.outcome).toBe("correct");
    expect(view.plan.every((n) => n.dueAt !== null && n.dueAt > Date.now())).toBe(true);
    expect(view.endedAt).not.toBeNull();

    // Nothing is due yet, so a review session cannot start.
    expect(() => sessions.createSession({ topicId: topic.id, kind: "review" })).toThrow(/нечего повторять/);
    // Once a node is due, it can.
    db.update(dbmod.schema.nodes).set({ dueAt: Date.now() - 1000 }).run();
    expect(sessions.createSession({ topicId: topic.id, kind: "review" })).toBeGreaterThan(0);
    expect(sessions.listTopics().find((t) => t.id === topic.id)).toMatchObject({ total: 3, mastered: 3, due: 3 });
  });
});
