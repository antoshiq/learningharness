"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BriefView } from "@/components/BriefView";
import { Badge, Button, Card, Icon, LinkButton, Loading, Notice, Page, Sheet, StatusItem, TopNav } from "@/components/ui";
import { notifyChanged } from "@/components/workbench-context";
import { api, formatDate } from "@/lib/api";
import { BRIEF_KIND_LABEL, DEPTH_LABEL } from "@/lib/brief";

interface Brief {
  id: number;
  kind: "topic" | "files" | "repo" | "url" | "changes";
  title: string;
  source: string;
  depth: number;
  text: string;
  expansions: Record<string, string>;
  files: string[];
  topicId: number | null;
  createdAt: number;
}

export default function BriefDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [b, setB] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [carding, setCarding] = useState(false);
  const [cardsMsg, setCardsMsg] = useState<{ topicId: number; added: number } | null>(null);

  useEffect(() => {
    api<Brief>(`/api/briefs/${id}`)
      .then(setB)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const study = async () => {
    if (!b) return;
    setBusy(true);
    try {
      const r = await api<{ id: number }>(`/api/briefs/${b.id}/topic`, { body: {} });
      notifyChanged();
      router.push(`/topics/${r.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const makeCards = async () => {
    if (!b) return;
    setCarding(true);
    setError(null);
    try {
      const r = await api<{ topicId: number; added: number }>(`/api/briefs/${b.id}/cards`, { body: { count: b.depth === 1 ? 6 : b.depth === 15 ? 15 : 10 } });
      setCardsMsg(r);
      setB({ ...b, topicId: r.topicId });
      notifyChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setCarding(false);
  };

  const download = () => {
    if (!b) return;
    const blob = new Blob([`# ${b.title}\n\n${b.text}\n`], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${b.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "экскурс"}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <TopNav
        tab={b?.title ?? "Экскурс"}
        icon="compass"
        crumbs={[{ label: "Быстрый экскурс", href: "/brief" }, { label: b?.title ?? "…" }]}
        status={b && <StatusItem title="Глубина">{DEPTH_LABEL[b.depth]}</StatusItem>}
      />
      <Page narrow>
        {error && (
          <div className="mb-4">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}
        {!b ? (
          !error && <Loading />
        ) : (
          <>
            <h1 className="text-[26px] leading-tight font-normal text-balance text-bright">{b.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge>{BRIEF_KIND_LABEL[b.kind]}</Badge>
              <span>{DEPTH_LABEL[b.depth]} чтения</span>
              <span>· {formatDate(b.createdAt)}</span>
              {b.kind !== "topic" && <span className="min-w-0 truncate font-mono">· {b.source}</span>}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {b.topicId ? (
                <LinkButton href={`/topics/${b.topicId}`} variant="primary">
                  <Icon name="book" /> Открыть тему
                </LinkButton>
              ) : (
                <Button variant="primary" onClick={study} disabled={busy}>
                  <Icon name="book" /> {busy ? "Создаю тему…" : "Учить это подробно"}
                </Button>
              )}
              <Button onClick={makeCards} disabled={carding} title="Вопросы по тезисам экскурса для интервального повторения">
                <Icon name="cards" /> {carding ? "Делаю карточки…" : "Сделать карточки"}
              </Button>
              {(b.kind === "repo" || b.kind === "changes") && (
                <>
                  <LinkButton href={`/ask?repo=${encodeURIComponent(b.source)}`}>
                    <Icon name="chat" /> Спросить о проекте
                  </LinkButton>
                  <LinkButton href={`/brief?kind=changes&repo=${encodeURIComponent(b.source)}`} variant="ghost">
                    <Icon name="redo" /> Что изменилось
                  </LinkButton>
                </>
              )}
              <Button
                variant="ghost"
                onClick={async () => {
                  await navigator.clipboard.writeText(b.text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Скопировано" : "Скопировать"}
              </Button>
              <Button variant="ghost" onClick={download}>
                <Icon name="download" /> Скачать .md
              </Button>
              <LinkButton href="/brief" variant="ghost">
                <Icon name="plus" /> Новый экскурс
              </LinkButton>
            </div>

            {cardsMsg && (
              <div className="enter mt-3">
                <Notice tone="ok">
                  Добавлено карточек: {cardsMsg.added}. Они уже в «Повторении на сегодня», дальше придут по расписанию.{" "}
                  <a href="/review" className="text-accent hover:underline">
                    Повторить сейчас
                  </a>{" "}
                  ·{" "}
                  <a href={`/topics/${cardsMsg.topicId}?tab=cards`} className="text-accent hover:underline">
                    Все карточки темы
                  </a>
                </Notice>
              </div>
            )}

            <p className="mt-4 text-xs text-muted">Нажми «подробнее» у любого пункта, чтобы раскрыть его. Раскрытые пункты сохраняются.</p>
            <Card className="enter mt-2">
              <BriefView id={b.id} text={b.text} expansions={b.expansions} />
            </Card>

            {b.files.length > 0 && (
              <details className="mt-4 text-sm text-muted">
                <summary className="cursor-pointer hover:text-bright">Прочитанные файлы: {b.files.length}</summary>
                <ul className="mt-2 space-y-0.5 font-mono text-xs">
                  {b.files.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </details>
            )}

            <div className="mt-10 border-t border-border pt-3">
              <Button small variant="ghost" onClick={() => setConfirmDelete(true)}>
                Удалить экскурс
              </Button>
            </div>
            <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Удалить экскурс?">
              <div className="space-y-3">
                <p className="text-sm text-muted">Экскурс «{b.title}» и раскрытые пункты будут удалены.{b.topicId ? " Созданная из него тема останется." : ""}</p>
                <Button
                  variant="danger"
                  className="w-full"
                  onClick={async () => {
                    await api(`/api/briefs/${b.id}`, { method: "DELETE" });
                    router.push("/brief");
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
