import { describe, expect, it } from "vitest";
import { renderPrompt } from "@/server/agent/claude-code";
import { toolDefs, toolShapes } from "@/server/agent/tools";
import type { ChatMsg } from "@/server/llm/types";

const user = (...content: ChatMsg["content"]): ChatMsg => ({ role: "user", content });
const t = (text: string) => ({ type: "text" as const, text });

describe("Claude Code prompt", () => {
  it("sends only the newest learner message when the session is in sync", () => {
    const history: ChatMsg[] = [
      user(t("[состояние] Тема: X")),
      { role: "assistant", content: [t("Привет"), { type: "tool_use", id: "a", name: "set_plan", input: {} }, { type: "tool_use", id: "q", name: "ask_question", input: {} }] },
      user(
        { type: "tool_result", tool_use_id: "a", content: "План сохранён." },
        { type: "tool_result", tool_use_id: "q", content: "attempt_id: 7\nОтвет ученика:\n42" },
        t("и ещё вопрос"),
      ),
    ];
    const p = renderPrompt(history, 2);
    // The sibling result was already delivered inside Claude Code's own loop.
    expect(p).not.toContain("План сохранён");
    expect(p).toBe("attempt_id: 7\nОтвет ученика:\n42\n\nи ещё вопрос");
  });

  it("replays earlier steps as a transcript when Claude Code has not seen them", () => {
    const history: ChatMsg[] = [
      user(t("[состояние] Тема: X")),
      { role: "assistant", content: [t("Объяснение"), { type: "tool_use", id: "q", name: "ask_question", input: { prompt: "?" } }] },
      user({ type: "tool_result", tool_use_id: "q", content: "attempt_id: 1\nОтвет ученика:\nда" }),
    ];
    const p = renderPrompt(history, 0);
    expect(p).toContain("<запись>");
    expect(p).toContain("Репетитор: Объяснение");
    expect(p).toContain("[репетитор вызвал ask_question");
    expect(p.trim().endsWith("Ответ ученика:\nда")).toBe(true);
  });

  it("has something to say even when nothing is new", () => {
    expect(renderPrompt([user(t("x"))], 1)).toBe("Продолжай.");
  });

  it("offers the same tools to both kinds of connection", () => {
    for (const kind of ["topic", "repo"] as const) {
      expect(toolShapes(kind).map((s) => s.name)).toEqual(toolDefs(kind).map((d) => d.name));
    }
    expect(toolShapes("topic").map((s) => s.name)).not.toContain("read_file");
    expect(Object.keys(toolShapes("topic")[0].shape)).toContain("prompt");
  });
});
