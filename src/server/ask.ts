// Questions about a project ("где проверяется авторизация?"), answered from
// its files with references to paths and lines. Like the overview it needs no
// tool calls: files are picked first, then the answer is written from them.
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import type { StreamEvent } from "@/lib/types";
import { getDb, schema } from "./db";
import type { RepoChatMsg } from "./db/schema";
import { parseGithub, resolveRepo } from "./git";
import { chatAs } from "./llm";
import { isText, type ChatMsg } from "./llm/types";
import { openScan, pickFiles, readChosen } from "./repo/pick";

const BUDGET = 70_000;
const PICK = 10;
const HISTORY = 6;

export const ASK_SYSTEM = `Ты отвечаешь на вопросы о проекте ученика по его файлам. Тебе дают дерево проекта и файлы с номерами строк.
- Отвечай по-русски, в Markdown, сразу по делу, без вступлений.
- Схему (процесс, поток данных, связи частей) можно нарисовать блоком \`\`\`mermaid: flowchart LR/TD или sequenceDiagram, до 12 узлов, подписи по-русски в кавычках, например A[\"Запрос\"] --> B[\"Проверка\"]. Рисуй, только когда схема понятнее текста.
- Опирайся только на показанные файлы. Каждое утверждение о коде подкрепляй ссылкой в виде \`путь:строка\` или \`путь:начало-конец\`.
- Если показанных файлов не хватает для ответа, так и скажи и назови, какие файлы стоит посмотреть (их прочитают при следующем вопросе). Не выдумывай код, которого не видно.
- Короткие фрагменты кода цитируй в блоках \`\`\` с языком. Обычно хватает 3–10 предложений или короткого списка.`;

export function listChats() {
  return getDb()
    .select({ id: schema.repoChats.id, repo: schema.repoChats.repo, url: schema.repoChats.url, title: schema.repoChats.title, updatedAt: schema.repoChats.updatedAt })
    .from(schema.repoChats)
    .orderBy(desc(schema.repoChats.updatedAt))
    .limit(100)
    .all();
}

export function getChat(id: number) {
  return getDb().select().from(schema.repoChats).where(eq(schema.repoChats.id, id)).get() ?? null;
}

export function deleteChat(id: number) {
  getDb().delete(schema.repoChats).where(eq(schema.repoChats.id, id)).run();
}

/**
 * Answer one question. Without `chatId` a new conversation is started for
 * `repo` (a folder or a GitHub link). Emits {type:"saved", id} with the chat id.
 */
export async function askRepo(input: { chatId?: number; repo?: string; question: string }, emit: (e: StreamEvent) => void): Promise<number> {
  const db = getDb();
  const question = input.question.trim().slice(0, 4000);
  if (!question) throw new Error("Пустой вопрос");
  const chat = input.chatId ? getChat(input.chatId) : null;
  if (input.chatId && !chat) throw new Error("Разговор не найден");
  const where = chat ? (chat.url ?? chat.repo) : (input.repo ?? "").trim();
  if (!where) throw new Error("Укажи путь к папке проекта или ссылку на GitHub");

  const { root, url } = await resolveRepo(where, emit);
  const scan = openScan(root);
  const history = chat?.messages ?? [];
  const known = [...new Set(history.flatMap((m) => m.files ?? []))];
  const recent = history.slice(-HISTORY);
  const task = `ответить на вопрос: ${question}` + (recent.length ? `\n(до этого спрашивали: ${recent.filter((m) => m.role === "user").map((m) => m.text).join(" / ").slice(0, 600)})` : "");
  const { tree, chosen } = await pickFiles(scan, task, PICK, { question, known, emit });
  emit({ type: "status", text: `Читаю файлы: ${chosen.length}…` });
  const { text, used } = readChosen(scan, chosen, BUDGET, true);

  const name = (() => {
    const gh = url ? parseGithub(url) : null;
    return gh ? `${gh.owner}/${gh.repo}` : path.basename(root);
  })();
  const messages: ChatMsg[] = [
    {
      role: "user",
      content: [{ type: "text", text: `Проект «${name}».\n\nДерево:\n${tree.slice(0, 12_000)}\n\nФайлы для этого вопроса:\n\n${text}` }],
    },
    { role: "assistant", content: [{ type: "text", text: "Изучил дерево и файлы. Какой вопрос?" }] },
    ...recent.map((m): ChatMsg => ({ role: m.role, content: [{ type: "text", text: m.text }] })),
    { role: "user", content: [{ type: "text", text: question }] },
  ];
  // The history must alternate roles; a saved question without an answer would break that.
  const fixed: ChatMsg[] = [];
  for (const m of messages) {
    const last = fixed.at(-1);
    if (last && last.role === m.role) last.content.push(...m.content);
    else fixed.push({ role: m.role, content: [...m.content] });
  }

  emit({ type: "status", text: "Отвечаю…" });
  const r = await chatAs("strong", "ask", null, {
    system: ASK_SYSTEM,
    messages: fixed,
    maxTokens: 6000,
    onText: (delta) => emit({ type: "text", delta }),
  });
  const answer = r.content.filter(isText).map((b) => b.text).join("").trim();
  if (!answer) throw new Error("Модель вернула пустой ответ");

  const now = Date.now();
  const add: RepoChatMsg[] = [
    { role: "user", text: question, at: now },
    { role: "assistant", text: answer, files: used, at: now },
  ];
  let id: number;
  if (chat) {
    db.update(schema.repoChats)
      .set({ messages: [...chat.messages, ...add], updatedAt: now })
      .where(eq(schema.repoChats.id, chat.id))
      .run();
    id = chat.id;
  } else {
    id = db
      .insert(schema.repoChats)
      .values({ repo: root, url, title: `${name}: ${question.slice(0, 120)}`, messages: add, createdAt: now, updatedAt: now })
      .returning({ id: schema.repoChats.id })
      .get().id;
  }
  emit({ type: "saved", id });
  return id;
}
