"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { GoalRing } from "@/components/Charts";
import { PlanTasks } from "@/components/PlanTasks";
import { FilePicker, type PickedFile } from "@/components/FilePicker";
import { StartSession } from "@/components/StartSession";
import { Button, Card, Cells, Count, cx, Dots, Field, Icon, inputClass, LinkButton, Loading, Notice, PanelTitle, Segmented, Sheet, StatusItem, TopNav } from "@/components/ui";
import { NEW_TOPIC_EVENT, notifyChanged, useWorkbench } from "@/components/workbench-context";
import { api, daysWord, formatAgo, formatCost, formatTokens, plural, streamPost } from "@/lib/api";
import type { Stats } from "@/lib/types";
import type { PlanView } from "@/server/studyplan";
import type { SemesterBrief } from "@/server/semester";
import type { TopicCard } from "@/server/sessions";

interface Scan {
  root: string;
  files: number;
  estTokens: number;
  byExt: { ext: string; files: number }[];
  skippedSecrets: number;
  skippedLarge: number;
  truncated: boolean;
  model: string;
  fullReadCost: number | null;
}

function NewTopic({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<"topic" | "repo">("topic");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [skipVision, setSkipVision] = useState(false);
  const [scan, setScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus(null);
      setBusy(false);
    }
  };

  const create = () =>
    guard(async () => {
      const uploads = kind === "topic" ? files.map(({ name, content, base64 }) => ({ name, content, base64 })) : [];
      if (uploads.length) {
        setStatus("Обрабатываю файлы…");
        let createdId: number | null = null;
        await streamPost("/api/topics", { kind, title, goal, repoPath, uploads, skipVision, stream: true }, (e) => {
          if (e.type === "status") setStatus(e.text);
          else if (e.type === "saved") createdId = e.id;
          else if (e.type === "error") throw new Error(e.message);
        });
        if (createdId !== null) router.push(`/topics/${createdId}`);
        return;
      }
      const { id } = await api<{ id: number }>("/api/topics", { body: { kind, title, goal, repoPath, uploads } });
      router.push(`/topics/${id}`);
    });

  return (
    <Sheet open={open} onClose={onClose} title="Что будем изучать?">
      <div className="space-y-4">
        <Segmented
          label="Что изучать"
          value={kind}
          onChange={setKind}
          options={
            [
              ["topic", "Тема"],
              ["repo", "Мой репозиторий"],
            ] as const
          }
        />

        {kind === "topic" ? (
          <>
            <Field label="Тема">
              <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Рекурсия в Python, производные, SQL JOIN" />
            </Field>
            <Field label="Чего хочешь достичь" hint="Что хочешь уметь в итоге и что уже знаешь. Чем конкретнее, тем точнее план.">
              <textarea className={cx(inputClass, "min-h-24 resize-y")} value={goal} onChange={(e) => setGoal(e.target.value)} />
            </Field>
            <div>
              <div className="mb-1 text-[13px] text-bright">Материалы (необязательно)</div>
              <FilePicker files={files} onChange={setFiles} skipVision={skipVision} onSkipVision={setSkipVision} />
              <p className="mt-1.5 text-xs text-muted">
                {files.length
                  ? "Репетитор будет учить по этим файлам: план, объяснения и вопросы — по их содержанию. Тему можно не называть, возьмётся имя файла."
                  : "Например, лекции к экзамену или глава учебника: репетитор построит план и вопросы по ним. Секреты (.env, ключи) не принимаются."}
              </p>
            </div>
          </>
        ) : (
          <>
            <Field label="Папка проекта на этом компьютере или ссылка на GitHub">
              <input
                className={cx(inputClass, "font-mono text-[15px]")}
                value={repoPath}
                onChange={(e) => {
                  setRepoPath(e.target.value);
                  setScan(null);
                }}
                placeholder="~/projects/my-project или https://github.com/owner/repo"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </Field>
            <Field label="Что хочешь понять">
              <textarea
                className={cx(inputClass, "min-h-20 resize-y")}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Как устроен проект целиком, чтобы вносить изменения самому"
              />
            </Field>
            <p className="text-sm text-muted">
              Папка читается только на чтение. Зависимости, сборки, бинарные файлы и файлы с секретами (.env, ключи) пропускаются и модели не отправляются.
            </p>
            {scan && (
              <div className="space-y-1.5 rounded-md border border-border bg-surface-2 px-3.5 py-3 text-sm">
                <div>
                  Доступно для чтения: <b>{scan.files}</b> файлов, около <b>{formatTokens(scan.estTokens)}</b> токенов.
                </div>
                <div className="text-muted">
                  {scan.byExt.map((e) => `.${e.ext} — ${e.files}`).join(", ")}
                  {scan.skippedSecrets ? ` · пропущено секретов: ${scan.skippedSecrets}` : ""}
                  {scan.skippedLarge ? ` · слишком больших: ${scan.skippedLarge}` : ""}
                </div>
                <div>
                  {scan.fullReadCost !== null
                    ? `Если бы модель ${scan.model} прочла всё один раз — около ${formatCost(scan.fullReadCost, true)} на вход. Обычно она читает малую часть, но прочитанное остаётся в контексте урока и оплачивается повторно на каждом шаге (со скидкой за кэш).`
                    : `Цена для модели ${scan.model} неизвестна; ориентируйся на число токенов.`}
                </div>
                {scan.truncated && <div className="text-warn">Файлов очень много: учтены первые 6000.</div>}
              </div>
            )}
          </>
        )}

        {busy && status && (
          <div className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
            <Dots /> {status}
          </div>
        )}
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="flex gap-2">
          {kind === "repo" && !scan && (
            <Button
              className="flex-1"
              variant="primary"
              disabled={busy || !repoPath.trim()}
              onClick={() => guard(async () => setScan(await api<Scan>("/api/repo/scan", { body: { path: repoPath } })))}
            >
              {busy ? (/github\.com/i.test(repoPath) ? "Скачиваю с GitHub…" : "Сканирую…") : "Оценить объём"}
            </Button>
          )}
          {(kind === "topic" || scan) && (
            <Button className="flex-1" variant="primary" disabled={busy || (kind === "topic" && !title.trim() && !files.length)} onClick={create}>
              {busy && files.some((f) => f.base64) ? "Читаю файлы…" : "Создать тему"}
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

export default function Home() {
  const [topics, setTopics] = useState<TopicCard[] | null>(null);
  const [modelProblem, setModelProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [start, setStart] = useState<{ topicId: number; kind: "lesson" | "review" } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [semesters, setSemesters] = useState<SemesterBrief[]>([]);

  const load = useCallback(async () => {
    try {
      const d = await api<{ topics: TopicCard[]; modelProblem: string | null }>("/api/topics");
      setTopics(d.topics);
      setModelProblem(d.modelProblem);
      notifyChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    load();
    api<Stats>("/api/stats")
      .then(setStats)
      .catch(() => {});
    api<{ plans: PlanView[] }>("/api/plans")
      .then((r) => setPlans(r.plans.filter((p) => p.daysLeft >= 0)))
      .catch(() => {});
    api<{ semesters: SemesterBrief[] }>("/api/semesters/active")
      .then((r) => setSemesters(r.semesters))
      .catch(() => {});
  }, [load]);

  const due = (topics ?? []).filter((t) => t.due > 0);
  const dueTotal = due.reduce((s, t) => s + t.due, 0);
  const all = topics ?? [];
  const ideasAll = all.reduce((s, t) => s + t.total, 0);
  const masteredAll = all.reduce((s, t) => s + t.mastered, 0);
  const learningAll = all.reduce((s, t) => s + t.learning, 0);
  const openLessons = all.filter((t) => t.openSessionId);
  const { model, mock, openPalette } = useWorkbench();

  // The command palette can ask for the new-topic form: by event on this page, by ?new=1 from another.
  useEffect(() => {
    const open = () => setCreating(true);
    if (new URLSearchParams(window.location.search).has("new")) {
      open();
      window.history.replaceState(null, "", "/");
    }
    window.addEventListener(NEW_TOPIC_EVENT, open);
    return () => window.removeEventListener(NEW_TOPIC_EVENT, open);
  }, []);

  return (
    <>
      <TopNav
        tab="Темы"
        icon="files"
        status={
          topics && (
            <>
              <StatusItem icon="files">
                {topics.length} {plural(topics.length, "тема", "темы", "тем")}
              </StatusItem>
              <StatusItem icon="check" title="Освоено идей по всем темам">
                {masteredAll} из {ideasAll}
              </StatusItem>
              {dueTotal > 0 && <StatusItem icon="clock">Повторить: {dueTotal}</StatusItem>}
              {modelProblem && <StatusItem icon="info">Модель не настроена</StatusItem>}
            </>
          )
        }
      />
      <main className="enter mx-auto w-full max-w-6xl px-4 pt-5 pb-16 sm:px-6">
        {(error || modelProblem) && (
          <div className="mb-5 space-y-2">
            {error && <Notice tone="bad">{error}</Notice>}
            {modelProblem && (
              <Notice tone="warn">
                {modelProblem}. Без этого уроки не запустятся.{" "}
                <Link href="/settings" className="text-accent hover:underline">
                  Открыть настройки
                </Link>
              </Notice>
            )}
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] leading-tight font-normal text-bright">Репетитор</h1>
            <p className="text-[13px] text-muted">Программирование и математика, шаг за шагом</p>
          </div>
          <div className="flex gap-2">
            <LinkButton href="/brief">
              <Icon name="compass" /> Быстрый экскурс
            </LinkButton>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> Новая тема
            </Button>
          </div>
        </div>

        {topics === null ? (
          !error && <Loading />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-w-0 space-y-4">
              {/* Totals across all topics */}
              <dl className="grid grid-cols-2 overflow-hidden rounded-md border border-border bg-surface sm:grid-cols-4">
                {(
                  [
                    ["Освоено идей", `${masteredAll} из ${ideasAll}`, "text-ok"],
                    ["В процессе", String(learningAll), "text-warn"],
                    ["Пора повторить", String(dueTotal), dueTotal ? "text-accent" : "text-bright"],
                    ["Открытых уроков", String(openLessons.length), "text-bright"],
                  ] as const
                ).map(([label, value, tone], i) => (
                  <div key={label} style={{ "--i": i + 1 } as React.CSSProperties} className={cx("enter border-border px-3 py-2.5", i % 2 === 1 && "border-l", i >= 2 && "border-t sm:border-t-0", i === 2 && "sm:border-l")}>
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className={cx("mt-0.5 text-lg leading-tight tabular-nums", tone)}>{value}</dd>
                  </div>
                ))}
              </dl>

              {semesters.map((s) => (
                <section key={`sem-${s.id}`} className="enter overflow-hidden rounded-md border border-border bg-surface">
                  <PanelTitle
                    right={
                      <Link href={`/semester/${s.id}`} className="text-xs text-accent hover:underline">
                        {s.week >= 1 && s.week <= s.weeks ? `неделя ${s.week} из ${s.weeks}` : "семестр"} · освоено {s.progress}%{s.pace === "behind" ? " · отстаёшь" : ""}
                      </Link>
                    }
                  >
                    <span className="flex items-center gap-1.5">
                      <Icon name="cap" className="text-accent" /> {s.title}: сегодня
                    </span>
                  </PanelTitle>
                  <ul className="divide-y divide-border">
                    {s.today.slice(0, 4).map((t) => (
                      <li key={t.kind + t.title}>
                        <Link href={t.href ?? `/semester/${s.id}`} className="group flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-surface-2/60">
                          <Icon name={t.kind === "review" ? "clock" : t.kind === "learn" ? "play" : t.kind.includes("homework") ? "note" : "check"} className="text-muted" />
                          <span className="min-w-0 flex-1 truncate group-hover:text-accent">{t.title}</span>
                        </Link>
                      </li>
                    ))}
                    {!s.today.length && <li className="px-3 py-1.5 text-sm text-muted">На сегодня всё сделано.</li>}
                  </ul>
                </section>
              ))}

              {plans.map((p) => (
                <section key={p.id} className="enter overflow-hidden rounded-md border border-border bg-surface">
                  <PanelTitle
                    right={
                      <Link href={`/plan/${p.id}`} className="text-xs text-accent hover:underline">
                        {p.title}: {daysWord(p.daysLeft)}
                      </Link>
                    }
                  >
                    План на сегодня
                  </PanelTitle>
                  <div className="px-1 py-1.5">{p.days[0] && <PlanTasks tasks={p.days[0].tasks} today />}</div>
                </section>
              ))}

              {dueTotal > 0 && (
                <section className="overflow-hidden rounded-md border border-border bg-surface">
                  <PanelTitle
                    right={
                      <LinkButton small href="/review" variant="primary">
                        <Icon name="play" /> Повторить всё
                      </LinkButton>
                    }
                  >
                    Сначала повторение
                  </PanelTitle>
                  <p className="border-b border-border px-3 py-1.5 text-xs text-muted">«Повторить всё» задаёт вопросы из прошлых уроков без репетитора, по всем темам сразу. Кнопка в строке — повторение с репетитором.</p>
                  <ul className="divide-y divide-border">
                    {due.map((t) => (
                      <li key={t.id} className="flex items-center gap-3 px-3 py-1.5">
                        <Icon name="clock" className="text-accent" />
                        <span className="min-w-0 flex-1 truncate text-bright">{t.title}</span>
                        <span className="shrink-0 text-xs text-muted">
                          {t.due} {plural(t.due, "идея", "идеи", "идей")}
                        </span>
                        <Button small variant="ghost" onClick={() => setStart({ topicId: t.id, kind: "review" })}>
                          С репетитором
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {topics.length === 0 ? (
                <Card className="sm:p-8">
                  <h2 className="text-lg text-bright">Тем пока нет</h2>
                  <p className="mt-1.5 max-w-[60ch] text-muted">
                    Назови тему или укажи свой репозиторий. Репетитор сначала выяснит, что ты уже знаешь, потом построит план и поведёт по нему шаг за шагом.
                  </p>
                  <Button variant="primary" className="mt-4" onClick={() => setCreating(true)}>
                    Начать первую тему
                  </Button>
                </Card>
              ) : (
                <section className="overflow-hidden rounded-md border border-border bg-surface">
                  <PanelTitle right={<span className="text-xs text-muted tabular-nums">{topics.length}</span>}>Темы</PanelTitle>
                  <div className="hidden h-7 items-center gap-4 border-b border-border px-3 text-xs text-muted md:flex">
                    <span className="flex-1">Название</span>
                    <span className="w-44">Прогресс</span>
                    <span className="w-24">Активность</span>
                    <span className="w-[216px]" />
                  </div>
                  <ul className="divide-y divide-border">
                    {topics.map((t, i) => (
                      <li key={t.id} style={{ "--i": i + 3 } as React.CSSProperties} className="enter flex flex-col gap-2.5 px-3 py-2.5 transition-colors hover:bg-surface-2/50 md:flex-row md:items-center md:gap-4 md:py-2">
                        <Link href={`/topics/${t.id}`} className="group flex min-w-0 flex-1 items-start gap-2">
                          <Icon name={t.kind === "repo" ? "repo" : "file"} className="mt-[3px] text-accent" />
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-bright group-hover:text-accent">{t.title}</span>
                              {t.due > 0 && <Count n={t.due} active />}
                            </span>
                            <span className="block truncate text-xs text-muted">{t.kind === "repo" ? t.repoPath : t.goal || "Без описания цели"}</span>
                          </span>
                        </Link>
                        <div className="shrink-0 md:w-44">
                          {t.total > 0 ? (
                            <>
                              <Cells total={t.total} mastered={t.mastered} learning={t.learning} />
                              <div className="mt-1 text-xs text-muted tabular-nums">
                                {t.mastered} из {t.total}
                                {t.learning ? `, в процессе ${t.learning}` : ""}
                              </div>
                            </>
                          ) : (
                            <span className="text-xs text-muted">План появится на первом уроке</span>
                          )}
                        </div>
                        <div className="hidden w-24 shrink-0 text-xs text-muted md:block">{formatAgo(t.updatedAt)}</div>
                        <div className="flex shrink-0 gap-2 md:w-[216px] md:justify-end">
                          {t.openSessionId ? (
                            <LinkButton small href={`/session/${t.openSessionId}`} variant="primary" className="flex-1 md:flex-none">
                              <Icon name="play" /> Продолжить урок
                            </LinkButton>
                          ) : (
                            <Button small variant="primary" className="flex-1 md:flex-none" onClick={() => setStart({ topicId: t.id, kind: "lesson" })}>
                              <Icon name="play" /> {t.total ? "Новый урок" : "Начать"}
                            </Button>
                          )}
                          <LinkButton small href={`/topics/${t.id}`}>
                            Обзор
                          </LinkButton>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <aside className="space-y-4">
              {stats && (
                <Link href="/stats" className="group block overflow-hidden rounded-md border border-border bg-surface hover:border-border-strong">
                  <PanelTitle right={<span className="text-xs text-accent group-hover:underline">Статистика</span>}>Активность</PanelTitle>
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <GoalRing done={stats.goal.today} target={stats.goal.target} size={48} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-bright">
                        {stats.goal.today >= stats.goal.target ? "Цель на сегодня выполнена" : `Цель: ${stats.goal.today} из ${stats.goal.target} ответов`}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted tabular-nums">
                        <Icon name="flame" size={13} className={stats.streak.current ? "text-warn" : ""} />
                        {stats.streak.current} {plural(stats.streak.current, "день", "дня", "дней")} подряд
                      </div>
                      <div className="text-xs text-muted">
                        сегодня {stats.days.find((d) => d.date === stats.today)?.answers ?? 0} {plural(stats.days.find((d) => d.date === stats.today)?.answers ?? 0, "ответ", "ответа", "ответов")}
                        {stats.streak.longest > stats.streak.current ? ` · рекорд ${stats.streak.longest}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-[3px] px-3 pb-3" aria-hidden>
                    {Array.from({ length: 21 }, (_, i) => {
                      const d = new Date();
                      d.setDate(d.getDate() - 20 + i);
                      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                      const n = stats.days.find((x) => x.date === key)?.answers ?? 0;
                      return <span key={i} style={{ "--i": i } as React.CSSProperties} className={cx("cell-in h-2.5 flex-1 rounded-[2px]", `heat-${n === 0 ? 0 : n < 3 ? 1 : n < 6 ? 2 : n < 12 ? 3 : 4}`)} />;
                    })}
                  </div>
                </Link>
              )}

              <section className="overflow-hidden rounded-md border border-border bg-surface">
                <PanelTitle>Быстрый старт</PanelTitle>
                <ul className="py-1 text-[13px]">
                  {openLessons.map((t) => (
                    <li key={t.id}>
                      <Link href={`/session/${t.openSessionId}`} className="flex min-h-8 items-center gap-2 px-3 text-accent hover:bg-surface-2 sm:min-h-[26px]">
                        <Icon name="play" />
                        <span className="truncate">Продолжить: {t.title}</span>
                      </Link>
                    </li>
                  ))}
                  <li>
                    <button onClick={() => setCreating(true)} className="flex min-h-8 w-full items-center gap-2 px-3 text-left text-accent hover:bg-surface-2 sm:min-h-[26px]">
                      <Icon name="plus" /> Новая тема
                    </button>
                  </li>
                  {dueTotal > 0 && (
                    <li>
                      <Link href="/review" className="flex min-h-8 items-center gap-2 px-3 text-accent hover:bg-surface-2 sm:min-h-[26px]">
                        <Icon name="clock" /> Повторение на сегодня: {dueTotal}
                      </Link>
                    </li>
                  )}
                  <li>
                    <Link href="/plan" className="flex min-h-8 items-center gap-2 px-3 text-accent hover:bg-surface-2 sm:min-h-[26px]">
                      <Icon name="calendar" /> Подготовка к дате
                    </Link>
                  </li>
                  <li>
                    <Link href="/sandbox" className="flex min-h-8 items-center gap-2 px-3 text-accent hover:bg-surface-2 sm:min-h-[26px]">
                      <Icon name="play" /> Песочница кода
                    </Link>
                  </li>
                  <li>
                    <Link href="/brief" className="flex min-h-8 items-center gap-2 px-3 text-accent hover:bg-surface-2 sm:min-h-[26px]">
                      <Icon name="compass" /> Быстрый экскурс
                    </Link>
                  </li>
                  <li>
                    <Link href="/mistakes" className="flex min-h-8 items-center gap-2 px-3 text-accent hover:bg-surface-2 sm:min-h-[26px]">
                      <Icon name="target" /> Работа над ошибками
                    </Link>
                  </li>
                  <li>
                    <button onClick={openPalette} className="flex min-h-8 w-full items-center gap-2 px-3 text-left text-accent hover:bg-surface-2 sm:min-h-[26px]">
                      <Icon name="search" /> Найти тему или команду
                    </button>
                  </li>
                  <li>
                    <Link href="/settings" className="flex min-h-8 items-center gap-2 px-3 text-accent hover:bg-surface-2 sm:min-h-[26px]">
                      <Icon name="gear" /> Ключи и модели
                    </Link>
                  </li>
                </ul>
              </section>

              <section className="hidden overflow-hidden rounded-md border border-border bg-surface sm:block minimal:sm:hidden">
                <PanelTitle>Клавиши</PanelTitle>
                <dl className="space-y-1.5 px-3 py-2.5 text-[13px]">
                  {(
                    [
                      ["Поиск и команды", "Ctrl+K"],
                      ["Проводник", "Ctrl+B"],
                      ["Выбрать вариант", "1–9"],
                      ["Ответить", "Ctrl+Enter"],
                      ["Подсказка", "H"],
                      ["Дальше в повторении", "Enter"],
                      ["Отправить сообщение", "Enter"],
                      ["Закрыть окно", "Esc"],
                    ] as const
                  ).map(([what, keys]) => (
                    <div key={what} className="flex items-center justify-between gap-3">
                      <dt className="text-muted">{what}</dt>
                      <dd>
                        <kbd className="rounded-sm border border-border-strong bg-surface-2 px-1.5 py-px font-sans text-[11px] text-text">{keys}</kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="overflow-hidden rounded-md border border-border bg-surface minimal:hidden">
                <PanelTitle>Модель</PanelTitle>
                <div className="px-3 py-2.5 text-[13px]">
                  <div className="truncate font-mono text-xs text-bright">{mock ? "тестовая заглушка" : (model ?? "не выбрана")}</div>
                  <p className="mt-1 text-xs text-muted">Ведёт уроки, практику и повторение. Сменить можно в настройках.</p>
                </div>
              </section>
            </aside>
          </div>
        )}
      </main>
      <NewTopic open={creating} onClose={() => setCreating(false)} />
      <StartSession topicId={start?.topicId ?? 0} kind={start?.kind ?? null} onClose={() => setStart(null)} />
    </>
  );
}
