"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { PlanGraph } from "@/components/PlanGraph";
import { StartSession } from "@/components/StartSession";
import { Badge, Button, Card, cx, LinkButton, Notice, Page, Sheet, TopNav } from "@/components/ui";
import { api, formatCost, formatDate, formatTokens } from "@/lib/api";
import { KIND_LABEL, type PlanNodeView, type QuestionKind, type SessionSummary, type UsageTotals } from "@/lib/types";

interface Detail {
  topic: { id: number; title: string; goal: string; kind: "topic" | "repo"; repoPath: string | null; repoMap: string | null };
  plan: PlanNodeView[];
  sessions: { id: number; kind: "lesson" | "practice" | "review"; startedAt: number; endedAt: number | null; summary: SessionSummary | null }[];
  mistakes: {
    id: number;
    nodeKey: string | null;
    kind: QuestionKind;
    prompt: string;
    outcome: string;
    confidence: number | null;
    misconceptionType: string | null;
    misconception: string | null;
    at: number;
  }[];
  calibration: { level: number; total: number; correct: number }[];
  parking: { id: number; text: string; done: boolean; createdAt: number }[];
  usage: UsageTotals;
}

const KIND = { lesson: "Урок", practice: "Практика", review: "Повторение" } as const;
const CONF = ["Угадывал", "Скорее да", "Уверен"];
type Tab = "map" | "mistakes" | "parking" | "sessions" | "repo";

export default function TopicPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("map");
  const [start, setStart] = useState<"lesson" | "practice" | "review" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setD(await api<Detail>(`/api/topics/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <>
        <TopNav back={{ href: "/", label: "Темы" }} />
        <Page>
          <Notice tone="bad">{error}</Notice>
        </Page>
      </>
    );
  }
  if (!d) return <div className="p-6 text-sm text-muted">Загрузка…</div>;


  const due = d.plan.filter((n) => n.status !== "new" && n.dueAt !== null && n.dueAt <= now).length;
  const started = d.plan.some((n) => n.status !== "new");
  const open = d.sessions.find((s) => s.kind === "lesson" && !s.endedAt);
  const mastered = d.plan.filter((n) => n.status === "mastered").length;
  const nodeTitle = (key: string | null) => (key ? (d.plan.find((n) => n.key === key)?.title ?? key) : "Диагностика");

  // Misconception types that keep coming back are the most useful thing in the journal.
  const byType = new Map<string, number>();
  for (const m of d.mistakes) if (m.misconceptionType) byType.set(m.misconceptionType, (byType.get(m.misconceptionType) ?? 0) + 1);
  const confidentWrong = d.mistakes.filter((m) => m.confidence === 3).length;

  const tabs: [Tab, string][] = [
    ["map", "Карта"],
    ["mistakes", `Ошибки${d.mistakes.length ? ` · ${d.mistakes.length}` : ""}`],
    ["parking", `Парковка${d.parking.filter((p) => !p.done).length ? ` · ${d.parking.filter((p) => !p.done).length}` : ""}`],
    ["sessions", "Сессии"],
    ...(d.topic.kind === "repo" ? ([["repo", "Проект"]] as [Tab, string][]) : []),
  ];

  const toggleParking = async (pid: number, done: boolean) => {
    await api("/api/parking", { method: "PATCH", body: { id: pid, done } });
    load();
  };

  return (
    <>
      <TopNav back={{ href: "/", label: "Темы" }} />
      <Page>
        <h1 className="text-xl font-semibold sm:text-2xl">{d.topic.title}</h1>
        {d.topic.goal && <p className="mt-1 text-muted">{d.topic.goal}</p>}
        {d.topic.repoPath && <p className="mt-1 font-mono text-xs break-all text-muted">{d.topic.repoPath}</p>}
        <p className="mt-2 text-sm text-muted">
          {d.plan.length ? `Освоено ${mastered} из ${d.plan.length}` : "План появится после диагностики на первом уроке"}
          {d.usage.inputTokens + d.usage.outputTokens > 0 &&
            ` · расход: ${
              d.usage.cost !== null && (d.usage.cost > 0 || d.usage.costKnown)
                ? formatCost(d.usage.cost, d.usage.costKnown)
                : formatTokens(d.usage.inputTokens + d.usage.cacheReadTokens + d.usage.outputTokens) + " токенов"
            }`}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {open ? (
            <LinkButton href={`/session/${open.id}`} variant="primary">
              Продолжить урок
            </LinkButton>
          ) : (
            <Button variant="primary" onClick={() => setStart("lesson")}>
              {d.plan.length ? "Новый урок" : "Начать"}
            </Button>
          )}
          <Button onClick={() => setStart("review")} disabled={!due} title={due ? "" : "Пока нечего повторять"}>
            Повторение{due ? ` · ${due}` : ""}
          </Button>
          <Button onClick={() => setStart("practice")} disabled={!started} title={started ? "" : "Доступно после первого пройденного узла"}>
            Практика
          </Button>
        </div>

        <div className="mt-6 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cx(
                "-mb-px min-h-11 shrink-0 border-b-2 px-3 text-sm whitespace-nowrap",
                tab === k ? "border-accent font-medium text-text" : "border-transparent text-muted hover:text-text",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {tab === "map" && <PlanGraph plan={d.plan} />}

          {tab === "mistakes" && (
            <div className="space-y-4">
              <Card>
                <h3 className="mb-2 font-medium">Калибровка уверенности</h3>
                <p className="mb-3 text-sm text-muted">Как часто ты прав на каждом уровне уверенности. Низкая доля при «Уверен» — самые опасные пробелы.</p>
                <div className="space-y-2">
                  {d.calibration.map((c) => {
                    const pct = c.total ? Math.round((c.correct / c.total) * 100) : null;
                    return (
                      <div key={c.level} className="flex items-center gap-3 text-sm">
                        <span className="w-24 shrink-0">{CONF[c.level - 1]}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${pct ?? 0}%` }} />
                        </div>
                        <span className="w-28 shrink-0 text-right text-muted tabular-nums">{pct === null ? "нет данных" : `${pct}% из ${c.total}`}</span>
                      </div>
                    );
                  })}
                </div>
                {confidentWrong > 0 && <p className="mt-3 text-sm text-warn">Уверенных ошибок: {confidentWrong}</p>}
              </Card>
              {byType.size > 0 && (
                <div className="flex flex-wrap gap-2">
                  {[...byType.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([t, n]) => (
                      <Badge key={t} tone="warn">
                        {t} · {n}
                      </Badge>
                    ))}
                </div>
              )}
              {d.mistakes.length === 0 ? (
                <p className="text-sm text-muted">Ошибок пока нет.</p>
              ) : (
                <ul className="space-y-2">
                  {d.mistakes.map((m) => (
                    <li key={m.id} className="rounded-xl border border-border bg-surface p-3.5">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span className="font-medium text-text">{nodeTitle(m.nodeKey)}</span>
                        <Badge>{KIND_LABEL[m.kind]}</Badge>
                        <Badge tone={m.outcome === "wrong" ? "bad" : "warn"}>{m.outcome === "wrong" ? "неверно" : "частично"}</Badge>
                        {m.confidence === 3 && <Badge tone="bad">был уверен</Badge>}
                        <span className="ml-auto">{formatDate(m.at)}</span>
                      </div>
                      {m.misconception ? (
                        <p className="text-[15px]">
                          {m.misconceptionType && <span className="text-muted">{m.misconceptionType}: </span>}
                          {m.misconception}
                        </p>
                      ) : (
                        <p className="text-sm text-muted">Причина не записана.</p>
                      )}
                      <details className="mt-1.5 text-sm text-muted">
                        <summary className="cursor-pointer">Вопрос</summary>
                        <Markdown text={m.prompt} className="mt-1.5" />
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "parking" &&
            (d.parking.length === 0 ? (
              <p className="text-sm text-muted">Здесь появятся мысли и вопросы, которые ты отложишь во время урока.</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
                {d.parking.map((p) => (
                  <li key={p.id} className="flex items-start gap-3 px-4 py-3">
                    <input type="checkbox" className="mt-1 size-5 shrink-0" checked={p.done} onChange={() => toggleParking(p.id, !p.done)} aria-label="Разобрано" />
                    <div className={cx("min-w-0 flex-1", p.done && "text-muted line-through")}>{p.text}</div>
                    <span className="shrink-0 text-xs text-muted">{formatDate(p.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ))}

          {tab === "sessions" &&
            (d.sessions.length === 0 ? (
              <p className="text-sm text-muted">Сессий ещё не было.</p>
            ) : (
              <ul className="space-y-2">
                {d.sessions.map((s) => (
                  <li key={s.id}>
                    <Link href={`/session/${s.id}`} className="block rounded-xl border border-border bg-surface p-3.5 hover:bg-surface-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">{KIND[s.kind]}</span>
                        <span className="text-muted">{formatDate(s.startedAt)}</span>
                        {!s.endedAt && <Badge tone="accent">не завершена</Badge>}
                        {s.endedAt && <span className="ml-auto text-xs text-muted">{Math.max(1, Math.round((s.endedAt - s.startedAt) / 60000))} мин</span>}
                      </div>
                      {s.summary && <p className="mt-1 line-clamp-2 text-sm text-muted">Дальше: {s.summary.next}</p>}
                    </Link>
                  </li>
                ))}
              </ul>
            ))}

          {tab === "repo" &&
            (d.topic.repoMap ? (
              <Card>
                <Markdown text={d.topic.repoMap} />
              </Card>
            ) : (
              <p className="text-sm text-muted">Карта проекта появится после анализа репозитория на первом уроке.</p>
            ))}
        </div>

        <div className="mt-10 border-t border-border pt-4">
          <Button small variant="ghost" onClick={() => setConfirmDelete(true)}>
            Удалить тему
          </Button>
        </div>
      </Page>

      <StartSession topicId={d.topic.id} kind={start} onClose={() => setStart(null)} />
      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Удалить тему?">
        <div className="space-y-3">
          <p className="text-sm text-muted">Будут удалены план, прогресс, все сессии и журнал ошибок по теме «{d.topic.title}». Это нельзя отменить.{d.topic.repoPath ? " Файлы репозитория не затрагиваются." : ""}</p>
          <Button
            variant="danger"
            className="w-full"
            onClick={async () => {
              await api(`/api/topics/${d.topic.id}`, { method: "DELETE" });
              router.push("/");
            }}
          >
            Удалить
          </Button>
        </div>
      </Sheet>
    </>
  );
}
