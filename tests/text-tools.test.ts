// Tool calling over plain text (ChatGPT and Gemini subscriptions).
import { describe, expect, it } from "vitest";
import { toolDefs } from "@/server/agent/tools";
import { parseReply, renderConversation, toolInstructions, VisibleText } from "@/server/llm/text-tools";
import type { ChatMsg, ToolUseBlock } from "@/server/llm/types";

let n = 0;
const id = () => `c${n++}`;
const t = (text: string) => ({ type: "text" as const, text });

describe("parseReply", () => {
  it("keeps plain text as is", () => {
    expect(parseReply("  Привет!  ", id)).toEqual([t("Привет!")]);
  });

  it("splits text and several calls", () => {
    const r = parseReply(
      'Объясняю.\n<tool_call>\n{"name": "set_plan", "input": {"a": 1}}\n</tool_call>\n<tool_call>```json\n{"name": "ask_question", "input": {"q": "?"}}\n```</tool_call>\nОтвет ученика: 42',
      id,
    );
    expect(r[0]).toEqual(t("Объясняю."));
    expect(r.slice(1).map((b) => [b.type, (b as ToolUseBlock).name, (b as ToolUseBlock).input])).toEqual([
      ["tool_use", "set_plan", { a: 1 }],
      ["tool_use", "ask_question", { q: "?" }],
    ]);
    // The invented answer after the calls is dropped.
    expect(JSON.stringify(r)).not.toContain("42");
  });

  it("reports broken JSON so the tool can ask for a retry", () => {
    const [call] = parseReply('<tool_call>{"name": "ask_question", "input": {oops}}', id);
    expect(call).toMatchObject({ type: "tool_use", name: "ask_question" });
    expect((call as { input: Record<string, unknown> }).input.__invalid_json).toBeTruthy();
  });

  it("accepts an unclosed last block", () => {
    const r = parseReply('Текст <tool_call>{"name":"end_session","input":{}}', id);
    expect(r.map((b) => b.type)).toEqual(["text", "tool_use"]);
  });
});

describe("renderConversation", () => {
  it("sends a single message unchanged", () => {
    expect(renderConversation([{ role: "user", content: [t("Сделай экскурс")] }])).toBe("Сделай экскурс");
  });

  it("writes calls back in the same tagged form, with named results", () => {
    const history: ChatMsg[] = [
      { role: "user", content: [t("[состояние] Тема: X")] },
      { role: "assistant", content: [t("Вопрос:"), { type: "tool_use", id: "q", name: "ask_question", input: { prompt: "2+2?" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "q", content: "Ответ ученика:\n4" }, t("и ещё")] },
    ];
    const p = renderConversation(history);
    expect(p).toContain('<tool_call>\n{"name":"ask_question","input":{"prompt":"2+2?"}}\n</tool_call>');
    expect(p).toContain("### Результат ask_question\nОтвет ученика:\n4");
    expect(p).toContain("### Ученик\nи ещё");
  });
});

describe("toolInstructions", () => {
  it("lists every lesson tool with its schema", () => {
    const defs = toolDefs("topic");
    const s = toolInstructions(defs);
    for (const d of defs) expect(s).toContain(`## ${d.name}`);
    expect(s).toContain("<tool_call>");
  });
});

describe("VisibleText", () => {
  it("streams text and hides everything from the first call, even split across chunks", () => {
    let out = "";
    const v = new VisibleText((d) => (out += d));
    for (const chunk of ["Хорошо, ", "давай <to", "ol_call>{\"name\":", "\"x\"}</tool_call> хвост"]) v.push(chunk);
    v.end();
    expect(out.trimEnd()).toBe("Хорошо, давай");
  });

  it("releases a held-back '<' that was not a tag", () => {
    let out = "";
    const v = new VisibleText((d) => (out += d));
    v.push("a <");
    v.push(" b");
    v.end();
    expect(out).toBe("a < b");
  });
});
