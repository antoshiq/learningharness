import { askRepo, listChats } from "@/server/ask";
import { handle, json, sse } from "@/server/http";

export const GET = () => handle(() => json({ chats: listChats() }));

/** Ask about a project: {repo, question} starts a conversation, {chatId, question} continues one. */
export const POST = (req: Request) =>
  handle(async () => {
    const b = (await req.json()) as { chatId?: number; repo?: string; question?: string };
    if (!b.question?.trim()) throw new Error("Пустой вопрос");
    return sse(async (emit) => {
      await askRepo({ chatId: b.chatId ? Number(b.chatId) : undefined, repo: b.repo, question: b.question! }, emit);
    });
  });
