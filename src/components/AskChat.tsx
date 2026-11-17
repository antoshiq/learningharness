"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { streamPost } from "@/lib/api";
import { Markdown } from "./Markdown";
import { Button, cx, Dots, Icon, inputClass, Kbd, Notice } from "./ui";

export interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  files?: string[];
}

/** Learner's question, set to the right like a chat request. */
function Said({ text }: { text: string }) {
  return <div className="enter ml-auto w-fit max-w-[85%] rounded-md bg-accent-soft px-3.5 py-2 whitespace-pre-wrap text-bright">{text}</div>;
}

/**
 * A conversation about one project. Without `chatId` the first question
 * starts a new conversation for `repo` and the page moves to it.
 */
export function AskChat({ chatId, repo, initial, onChanged }: { chatId?: number; repo?: string; initial: ChatMsg[]; onChanged?: () => void }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMsg[]>(initial);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const busy = asked !== null;

  useEffect(() => setMessages(initial), [initial]);
  useEffect(() => {
    if (busy) bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [answer, busy]);

  const ask = async () => {
    const q = question.trim();
    if (!q || busy || (!chatId && !repo?.trim())) return;
    setQuestion("");
    setAsked(q);
    setAnswer("");
    setError(null);
    setStatus("Готовлю материал…");
    let saved: number | null = null;
    let reply = "";
    try {
      await streamPost("/api/ask", { chatId, repo, question: q }, (e) => {
        if (e.type === "status") setStatus(e.text);
        else if (e.type === "text") {
          setStatus(null);
          reply += e.delta;
          setAnswer(reply);
        } else if (e.type === "error") setError(e.message);
        else if (e.type === "saved") saved = e.id;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setStatus(null);
    setAsked(null);
    if (saved === null) {
      setQuestion(q);
      return;
    }
    if (!chatId) {
      router.push(`/ask/${saved}`);
      return;
    }
    setMessages((m) => [...m, { role: "user", text: q }, { role: "assistant", text: reply }]);
    onChanged?.();
  };

  return (
    <div className="space-y-4">
      {messages.map((m, i) =>
        m.role === "user" ? (
          <Said key={i} text={m.text} />
        ) : (
          <div key={i} className="space-y-1.5">
            <Markdown text={m.text} className="prose-lesson" />
            {!!m.files?.length && (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer hover:text-bright">Прочитано файлов: {m.files.length}</summary>
                <div className="mt-1 font-mono">{m.files.join(" · ")}</div>
              </details>
            )}
          </div>
        ),
      )}
      {asked && <Said text={asked} />}
      {busy && (
        <div className="space-y-2">
          {status && (
            <div className="flex items-center gap-2.5 text-sm text-muted" aria-live="polite">
              <Dots /> {status}
            </div>
          )}
          {answer && <Markdown text={answer} className="prose-lesson streaming" />}
        </div>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
      <div ref={bottom} />

      <div className="sticky bottom-0 z-10 -mx-1 bg-bg/95 px-1 pt-2 pb-3 backdrop-blur-sm">
        <div className="flex items-end gap-2">
          <textarea
            className={cx(inputClass, "max-h-40 min-h-10 flex-1 resize-y sm:min-h-[34px]")}
            rows={messages.length ? 1 : 3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
                e.preventDefault();
                ask();
              }
            }}
            placeholder={messages.length ? "Уточнить или спросить ещё" : "Где проверяется авторизация? Что будет, если удалить этот модуль? Как добавить новую страницу?"}
            aria-label="Вопрос о проекте"
            autoFocus
          />
          <Button variant="primary" className="w-10 px-0 sm:w-[34px]" onClick={ask} disabled={busy || !question.trim() || (!chatId && !repo?.trim())} aria-label="Спросить">
            <Icon name="up" className="[stroke-width:1.6]" />
          </Button>
        </div>
        <p className="mt-1 hidden text-xs text-muted sm:block">
          <Kbd>Enter</Kbd> спросить, <Kbd>Shift+Enter</Kbd> новая строка. Для каждого вопроса читаются нужные файлы проекта (только чтение, без секретов).
        </p>
      </div>
    </div>
  );
}
