"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Drill, ResultCells, type DrillResult } from "@/components/Drill";
import { Markdown } from "@/components/Markdown";
import { Badge, Button, Card, Count, cx, Icon, LinkButton, Loading, Notice, Page, StatusItem, TopNav } from "@/components/ui";
import { notifyChanged } from "@/components/workbench-context";
import { api, formatDate, plural } from "@/lib/api";
import { KIND_LABEL, SELF_GRADED, type DrillItem } from "@/lib/types";

/** Start a lesson-style session with the tutor about one mistake. */
async function discuss(item: DrillItem): Promise<number> {
  const goal = `Разобрать мою ошибку в вопросе: ${item.question.prompt.replace(/\s+/g, " ").slice(0, 300)}${item.last.misconception ? `. Тогда я ошибся так: ${item.last.misconception}` : ""}`;
  try {
    return (await api<{ id: number }>("/api/sessions", { body: { topicId: item.topic.id, kind: "practice", goal } })).id;
  } catch {
    // Practice needs a started plan; a lesson with the same goal always works.
    return (await api<{ id: number }>("/api/sessions", { body: { topicId: item.topic.id, kind: "lesson", goal } })).id;
  }
}

export default function MistakesPage() {
  const router = useRouter();
  const [items, setItems] = useState<DrillItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<number | null>(null);
  const [drill, setDrill] = useState<DrillItem[] | null>(null);
  const [results, setResults] = useState<DrillResult[] | null>(null);
  const [opening, setOpening] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems((await api<{ items: DrillItem[] }>("/api/practice?mode=mistakes")).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    setFilter(Number(new URLSearchParams(window.location.search).get("topic")) || null);
    load();
  }, [load]);

  const topics = new Map<number, { title: string; n: number }>();
  for (const it of items ?? []) {
    const t = topics.get(it.topic.id) ?? { title: it.topic.title, n: 0 };
    t.n++;
    topics.set(it.topic.id, t);
  }
  const shown = (items ?? []).filter((it) => !filter || it.topic.id === filter);
  const solved = results?.filter((r) => r.outcome === "correct").length ?? 0;

  const open = async (it: DrillItem) => {
    setOpening(it.attemptId);
    try {
      router.push(`/session/${await discuss(it)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOpening(null);
    }
  };

  return (
    <>
      <TopNav
        tab="Работа над ошибками"
        icon="target"
        crumbs={[{ label: "Работа над ошибками" }]}
        status={
          items && (
            <StatusItem icon="target">
              {items.length} {plural(items.length, "ошибка", "ошибки", "ошибок")}
            </StatusItem>
          )
        }
      />
      <Page narrow>
        <h1 className="text-[26px] leading-tight font-normal text-bright">Работа над ошибками</h1>
        <p className="mt-1 mb-6 max-w-[64ch] text-muted">
          Вопросы, на которые ты ответил неверно или частично. Реши заново: верный ответ убирает ошибку из списка. Если непонятно, почему так, разбери её с репетитором.
        </p>
        {error && (
          <div className="mb-4">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}

        {items === null ? (
          !error && <Loading />
        ) : drill ? (
          <Drill
            items={drill}
            mode="mistakes"
            onFinish={(r) => {
              setResults(r);
              setDrill(null);
              notifyChanged();
              load();
            }}
          />
        ) : (
          <div className="space-y-4">
            {results && (
              <Card className="enter space-y-3">
                <h2 className="text-lg text-bright">
                  Исправлено {solved} из {results.length}
                </h2>
                <ResultCells results={results.map((r) => r.outcome)} total={results.length} />
                <p className="text-sm text-muted">{solved === results.length ? "Все ошибки этого захода исправлены." : "Нерешённые остались в списке ниже. Попробуй их с репетитором."}</p>
              </Card>
            )}

            {items.length === 0 ? (
              <Card className="enter">
                <div className="flex items-start gap-3">
                  <Icon name="check" size={22} className="mt-0.5 text-ok" />
                  <div>
                    <h2 className="text-lg text-bright">Нерешённых ошибок нет</h2>
                    <p className="mt-1 text-muted">Когда ответишь неверно на уроке или в повторении, вопрос появится здесь.</p>
                    <LinkButton href="/" variant="primary" className="mt-4">
                      К темам
                    </LinkButton>
                  </div>
                </div>
              </Card>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {topics.size > 1 && (
                    <>
                      <button
                        onClick={() => setFilter(null)}
                        className={cx("inline-flex h-7 items-center gap-1.5 rounded-sm border px-2 text-[13px]", !filter ? "border-accent bg-accent-soft text-bright" : "border-border-strong text-muted hover:text-bright")}
                      >
                        Все <Count n={items.length} active={!filter} />
                      </button>
                      {[...topics.entries()].map(([id, t]) => (
                        <button
                          key={id}
                          onClick={() => setFilter(id)}
                          className={cx("inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-sm border px-2 text-[13px]", filter === id ? "border-accent bg-accent-soft text-bright" : "border-border-strong text-muted hover:text-bright")}
                        >
                          <span className="truncate">{t.title}</span> <Count n={t.n} active={filter === id} />
                        </button>
                      ))}
                    </>
                  )}
                  <span className="flex-1" />
                  <Button
                    variant="primary"
                    onClick={() => {
                      setResults(null);
                      setDrill(shown);
                    }}
                    disabled={!shown.length}
                  >
                    <Icon name="redo" /> Прорешать {shown.length > 1 ? `все (${shown.length})` : ""}
                  </Button>
                </div>

                <ul className="space-y-2">
                  {shown.map((m, i) => (
                    <li
                      key={m.attemptId}
                      style={{ "--i": Math.min(i, 10) } as React.CSSProperties}
                      className={cx("enter rounded-sm border border-l-2 border-border bg-surface p-3", m.last.outcome === "partial" ? "border-l-warn" : "border-l-bad")}
                    >
                      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span className="text-[13px] text-bright">{m.topic.title}</span>
                        {m.node && <span>· {m.node.title}</span>}
                        <Badge>{KIND_LABEL[m.question.kind]}</Badge>
                        {SELF_GRADED.includes(m.question.kind) && <Badge>самопроверка</Badge>}
                        <span className="ml-auto">{formatDate(m.last.at)}</span>
                      </div>
                      <Markdown text={m.question.prompt} className="line-clamp-3 text-[15px]" />
                      {m.last.misconception && (
                        <p className="mt-1.5 text-sm text-muted">
                          Причина: <span className="text-text">{m.last.misconception}</span>
                        </p>
                      )}
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <Button
                          small
                          variant="primary"
                          onClick={() => {
                            setResults(null);
                            setDrill([m]);
                          }}
                        >
                          Решить заново
                        </Button>
                        <Button small onClick={() => open(m)} disabled={opening !== null}>
                          {opening === m.attemptId ? "Открываю…" : "Разобрать с репетитором"}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </Page>
    </>
  );
}
