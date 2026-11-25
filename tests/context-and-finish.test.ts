import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compactMessagesForLlm,
  CONTEXT_CRITICAL_CHARS,
  CONTEXT_WARN_CHARS,
  measureSessionContext,
} from "../src/server/agent/context";
import { toOpenAiMessages } from "../src/server/llm/openai";
import { renderConversation } from "../src/server/llm/text-tools";
import type { ChatMsg } from "../src/server/llm/types";

describe("context optimization and estimation", () => {
  it("collapses old heavy tool outputs, duplicate plans, and bulky question inputs while preserving recent turns", () => {
    const plan1 =
      "План (✓ освоен, ◐ в процессе, ○ новый, 🔒 предпосылки не освоены):\n○ a — База\n○ b — Дальше (после: a)\nДоступны сейчас: a";
    const plan2 =
      "План (✓ освоен, ◐ в процессе, ○ новый, 🔒 предпосылки не освоены):\n✓ a — База\n○ b — Дальше (после: a)\nДоступны сейчас: b";

    const bigBook = "Глава 1. ".repeat(4000); // ~36k chars
    const bigFile = "export function x() { return 1; }\n".repeat(400);
    const bigPy = "import sympy as sp\n" + "x = sp.Symbol('x')\n".repeat(40);

    const messages: ChatMsg[] = [
      { role: "user", content: [{ type: "text", text: `[состояние]\nТема: тест\n\n${plan1}` }] },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t_book1", name: "read_book", input: { book_id: 1, page_from: 10, page_to: 17 } }],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t_book1", content: bigBook }] },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t_file1", name: "read_file", input: { path: "src/index.ts", start_line: 1, end_line: 200 } }],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t_file1", content: bigFile }] },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t_py1", name: "run_python", input: { code: bigPy } }],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t_py1", content: "out\n".repeat(300) }] },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "t_q1",
            name: "ask_question",
            input: {
              node_key: "a",
              purpose: "check",
              kind: "code",
              prompt: "Напиши функцию",
              language: "python",
              code: "def f(): pass",
              solution: "def f():\n    return 42\n" + "# pad\n".repeat(200),
              tests: "assert f() == 42\n".repeat(100),
              hints: ["подсказка 1", "подсказка 2"],
            },
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t_q1", content: `attempt_id: 1\nАвто-проверка: верно.\n[состояние] Узел a освоен.\n${plan1}` }],
      },
      // Recent window (8 messages): keep verbatim including latest book read and latest plan
      { role: "assistant", content: [{ type: "text", text: "Отлично, переходим к b." }] },
      { role: "user", content: [{ type: "text", text: "[система] Дальше" }] },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t_book2", name: "read_book", input: { book_id: 1, page_from: 20, page_to: 25 } }],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t_book2", content: "Свежий текст книги ".repeat(100) }] },
      { role: "assistant", content: [{ type: "text", text: "Объясняю узел b." }] },
      { role: "user", content: [{ type: "text", text: `Спасибо!\n${plan2}` }] },
      { role: "assistant", content: [{ type: "text", text: "Теперь вопрос." }] },
      { role: "user", content: [{ type: "text", text: "Готов" }] },
    ];

    const originalSnapshot = JSON.stringify(messages);
    const compacted = compactMessagesForLlm(messages);

    // Must not mutate input
    expect(JSON.stringify(messages)).toBe(originalSnapshot);
    expect(compacted.length).toBe(messages.length);

    // Old heavy reads and python collapsed
    const book1Res = compacted[2].content[0];
    expect(book1Res.type === "tool_result" && book1Res.content).toContain("стр. 10–17 книги b1 прочитаны ранее");
    const file1Res = compacted[4].content[0];
    expect(file1Res.type === "tool_result" && file1Res.content).toContain("src/index.ts");
    const py1Use = compacted[5].content[0];
    expect(py1Use.type === "tool_use" && JSON.stringify(py1Use.input)).toContain("выполнен ранее");

    // Old ask_question drops solution/tests/hints
    const q1Use = compacted[7].content[0];
    expect(q1Use.type).toBe("tool_use");
    if (q1Use.type === "tool_use") {
      const inp = q1Use.input as Record<string, unknown>;
      expect(inp.prompt).toBe("Напиши функцию");
      expect(inp.solution).toBeUndefined();
      expect(inp.tests).toBeUndefined();
      expect(inp.hints).toBeUndefined();
    }

    // Superseded plan replaced, latest plan preserved
    const firstMsg = compacted[0].content[0];
    expect(firstMsg.type === "text" && firstMsg.text).toContain("[актуальный план см. ниже]");
    const latestPlanMsg = compacted[14].content[0];
    expect(latestPlanMsg.type === "text" && latestPlanMsg.text).toContain("Доступны сейчас: b");

    // Recent book read preserved verbatim
    const recentBook = compacted[12].content[0];
    expect(recentBook.type === "tool_result" && recentBook.content).toContain("Свежий текст книги");

    // Significant character savings & valid conversions for OpenAI / CLI
    const stats = measureSessionContext("system", messages, []);
    expect(stats.savedChars).toBeGreaterThan(40_000);
    expect(stats.chars).toBeLessThan(stats.rawChars / 2);
    expect(toOpenAiMessages("system", compacted).length).toBeGreaterThan(10);
    expect(renderConversation(compacted).length).toBeLessThan(renderConversation(messages).length);
  });

  it("limits simultaneous full read_book results even inside the recent window", () => {
    const chunk = "Параграф учебника. ".repeat(500);
    const messages: ChatMsg[] = [
      { role: "user", content: [{ type: "text", text: "Начинай" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "b1", name: "read_book", input: { book_id: 1, page_from: 1, page_to: 4 } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "b1", content: chunk }] },
      { role: "assistant", content: [{ type: "tool_use", id: "b2", name: "read_book", input: { book_id: 1, page_from: 5, page_to: 8 } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "b2", content: chunk }] },
      { role: "assistant", content: [{ type: "tool_use", id: "b3", name: "read_book", input: { book_id: 1, page_from: 9, page_to: 12 } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "b3", content: chunk }] },
    ];
    const compacted = compactMessagesForLlm(messages);
    expect(compacted[2].content[0].type === "tool_result" && compacted[2].content[0].content).toContain("прочитаны ранее");
    expect(compacted[4].content[0].type === "tool_result" && compacted[4].content[0].content).toBe(chunk);
    expect(compacted[6].content[0].type === "tool_result" && compacted[6].content[0].content).toBe(chunk);
  });

  it("classifies context thresholds (ok / warn at 800k / critical at 900k)", () => {
    const ok = measureSessionContext("sys", [{ role: "user", content: [{ type: "text", text: "a".repeat(10_000) }] }], []);
    expect(ok.level).toBe("ok");

    const warn = measureSessionContext(
      "sys",
      [{ role: "user", content: [{ type: "text", text: "a".repeat(CONTEXT_WARN_CHARS + 5_000) }] }],
      [],
    );
    expect(warn.level).toBe("warn");

    const critical = measureSessionContext(
      "sys",
      [{ role: "user", content: [{ type: "text", text: "a".repeat(CONTEXT_CRITICAL_CHARS + 5_000) }] }],
      [],
    );
    expect(critical.level).toBe("critical");
  });
});

describe("emergencyFinishSession (without LLM)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-emergency-"));
    process.env.TUTOR_DATA_DIR = tmp;
    process.env.TUTOR_MOCK = "1";
    vi.resetModules();
  });

  afterEach(async () => {
    const { closeDb } = await import("../src/server/db");
    closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.TUTOR_DATA_DIR;
    delete process.env.TUTOR_MOCK;
  });

  it("closes an open session locally, skips pending attempt, and builds a factual summary", async () => {
    const { getDb, schema } = await import("../src/server/db");
    const { createSession, getSessionView } = await import("../src/server/sessions");
    const { emergencyFinishSession, runTurn } = await import("../src/server/agent/run");
    const { eq } = await import("drizzle-orm");

    const db = getDb();
    const now = Date.now();
    const topic = db
      .insert(schema.topics)
      .values({ title: "Словари в Python", goal: "Освоить словари", kind: "topic", createdAt: now, updatedAt: now })
      .returning()
      .get();

    db.insert(schema.nodes)
      .values([
        { topicId: topic.id, key: "basics", title: "Создание словаря", summary: "", deps: [], orderIdx: 0, status: "mastered" },
        { topicId: topic.id, key: "methods", title: "Методы get и items", summary: "", deps: ["basics"], orderIdx: 1, status: "learning" },
        { topicId: topic.id, key: "comprehensions", title: "Генераторы словарей", summary: "", deps: ["methods"], orderIdx: 2, status: "new" },
      ])
      .run();

    const sessionId = createSession({ topicId: topic.id, kind: "lesson" });
    await runTurn(sessionId, { type: "start" }, () => {});

    // Record one correct attempt on basics and one wrong attempt on methods
    db.insert(schema.attempts)
      .values([
        {
          sessionId,
          topicId: topic.id,
          nodeKey: "basics",
          toolUseId: "a1",
          purpose: "check",
          kind: "choice",
          question: { purpose: "check", kind: "choice", prompt: "q1", options: ["1", "2"], correct_option: 0 },
          outcome: "correct",
          autoGraded: true,
          createdAt: now,
          answeredAt: now,
        },
        {
          sessionId,
          topicId: topic.id,
          nodeKey: "methods",
          toolUseId: "a2",
          purpose: "check",
          kind: "free",
          question: { purpose: "check", kind: "free", prompt: "q2", reference_answer: "get" },
          outcome: "wrong",
          misconception: "путает get с []",
          createdAt: now + 1,
          answeredAt: now + 1,
        },
      ])
      .run();

    const before = getSessionView(sessionId)!;
    expect(before.endedAt).toBeNull();
    expect(before.pendingAttemptId).not.toBeNull();
    expect(before.context.limit).toBe(1_000_000);
    expect(before.context.level).toBe("ok");

    const pendingId = before.pendingAttemptId!;

    // Emergency finish: must NOT require any LLM call (disable mock too to prove zero LLM calls)
    delete process.env.TUTOR_MOCK;
    const summary = emergencyFinishSession(sessionId);

    expect(summary.learned).toContain("Создание словаря");
    expect(summary.weak.some((w) => w.includes("Методы get и items") && w.includes("путает get с []"))).toBe(true);
    expect(summary.next).toContain("Методы get и items");

    const after = getSessionView(sessionId)!;
    expect(after.endedAt).not.toBeNull();
    expect(after.pendingAttemptId).toBeNull();
    expect(after.summary).toEqual(summary);

    const skipped = db.select().from(schema.attempts).where(eq(schema.attempts.id, pendingId)).get()!;
    expect(skipped.outcome).toBe("skipped");

    // Idempotent second call
    expect(emergencyFinishSession(sessionId)).toEqual(summary);
  });
});
