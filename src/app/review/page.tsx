"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Drill, ResultCells, type DrillResult } from "@/components/Drill";
import { StartSession } from "@/components/StartSession";
import { Button, Card, Icon, Kbd, KeyHandler, LinkButton, Loading, Notice, Page, PanelTitle, StatusItem, TopNav } from "@/components/ui";
import { notifyChanged } from "@/components/workbench-context";
import { api, plural } from "@/lib/api";
import type { DrillItem, TutorReview } from "@/lib/types";

type Stage = "intro" | "drill" | "end";

export default function ReviewPage() {
  const [topic, setTopic] = useState<number | null | undefined>(undefined);
  const [data, setData] = useState<{ items: DrillItem[]; tutorOnly: TutorReview[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("intro");
  const [results, setResults] = useState<DrillResult[]>([]);
  const [tutor, setTutor] = useState<number | null>(null);

  const load = useCallback(async (t: number | null) => {
    setError(null);
    try {
      setData(await api(`/api/practice?mode=review${t ? `&topic=${t}` : ""}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const t = Number(new URLSearchParams(window.location.search).get("topic")) || null;
    setTopic(t);
    load(t);
  }, [load]);

  const items = data?.items ?? [];
  const tutorOnly = data?.tutorOnly ?? [];
  const topics = new Map<number, { title: string; n: number; overdue: number }>();
  for (const it of items) {
    const t = topics.get(it.topic.id) ?? { title: it.topic.title, n: 0, overdue: 0 };
    t.n++;
    t.overdue = Math.max(t.overdue, it.overdueDays ?? 0);
    topics.set(it.topic.id, t);
  }
  const scoped = topic ? (items[0]?.topic.title ?? tutorOnly[0]?.title) : null;
  const right = results.filter((r) => r.outcome === "correct").length;
  const wrong = results.filter((r) => r.outcome === "wrong" || r.outcome === "partial").length;

  const begin = () => {
    setResults([]);
    setStage("drill");
  };
  const again = async () => {
    setStage("intro");
    setData(null);
    await load(topic ?? null);
  };

  return (
    <>
      <TopNav
        tab="Повторение"
        icon="clock"
        crumbs={[{ label: scoped ? `Повторение: ${scoped}` : "Повторение на сегодня" }]}
        status={
          data && (
            <>
              <StatusItem icon="clock">
                {items.length} {plural(items.length, "вопрос", "вопроса", "вопросов")}
              </StatusItem>
              {stage !== "intro" && (
                <StatusItem icon="check" title="Верных ответов">
                  {right} из {results.length}
                </StatusItem>
              )}
            </>
          )
        }
      />
      <Page narrow>
        <h1 className="text-[26px] leading-tight font-normal text-bright">{scoped ? `Повторение: ${scoped}` : "Повторение на сегодня"}</h1>
        <p className="mt-1 mb-6 max-w-[64ch] text-muted">
          Вопросы из прошлых уроков по идеям, которые пора освежить. Отвечаешь без репетитора, это бесплатно и быстро; каждый ответ сдвигает следующее повторение.
        </p>
        {error && <Notice tone="bad">{error}</Notice>}

        {!data ? (
          !error && <Loading />
        ) : stage === "drill" ? (
          <Drill
            items={items}
            mode="review"
            onFinish={(r) => {
              setResults(r);
              setStage("end");
              notifyChanged();
            }}
          />
        ) : stage === "end" ? (
          <div className="enter space-y-4">
            <Card className="space-y-3">
              <h2 className="text-lg text-bright">Повторение закончено</h2>
              <ResultCells results={results.map((r) => r.outcome)} total={results.length} />
              <p className="text-muted">
                Верно {right} из {results.length}
                {wrong ? `, с ошибками ${wrong}: эти идеи вернутся скоро, ошибки — в «Работе над ошибками».` : ". Следующее повторение отодвинулось."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={again}>
                  Проверить, что ещё осталось
                </Button>
                {wrong > 0 && <LinkButton href="/mistakes">Работа над ошибками</LinkButton>}
                <LinkButton href="/stats" variant="ghost">
                  Статистика
                </LinkButton>
              </div>
            </Card>
          </div>
        ) : items.length === 0 && tutorOnly.length === 0 ? (
          <Card className="enter">
            <div className="flex items-start gap-3">
              <Icon name="check" size={22} className="mt-0.5 text-ok" />
              <div>
                <h2 className="text-lg text-bright">На сегодня всё повторено</h2>
                <p className="mt-1 text-muted">Новые вопросы появятся, когда подойдёт срок следующего повторения. Можно пройти новый урок или прорешать ошибки.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <LinkButton href="/" variant="primary">
                    К темам
                  </LinkButton>
                  <LinkButton href="/mistakes">Работа над ошибками</LinkButton>
                </div>
              </div>
            </div>
          </Card>
        ) : (
          <div className="enter space-y-4">
            {items.length > 0 && (
              <section className="overflow-hidden rounded-md border border-border bg-surface">
                <PanelTitle right={<span className="text-xs text-muted">около {Math.max(1, Math.round(items.length * 1.2))} мин</span>}>
                  {items.length} {plural(items.length, "вопрос", "вопроса", "вопросов")} из {topics.size} {plural(topics.size, "темы", "тем", "тем")}
                </PanelTitle>
                <ul className="divide-y divide-border">
                  {[...topics.entries()].map(([id, t], i) => (
                    <li key={id} style={{ "--i": i } as React.CSSProperties} className="enter flex items-center gap-3 px-3 py-2">
                      <Icon name="file" className="text-accent" />
                      <Link href={`/topics/${id}`} className="min-w-0 flex-1 truncate text-bright hover:text-accent">
                        {t.title}
                      </Link>
                      {t.overdue > 0 && <span className="shrink-0 text-xs text-warn">просрочено до {t.overdue} дн.</span>}
                      <span className="shrink-0 text-xs text-muted tabular-nums">{t.n}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-3 border-t border-border px-3 py-2.5">
                  <Button variant="primary" onClick={begin} autoFocus>
                    <Icon name="play" /> Начать
                  </Button>
                  <span className="hidden text-xs text-muted sm:inline">
                    <Kbd>Enter</Kbd> начать, в вопросах <Kbd>1</Kbd>–<Kbd>9</Kbd> и <Kbd>Ctrl+Enter</Kbd>
                  </span>
                </div>
              </section>
            )}
            {tutorOnly.length > 0 && (
              <section className="overflow-hidden rounded-md border border-border bg-surface">
                <PanelTitle>Только с репетитором</PanelTitle>
                <p className="px-3 pt-2 text-sm text-muted">По этим идеям ещё нет вопросов, которые можно задать повторно: их повторит репетитор.</p>
                <ul className="divide-y divide-border">
                  {tutorOnly.map((t) => (
                    <li key={t.topicId} className="flex items-center gap-3 px-3 py-2">
                      <Icon name="book" className="text-accent" />
                      <span className="min-w-0 flex-1 truncate text-bright">{t.title}</span>
                      <span className="shrink-0 text-xs text-muted">
                        {t.nodes} {plural(t.nodes, "идея", "идеи", "идей")}
                      </span>
                      <Button small onClick={() => setTutor(t.topicId)}>
                        Повторить с репетитором
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {items.length > 0 && <KeyHandler onKey={(e, typing) => !typing && e.key === "Enter" && (e.target as HTMLElement)?.tagName !== "BUTTON" && (e.preventDefault(), begin())} />}
          </div>
        )}
      </Page>
      <StartSession topicId={tutor ?? 0} kind={tutor ? "review" : null} onClose={() => setTutor(null)} />
    </>
  );
}
