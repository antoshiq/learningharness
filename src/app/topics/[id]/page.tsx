"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { CardsTab } from "@/components/CardsTab";
import { MaterialsTab, type Material } from "@/components/MaterialsTab";
import { PlanGraph } from "@/components/PlanGraph";
import { StartSession } from "@/components/StartSession";
import { Badge, Button, Card, Cells, Count, cx, Icon, inputClass, LinkButton, Loading, Notice, Page, Sheet, StatusItem, TopNav } from "@/components/ui";
import { notifyChanged } from "@/components/workbench-context";
import { api, formatCost, formatDate, formatTokens, streamPost } from "@/lib/api";
import { KIND_LABEL, type PlanNodeView, type QuestionKind, type SessionSummary, type UsageTotals } from "@/lib/types";

interface Detail {
  topic: { id: number; title: string; goal: string; kind: "topic" | "repo"; repoPath: string | null; repoMap: string | null; notes: string | null; notesAt: number | null };
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
  materials: Material[];
  usage: UsageTotals;
  /** Set when the topic is a module of a semester. */
  semester: {
    semesterId: number;
    semesterTitle: string;
    moduleId: number;
    moduleIdx: number;
    kind: "regular" | "prereq";
    credit: string | null;
    threshold: number;
    status: "locked" | "open" | "passed";
  } | null;
}

const KIND = { lesson: "Урок", practice: "Практика", review: "Повторение" } as const;
const CONF = ["Угадывал", "Скорее да", "Уверен"];
type Tab = "map" | "materials" | "notes" | "cards" | "mistakes" | "parking" | "sessions" | "repo";
const TABS: Tab[] = ["map", "materials", "notes", "cards", "mistakes", "parking", "sessions", "repo"];

/** The cheat sheet: written by the tutor on request from everything learned so far. */
function Notes({ topic, onSaved }: { topic: Detail["topic"]; onSaved: () => Promise<void> }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const writing = text !== null;

  const write = async () => {
    setText("");
    setError(null);
    let failed = false;
    try {
      await streamPost(`/api/topics/${topic.id}/notes`, {}, (e) => {
        if (e.type === "text") setText((t) => (t ?? "") + e.delta);
        if (e.type === "error") {
          failed = true;
          setError(e.message);
        }
      });
    } catch (e) {
      failed = true;
      setError(e instanceof Error ? e.message : String(e));
    }
    if (!failed) await onSaved();
    setText(null);
  };

  const notes = topic.notes;
  const download = () => {
    const blob = new Blob([`# ${topic.title}\n\n${notes ?? ""}\n`], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${topic.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "конспект"}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={notes ? "secondary" : "primary"} onClick={write} disabled={writing}>
          <Icon name="note" /> {writing ? "Репетитор пишет…" : notes ? "Обновить конспект" : "Составить конспект"}
        </Button>
        {notes && !writing && (
          <>
            <Button
              variant="ghost"
              onClick={async () => {
                await navigator.clipboard.writeText(notes);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Скопировано" : "Скопировать"}
            </Button>
            <Button variant="ghost" onClick={download}>
              <Icon name="download" /> Скачать .md
            </Button>
          </>
        )}
        {notes && topic.notesAt && !writing && <span className="ml-auto text-xs text-muted">обновлён {formatDate(topic.notesAt)}</span>}
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      {writing ? (
        <Card>{text ? <Markdown text={text} className="prose-lesson streaming" /> : <p className="text-sm text-muted">Собираю план, итоги уроков и твои ошибки…</p>}</Card>
      ) : notes ? (
        <Card className="appear">
          <Markdown text={notes} className="prose-lesson" />
        </Card>
      ) : (
        <p className="max-w-[64ch] text-muted">
          Шпаргалка по теме: суть каждой идеи, правила, формулы и примеры кода, твои частые ошибки и вопросы для самопроверки. Её составляет основная модель по плану, итогам уроков и
          вопросам из них. Обновляй после новых уроков.
        </p>
      )}
    </div>
  );
}

/** Parked thoughts as small tasks: tick off, take to a lesson, turn into a topic, or delete. */
function ParkingList({ d, load, onLesson }: { d: Detail; load: () => Promise<void>; onLesson: (p: { id: number; text: string }) => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = d.parking.filter((p) => !p.done);
  const done = d.parking.filter((p) => p.done);

  const guard = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const patch = (id: number, body: { done?: boolean; remove?: boolean }) =>
    guard(async () => {
      await api("/api/parking", { method: "PATCH", body: { id, ...body } });
      await load();
    });
  const add = () =>
    guard(async () => {
      if (!text.trim()) return;
      await api("/api/parking", { body: { topicId: d.topic.id, text } });
      setText("");
      await load();
    });
  const toTopic = (p: { id: number; text: string }) =>
    guard(async () => {
      const { id } = await api<{ id: number }>("/api/topics", {
        body: { kind: "topic", title: p.text.slice(0, 200), goal: `Вопрос, отложенный в теме «${d.topic.title}»: ${p.text}` },
      });
      await api("/api/parking", { method: "PATCH", body: { id: p.id, done: true } });
      router.push(`/topics/${id}`);
    });

  const row = (p: Detail["parking"][number], i: number) => (
    <li key={p.id} style={{ "--i": Math.min(i, 10) } as React.CSSProperties} className="enter group flex items-start gap-3 px-3 py-2.5">
      <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={p.done} onChange={() => patch(p.id, { done: !p.done })} aria-label={p.done ? "Вернуть в список" : "Разобрано"} />
      <div className="min-w-0 flex-1">
        <div className={cx("[overflow-wrap:anywhere]", p.done && "text-muted line-through")}>{p.text}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>{formatDate(p.createdAt)}</span>
          {!p.done && (
            <>
              <button className="text-accent hover:underline" onClick={() => onLesson(p)}>
                Разобрать на уроке
              </button>
              <button className="text-accent hover:underline" onClick={() => toTopic(p)}>
                Сделать отдельной темой
              </button>
            </>
          )}
        </div>
      </div>
      <button
        onClick={() => patch(p.id, { remove: true })}
        aria-label="Удалить"
        title="Удалить"
        className="grid size-7 shrink-0 place-items-center rounded-sm text-muted opacity-60 group-hover:opacity-100 hover:bg-surface-2 hover:text-bad"
      >
        <Icon name="trash" size={14} />
      </button>
    </li>
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          className={inputClass}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Отложить мысль или вопрос на потом"
          aria-label="Новая запись на парковке"
        />
        <Button variant="primary" onClick={add} disabled={!text.trim()}>
          Добавить
        </Button>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      {open.length === 0 ? (
        <p className="text-muted">{done.length ? "Всё отложенное разобрано." : "Здесь появятся мысли и вопросы, которые ты отложишь во время урока."}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-surface">{open.map(row)}</ul>
      )}
      {done.length > 0 && (
        <div>
          <button onClick={() => setShowDone((v) => !v)} className="flex items-center gap-1 text-[13px] text-muted hover:text-bright">
            <Icon name="chevron" size={14} className={cx("transition-transform duration-150", showDone && "rotate-90")} />
            Разобрано: {done.length}
          </button>
          <div className="fold mt-2" data-open={showDone}>
            <div>
              <ul className="divide-y divide-border rounded-md border border-border bg-surface">{done.map(row)}</ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export default function TopicPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("map");
  const [start, setStart] = useState<"lesson" | "practice" | "review" | null>(null);
  const [parked, setParked] = useState<{ id: number; text: string } | null>(null);
  const [lessonGoal, setLessonGoal] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setD(await api<Detail>(`/api/topics/${id}`));
      notifyChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (t && TABS.includes(t)) setTab(t);
  }, []);
  // From the study plan: ?start=lesson[&node=key] opens the lesson dialog with that idea as the goal.
  const planned = useRef(false);
  useEffect(() => {
    if (!d || planned.current) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("start") !== "lesson") return;
    planned.current = true;
    const node = d.plan.find((n) => n.key === q.get("node"));
    setLessonGoal(node ? `Изучить: ${node.title}` : "");
    const open = d.sessions.find((s) => s.kind === "lesson" && !s.endedAt);
    if (open) router.push(`/session/${open.id}`);
    else setStart("lesson");
    window.history.replaceState(null, "", `/topics/${d.topic.id}`);
  }, [d, router]);

  if (error) {
    return (
      <>
        <TopNav tab="Тема" />
        <Page>
          <Notice tone="bad">{error}</Notice>
        </Page>
      </>
    );
  }
  if (!d) return <Loading />;

  const due = d.plan.filter((n) => n.status !== "new" && n.dueAt !== null && n.dueAt <= now).length;
  const started = d.plan.some((n) => n.status !== "new");
  const open = d.sessions.find((s) => s.kind === "lesson" && !s.endedAt);
  const mastered = d.plan.filter((n) => n.status === "mastered").length;
  const nodeTitle = (key: string | null) => (key ? (d.plan.find((n) => n.key === key)?.title ?? key) : "Диагностика");

  // Misconception types that keep coming back are the most useful thing in the journal.
  const byType = new Map<string, number>();
  for (const m of d.mistakes) if (m.misconceptionType) byType.set(m.misconceptionType, (byType.get(m.misconceptionType) ?? 0) + 1);
  const confidentWrong = d.mistakes.filter((m) => m.confidence === 3).length;

  const learning = d.plan.filter((n) => n.status === "learning").length;
  const parkedOpen = d.parking.filter((p) => !p.done).length;
  const tabs: [Tab, string, number][] = [
    ["map", "Карта", 0],
    ["materials", "Материалы", d.materials.length],
    ["notes", "Конспект", 0],
    ["cards", "Карточки", 0],
    ["mistakes", "Ошибки", d.mistakes.length],
    ["parking", "Парковка", parkedOpen],
    ["sessions", "Сессии", 0],
    ...(d.topic.kind === "repo" ? ([["repo", "Проект", 0]] as [Tab, string, number][]) : []),
  ];
  const spent =
    d.usage.inputTokens + d.usage.outputTokens > 0
      ? d.usage.cost !== null && (d.usage.cost > 0 || d.usage.costKnown)
        ? formatCost(d.usage.cost, d.usage.costKnown)
        : formatTokens(d.usage.inputTokens + d.usage.cacheReadTokens + d.usage.outputTokens) + " токенов"
      : null;

  return (
    <>
      <TopNav
        tab={d.topic.title}
        icon={d.topic.kind === "repo" ? "repo" : "file"}
        crumbs={[{ label: d.topic.title }]}
        status={
          <>
            {d.plan.length > 0 && (
              <StatusItem icon="check">
                Освоено {mastered} из {d.plan.length}
              </StatusItem>
            )}
            {due > 0 && <StatusItem icon="clock">Повторить: {due}</StatusItem>}
            {spent && (
              <StatusItem title="Расход по теме">
                {spent}
              </StatusItem>
            )}
          </>
        }
      />
      <Page>
        {d.semester && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-l-2 border-border border-l-accent bg-surface px-3 py-2 text-[13px]">
            <Icon name="cap" className="text-accent" />
            <span className="min-w-0 flex-1">
              {d.semester.kind === "prereq" ? "Нулевой модуль" : `Модуль ${d.semester.moduleIdx}`} семестра{" "}
              <Link href={`/semester/${d.semester.semesterId}`} className="text-accent hover:underline">
                «{d.semester.semesterTitle}»
              </Link>
              {d.semester.credit ? " · сдан" : d.semester.status === "locked" ? " · ещё закрыт" : ` · закрывается контрольной от ${d.semester.threshold}%`}
            </span>
            {d.semester.status === "open" && (
              <LinkButton small variant={d.plan.length > 0 && d.plan.every((n) => n.status === "mastered") ? "primary" : "secondary"} href={`/semester/${d.semester.semesterId}/exam?kind=checkpoint&module=${d.semester.moduleId}`}>
                <Icon name="check" size={14} /> Контрольная модуля
              </LinkButton>
            )}
          </div>
        )}
        <h1 className="text-[26px] leading-tight font-normal text-balance text-bright">{d.topic.title}</h1>
        {d.topic.goal && <p className="mt-1 max-w-[76ch] text-muted">{d.topic.goal}</p>}
        {d.topic.repoPath && <p className="mt-1 font-mono text-xs break-all text-muted">{d.topic.repoPath}</p>}

        {/* Everything measurable about the topic, in one strip. */}
        <dl className="mt-4 grid grid-cols-2 overflow-hidden rounded-md border border-border bg-surface sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ["Освоено", d.plan.length ? `${mastered} из ${d.plan.length}` : "—", "text-ok"],
              ["В процессе", String(learning), "text-warn"],
              ["Пора повторить", String(due), due ? "text-accent" : "text-bright"],
              ["Ошибок", String(d.mistakes.length), d.mistakes.length ? "text-bad" : "text-bright"],
              ["Сессий", String(d.sessions.length), "text-bright"],
              ["Расход", spent ?? "—", "text-bright"],
            ] as const
          ).map(([label, value, tone], i) => (
            <div key={label} style={{ "--i": i + 1 } as React.CSSProperties} className="enter -mt-px -ml-px border-t border-l border-border px-3 py-2">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className={cx("mt-0.5 truncate text-[15px] leading-tight tabular-nums", tone)}>{value}</dd>
            </div>
          ))}
        </dl>
        {d.plan.length > 0 && (
          <div className="mt-3">
            <Cells total={d.plan.length} mastered={mastered} learning={learning} />
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {open ? (
            <LinkButton href={`/session/${open.id}`} variant="primary">
              Продолжить урок
            </LinkButton>
          ) : (
            <Button variant="primary" onClick={() => setStart("lesson")}>
              {d.plan.length ? "Новый урок" : "Начать"}
            </Button>
          )}
          {due > 0 ? (
            <LinkButton href={`/review?topic=${d.topic.id}`}>
              Повторение
              <Count n={due} active />
            </LinkButton>
          ) : (
            <Button disabled title="Пока нечего повторять">
              Повторение
            </Button>
          )}
          {due > 0 && (
            <Button variant="ghost" onClick={() => setStart("review")} title="Повторение, которое ведёт репетитор">
              С репетитором
            </Button>
          )}
          <Button onClick={() => setStart("practice")} disabled={!started} title={started ? "" : "Доступно после первого пройденного узла"}>
            Практика
          </Button>
          <LinkButton href={`/exam?topic=${d.topic.id}`}>
            <Icon name="check" /> Экзамен
          </LinkButton>
          {d.plan.length > 0 && (
            <LinkButton href={`/oral?topic=${d.topic.id}`} variant="ghost">
              <Icon name="chat" /> Устный экзамен
            </LinkButton>
          )}
          <LinkButton href={`/explain?topic=${d.topic.id}`} variant="ghost">
            <Icon name="chat" /> Объясни своими словами
          </LinkButton>
          <LinkButton href={`/plan?topic=${d.topic.id}`} variant="ghost">
            <Icon name="calendar" /> К дате
          </LinkButton>
          {d.topic.kind === "repo" && d.topic.repoPath && (
            <>
              <LinkButton href={`/ask?repo=${encodeURIComponent(d.topic.repoPath)}`} variant="ghost">
                <Icon name="chat" /> Спросить о проекте
              </LinkButton>
              <LinkButton href={`/brief?kind=changes&repo=${encodeURIComponent(d.topic.repoPath)}`} variant="ghost">
                <Icon name="redo" /> Что изменилось
              </LinkButton>
            </>
          )}
        </div>

        {/* View tabs, as on the editor's bottom panel: the active one is underlined. */}
        <div className="mt-8 flex gap-5 overflow-x-auto border-b border-border" role="tablist">
          {tabs.map(([k, label, count]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cx(
                "-mb-px flex min-h-10 shrink-0 items-center gap-1.5 border-b text-[13px] whitespace-nowrap transition-colors sm:min-h-9",
                tab === k ? "border-accent text-bright" : "border-transparent text-muted hover:text-bright",
              )}
            >
              {label}
              {count > 0 && <Count n={count} active={tab === k} />}
            </button>
          ))}
        </div>

        <div key={tab} className="enter mt-4">
          {tab === "map" && <PlanGraph plan={d.plan} />}

          {tab === "materials" && <MaterialsTab topicId={d.topic.id} files={d.materials} onChanged={load} />}

          {tab === "notes" && <Notes topic={d.topic} onSaved={load} />}

          {tab === "cards" && <CardsTab topicId={d.topic.id} hasNotes={!!d.topic.notes} />}

          {tab === "mistakes" && (
            <div className="space-y-4">
              {d.mistakes.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  <LinkButton href={`/mistakes?topic=${d.topic.id}`} variant="primary">
                    <Icon name="redo" /> Прорешать ошибки
                  </LinkButton>
                  <span className="text-sm text-muted">Решённые заново пропадут из списка «Работа над ошибками».</span>
                </div>
              )}
              <Card>
                <h3 className="text-[15px] font-semibold text-bright">Калибровка уверенности</h3>
                <p className="mt-1 mb-4 max-w-[64ch] text-sm text-muted">Как часто ты прав на каждом уровне уверенности. Низкая доля при «Уверен» — самые опасные пробелы.</p>
                <div className="space-y-2.5">
                  {d.calibration.map((c) => {
                    const pct = c.total ? Math.round((c.correct / c.total) * 100) : null;
                    return (
                      <div key={c.level} className="flex items-center gap-3 text-sm">
                        <span className="w-24 shrink-0">{CONF[c.level - 1]}</span>
                        <div className="h-1.5 flex-1 overflow-hidden bg-surface-2">
                          <div className="grow-x h-full bg-accent-strong" style={{ width: `${pct ?? 0}%` }} />
                        </div>
                        <span className="w-28 shrink-0 text-right text-muted tabular-nums">{pct === null ? "нет данных" : `${pct}% из ${c.total}`}</span>
                      </div>
                    );
                  })}
                </div>
                {confidentWrong > 0 && <p className="mt-4 text-sm font-medium text-bad">Уверенных ошибок: {confidentWrong}</p>}
              </Card>
              {byType.size > 0 && (
                <div className="flex flex-wrap gap-2">
                  {[...byType.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([t, n]) => (
                      <span key={t} className="inline-flex items-center gap-1.5 rounded-sm border border-border-strong bg-surface py-0.5 pr-1 pl-2 text-[13px]">
                        <span className="size-2 rounded-full bg-warn" />
                        {t}
                        <Count n={n} />
                      </span>
                    ))}
                </div>
              )}
              {d.mistakes.length === 0 ? (
                <p className="text-muted">Ошибок пока нет. Они появятся здесь вместе с причиной, чтобы было видно, что повторяется.</p>
              ) : (
                <ul className="space-y-2">
                  {d.mistakes.map((m) => (
                    <li key={m.id} className={cx("rounded-sm border border-l-2 border-border bg-surface p-3", m.outcome === "wrong" ? "border-l-bad" : "border-l-warn")}>
                      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span className="text-[13px] text-bright">{nodeTitle(m.nodeKey)}</span>
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
                      <details className="mt-2 text-sm text-muted">
                        <summary className="cursor-pointer hover:text-accent">Показать вопрос</summary>
                        <Markdown text={m.prompt} className="mt-1.5" />
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "parking" && <ParkingList d={d} load={load} onLesson={setParked} />}

          {tab === "sessions" &&
            (d.sessions.length === 0 ? (
              <p className="text-muted">Сессий ещё не было. Начни первый урок кнопкой выше.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border bg-surface">
                {d.sessions.map((s) => (
                  <li key={s.id}>
                    <Link href={`/session/${s.id}`} className="group block px-3 py-2.5 hover:bg-surface-2">
                      <div className="flex items-baseline gap-2.5">
                        <span className="text-bright group-hover:text-accent">{KIND[s.kind]}</span>
                        <span className="text-sm text-muted">{formatDate(s.startedAt)}</span>
                        {!s.endedAt && <Badge tone="accent">не завершена</Badge>}
                        {s.endedAt && <span className="ml-auto text-sm text-muted tabular-nums">{Math.max(1, Math.round((s.endedAt - s.startedAt) / 60000))} мин</span>}
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
              <p className="text-muted">Карта проекта появится после анализа репозитория на первом уроке.</p>
            ))}
        </div>

        <div className="mt-12 border-t border-border pt-3">
          <Button small variant="ghost" onClick={() => setConfirmDelete(true)}>
            Удалить тему
          </Button>
        </div>
      </Page>

      <StartSession
        topicId={d.topic.id}
        kind={start}
        initialGoal={start === "lesson" ? lessonGoal : ""}
        onClose={() => {
          setStart(null);
          setLessonGoal("");
        }}
      />
      <StartSession
        topicId={d.topic.id}
        kind={parked ? "lesson" : null}
        initialGoal={parked ? `Разобрать отложенный вопрос: ${parked.text}` : ""}
        onStarted={async () => {
          if (parked) await api("/api/parking", { method: "PATCH", body: { id: parked.id, done: true } });
        }}
        onClose={() => setParked(null)}
      />
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
