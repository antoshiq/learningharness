"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AskChat, type ChatMsg } from "@/components/AskChat";
import { Button, Icon, LinkButton, Loading, Notice, Page, Sheet, TopNav } from "@/components/ui";
import { api } from "@/lib/api";

interface Chat {
  id: number;
  repo: string;
  url: string | null;
  title: string;
  messages: ChatMsg[];
}

export default function AskChatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [chat, setChat] = useState<Chat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    api<Chat>(`/api/ask/${id}`)
      .then(setChat)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const where = chat ? (chat.url ?? chat.repo) : "";
  const name = chat ? (chat.url ? chat.url.replace(/^https:\/\/github\.com\//, "") : (chat.repo.split(/[\\/]/).pop() ?? chat.repo)) : "…";

  return (
    <>
      <TopNav tab={name} icon="chat" crumbs={[{ label: "Вопрос к проекту", href: "/ask" }, { label: name }]} />
      <Page narrow>
        {error && <Notice tone="bad">{error}</Notice>}
        {!chat ? (
          !error && <Loading />
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-[22px] leading-tight font-normal text-bright">{name}</h1>
                <p className="mt-0.5 truncate font-mono text-xs text-muted">{where}</p>
              </div>
              <div className="flex gap-2">
                <LinkButton small href={`/brief?kind=repo&repo=${encodeURIComponent(where)}`}>
                  <Icon name="compass" /> Экскурс по проекту
                </LinkButton>
                <Button small variant="ghost" onClick={() => setConfirm(true)}>
                  Удалить
                </Button>
              </div>
            </div>
            <AskChat chatId={chat.id} initial={chat.messages} />
            <Sheet open={confirm} onClose={() => setConfirm(false)} title="Удалить разговор?">
              <div className="space-y-3">
                <p className="text-sm text-muted">Вопросы и ответы этого разговора будут удалены. Файлы проекта не затрагиваются.</p>
                <Button
                  variant="danger"
                  className="w-full"
                  onClick={async () => {
                    await api(`/api/ask/${chat.id}`, { method: "DELETE" });
                    router.push("/ask");
                  }}
                >
                  Удалить
                </Button>
              </div>
            </Sheet>
          </>
        )}
      </Page>
    </>
  );
}
