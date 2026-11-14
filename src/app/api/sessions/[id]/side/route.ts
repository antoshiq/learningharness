import { eq } from "drizzle-orm";
import { SIDE_SYSTEM } from "@/server/agent/prompts";
import { isHiddenText } from "@/server/agent/state";
import { getDb, schema } from "@/server/db";
import { handle, intParam, sse } from "@/server/http";
import { chatAs } from "@/server/llm";
import { isText, isToolUse, type ChatMsg } from "@/server/llm/types";

/**
 * A side question: one tool-less call that sees the current step as a quoted
 * document. It never touches the lesson's own history, so it cannot derail it.
 */
export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    const { text } = (await req.json()) as { text?: string };
    const question = (text ?? "").trim();
    if (!question) throw new Error("Пустой вопрос");
    const db = getDb();
    const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();
    if (!session) throw new Error("Сессия не найдена");

    // Learner-visible lesson so far: tutor text and question prompts, never answer keys.
    const visible: string[] = [];
    for (const m of session.messages) {
      for (const b of m.content) {
        if (isText(b) && !isHiddenText(b.text)) visible.push(`${m.role === "user" ? "Ученик" : "Репетитор"}: ${b.text}`);
        else if (isToolUse(b) && b.name === "ask_question") {
          const q = b.input as { prompt?: string; options?: string[]; code?: string; kind?: string };
          visible.push(
            `Вопрос репетитора: ${q.prompt ?? ""}` +
              (q.options ? `\nВарианты: ${q.options.join(" | ")}` : "") +
              (q.code && q.kind !== "code" ? `\nКод:\n${q.code}` : ""),
          );
        }
      }
    }
    const lesson = visible.slice(-12).join("\n\n").slice(-12000);

    const prior = db.select().from(schema.sideMessages).where(eq(schema.sideMessages.sessionId, id)).orderBy(schema.sideMessages.id).all();
    const messages: ChatMsg[] = [
      { role: "user", content: [{ type: "text", text: `Фрагмент урока (для контекста):\n<урок>\n${lesson || "(урок только начался)"}\n</урок>` }] },
      { role: "assistant", content: [{ type: "text", text: "Понял контекст. Какой вопрос?" }] },
      ...prior.slice(-10).map((m): ChatMsg => ({ role: m.role, content: [{ type: "text", text: m.text }] })),
      { role: "user", content: [{ type: "text", text: question }] },
    ];
    db.insert(schema.sideMessages).values({ sessionId: id, role: "user", text: question, createdAt: Date.now() }).run();

    return sse(async (emit) => {
      const r = await chatAs("cheap", "side", id, {
        system: SIDE_SYSTEM,
        messages,
        maxTokens: 8000,
        onText: (delta) => emit({ type: "text", delta }),
      });
      const reply = r.content.filter(isText).map((b) => b.text).join("");
      db.insert(schema.sideMessages).values({ sessionId: id, role: "assistant", text: reply, createdAt: Date.now() }).run();
    });
  });
