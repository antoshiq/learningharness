"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AskChat } from "@/components/AskChat";
import { Card, cx, Field, Icon, inputClass, Page, PanelTitle, TopNav } from "@/components/ui";
import { api, formatDate } from "@/lib/api";

interface Row {
  id: number;
  repo: string;
  url: string | null;
  title: string;
  updatedAt: number;
}

const EMPTY: never[] = [];

export default function AskPage() {
  const [repo, setRepo] = useState("");
  const [chats, setChats] = useState<Row[] | null>(null);

  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("repo");
    if (r) setRepo(r);
    api<{ chats: Row[] }>("/api/ask")
      .then((d) => setChats(d.chats))
      .catch(() => setChats([]));
  }, []);

  return (
    <>
      <TopNav tab="Вопрос к проекту" icon="chat" crumbs={[{ label: "Вопрос к проекту" }]} />
      <Page narrow>
        <h1 className="text-[26px] leading-tight font-normal text-bright">Вопрос к проекту</h1>
        <p className="mt-1 mb-6 max-w-[64ch] text-muted">
          Спроси что угодно о коде: где что находится, как работает, что сломается при изменении. Ответ со ссылками на файлы и строки. Подходит папка на компьютере или публичный
          репозиторий GitHub.
        </p>
        <Card className="space-y-4">
          <Field label="Проект: путь к папке или ссылка на GitHub">
            <input
              className={cx(inputClass, "font-mono text-[15px]")}
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="C:\Users\...\my-project или https://github.com/owner/repo"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </Field>
          <AskChat repo={repo} initial={EMPTY} />
        </Card>

        {chats && chats.length > 0 && (
          <section className="mt-8 overflow-hidden rounded-md border border-border bg-surface">
            <PanelTitle right={<span className="text-xs text-muted tabular-nums">{chats.length}</span>}>Прошлые разговоры</PanelTitle>
            <ul className="divide-y divide-border">
              {chats.map((c, i) => (
                <li key={c.id} style={{ "--i": Math.min(i, 10) } as React.CSSProperties} className="enter">
                  <Link href={`/ask/${c.id}`} className="group flex items-center gap-3 px-3 py-2 hover:bg-surface-2/60">
                    <Icon name={c.url ? "repo" : "chat"} className="text-accent" />
                    <span className="min-w-0 flex-1 truncate text-bright group-hover:text-accent">{c.title}</span>
                    <span className="shrink-0 text-xs text-muted">{formatDate(c.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </Page>
    </>
  );
}
