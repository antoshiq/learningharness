import { NOTES_SYSTEM } from "@/server/agent/prompts";
import { handle, intParam, sse } from "@/server/http";
import { chatAs } from "@/server/llm";
import { isText } from "@/server/llm/types";
import { notesContext, saveNotes } from "@/server/notes";

type Ctx = { params: Promise<{ id: string }> };

/** Write (or rewrite) the topic's cheat sheet, streaming it as it is written. */
export const POST = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    const context = notesContext(id);
    return sse(async (emit) => {
      const r = await chatAs("strong", "notes", null, {
        system: NOTES_SYSTEM,
        messages: [{ role: "user", content: [{ type: "text", text: `Данные для конспекта:\n<данные>\n${context}\n</данные>\n\nСоставь конспект.` }] }],
        maxTokens: 8000,
        onText: (delta) => emit({ type: "text", delta }),
      });
      const text = r.content.filter(isText).map((b) => b.text).join("");
      if (!text.trim()) throw new Error("Модель вернула пустой конспект");
      saveNotes(id, text);
    });
  });
