import { handle, sse } from "@/server/http";
import { chatAs } from "@/server/llm";
import { isText, type ChatMsg } from "@/server/llm/types";

const SANDBOX_SYSTEM = `Ты помогаешь ученику в песочнице кода: он экспериментирует и спрашивает про свою программу. Тебе дают файлы с номерами строк, вывод и ошибку последнего запуска.
- Отвечай по-русски, в Markdown, коротко и по делу. Ссылайся на строки как \`файл:строка\`.
- Объясняй причину, а не только исправление. Если просят исправить — покажи только изменённый фрагмент в блоке кода с языком, не переписывай всю программу без просьбы.
- Код выполняется в браузере: Python через Pyodide (input() читает из поля «Ввод», графики matplotlib показываются картинками), JavaScript в изолированном воркере (console.log, require("./файл"), input()), SQL в PostgreSQL (PGlite WebAssembly; подключение других файлов через \\i файл.sql). Доступа к сети и файлам компьютера нет.`;

const MAX_CODE = 40_000;

interface Body {
  language?: string;
  files?: { name: string; content: string }[];
  active?: string;
  output?: string;
  error?: string | null;
  question?: string;
  history?: { role: "user" | "assistant"; text: string }[];
}

/** A question about the sandbox program, answered by the fast model with the code in view. */
export const POST = (req: Request) =>
  handle(async () => {
    const b = (await req.json()) as Body;
    const question = (b.question ?? "").trim().slice(0, 4000);
    if (!question) throw new Error("Пустой вопрос");
    let left = MAX_CODE;
    const files = (b.files ?? []).slice(0, 20).map((f) => {
      const numbered = String(f.content ?? "")
        .split("\n")
        .map((l, i) => `${String(i + 1).padStart(4)}│ ${l}`)
        .join("\n")
        .slice(0, Math.max(0, left));
      left -= numbered.length;
      return `<файл имя="${String(f.name).slice(0, 100)}"${f.name === b.active ? " открыт" : ""}>\n${numbered}\n</файл>`;
    });
    const langLabel = b.language === "javascript" ? "JavaScript" : b.language === "sql" ? "SQL (PostgreSQL)" : "Python";
    const context =
      `Язык: ${langLabel}\n\n${files.join("\n\n")}` +
      `\n\nВывод последнего запуска:\n${(b.output ?? "").slice(-6000) || "(пусто или не запускалось)"}` +
      (b.error ? `\n\nОшибка:\n${b.error.slice(-3000)}` : "");
    const messages: ChatMsg[] = [
      { role: "user", content: [{ type: "text", text: context }] },
      { role: "assistant", content: [{ type: "text", text: "Вижу программу и результат запуска. Что спросишь?" }] },
      ...(b.history ?? []).slice(-6).map((m): ChatMsg => ({ role: m.role === "assistant" ? "assistant" : "user", content: [{ type: "text", text: String(m.text).slice(0, 6000) }] })),
      { role: "user", content: [{ type: "text", text: question }] },
    ];
    // Keep roles alternating even if the history ended on a question.
    const fixed: ChatMsg[] = [];
    for (const m of messages) {
      const last = fixed.at(-1);
      if (last && last.role === m.role) last.content.push(...m.content);
      else fixed.push({ role: m.role, content: [...m.content] });
    }
    return sse(async (emit) => {
      const r = await chatAs("cheap", "sandbox", null, { system: SANDBOX_SYSTEM, messages: fixed, maxTokens: 4000, onText: (delta) => emit({ type: "text", delta }) });
      if (!r.content.some(isText)) throw new Error("Модель не ответила");
    });
  });
