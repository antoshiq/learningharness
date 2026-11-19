"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Calibration, CostBars, GoalRing, Heatmap } from "@/components/Charts";
import { Card, cx, Icon, Loading, Notice, Page, PanelTitle, StatusItem, TopNav, type IconName } from "@/components/ui";
import { api, formatCost, plural } from "@/lib/api";
import type { Stats } from "@/lib/types";
import { FEEDBACK_KINDS, FEEDBACK_LABEL, type StepFeedbackKind } from "@/lib/feedback";

interface FeedbackItem {
  id: number;
  kind: StepFeedbackKind;
  excerpt: string;
  comment: string | null;
  sessionId: number;
  topicTitle: string | null;
  createdAt: number;
}

/** Where lessons explained badly, by the learner's own marks: material for improving the prompts. */
function FeedbackLog() {
  const [log, setLog] = useState<{ counts: Record<StepFeedbackKind, number>; items: FeedbackItem[] } | null>(null);
  useEffect(() => {
    api<typeof log>("/api/feedback")
      .then(setLog)
      .catch(() => setLog(null));
  }, []);
  if (!log || !log.items.length) return null;
  return (
    <Card>
      <h2 className="text-[15px] font-semibold text-bright">Отметки на шагах уроков</h2>
      <p className="mt-1 mb-3 text-sm text-muted">Что ты отмечал в уроках. Репетитор видит отметку сразу, а здесь видно, где объяснения чаще всего не получаются.</p>
      <dl className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {FEEDBACK_KINDS.map((k) => (
          <div key={k} className="flex gap-1.5">
            <dt className="text-muted">{FEEDBACK_LABEL[k]}</dt>
            <dd className="font-medium text-bright tabular-nums">{log.counts[k]}</dd>
          </div>
        ))}
      </dl>
      <ul className="divide-y divide-border">
        {log.items.map((f) => (
          <li key={f.id} className="py-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
              <span className={cx("font-medium", f.kind === "wrong" ? "text-bad" : "text-warn")}>{FEEDBACK_LABEL[f.kind]}</span>
              {f.topicTitle && <span>{f.topicTitle}</span>}
              <span>{new Date(f.createdAt).toLocaleDateString("ru-RU")}</span>
              <Link href={`/session/${f.sessionId}`} className="ml-auto text-accent hover:underline">
                к уроку
              </Link>
            </div>
            <p className="mt-0.5 line-clamp-2 text-text">{f.excerpt}…</p>
            {f.comment && <p className="mt-0.5 text-muted">«{f.comment}»</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Tile({ icon, label, value, sub, tone, i }: { icon: IconName; label: string; value: string; sub?: string; tone?: string; i: number }) {
  return (
    <div style={{ "--i": i } as React.CSSProperties} className="enter -mt-px -ml-px border-t border-l border-border px-3 py-2.5">
      <dt className="flex items-center gap-1.5 text-xs text-muted">
        <Icon name={icon} size={14} />
        {label}
      </dt>
      <dd className={cx("mt-0.5 text-lg leading-tight tabular-nums", tone ?? "text-bright")}>{value}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  );
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const hours = (min: number) => (min < 60 ? `${min} мин` : `${Math.floor(min / 60)} ч ${min % 60 ? `${min % 60} мин` : ""}`.trim());

export default function StatsPage() {
  const [s, setS] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Stats>("/api/stats")
      .then(setS)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const yearAnswers = s?.days.reduce((n, d) => n + d.answers, 0) ?? 0;
  const todayDone = s?.days.find((d) => d.date === s.today)?.answers ?? 0;

  return (
    <>
      <TopNav
        tab="Статистика"
        icon="chart"
        crumbs={[{ label: "Статистика" }]}
        status={
          s && (
            <>
              <StatusItem icon="flame" title="Дней подряд">
                Серия: {s.streak.current}
              </StatusItem>
              <StatusItem title="Расход сегодня">Сегодня: {formatCost(s.cost.today, true)}</StatusItem>
            </>
          )
        }
      />
      <Page>
        <h1 className="mb-5 text-[26px] leading-tight font-normal text-bright">Статистика</h1>
        {error && <Notice tone="bad">{error}</Notice>}
        {!s ? (
          !error && <Loading />
        ) : (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 overflow-hidden rounded-md border border-border bg-surface sm:grid-cols-3 lg:grid-cols-5">
              <Tile
                i={1}
                icon="flame"
                label="Серия"
                value={`${s.streak.current} ${plural(s.streak.current, "день", "дня", "дней")}`}
                sub={todayDone ? "сегодня уже занимался" : s.streak.current ? "позанимайся сегодня, чтобы продлить" : `рекорд: ${s.streak.longest}`}
                tone={s.streak.current ? "text-warn" : undefined}
              />
              <Tile i={2} icon="clock" label="Рекорд серии" value={`${s.streak.longest} ${plural(s.streak.longest, "день", "дня", "дней")}`} sub={`активных дней: ${s.streak.activeDays}`} />
              <Tile i={3} icon="check" label="Ответов" value={String(s.totals.answers)} sub={`верно ${pct(s.totals.correct, s.totals.answers)}`} tone="text-ok" />
              <Tile i={4} icon="redo" label="Без репетитора" value={String(s.totals.drills)} sub="повторение и ошибки" />
              <Tile i={5} icon="book" label="В уроках" value={hours(s.totals.minutes)} sub={`${s.totals.sessions} ${plural(s.totals.sessions, "сессия", "сессии", "сессий")}`} />
            </dl>

            <Card className="flex flex-wrap items-center gap-4">
              <GoalRing done={s.goal.today} target={s.goal.target} size={64} />
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold text-bright">{s.goal.today >= s.goal.target ? "Цель на сегодня выполнена" : "Цель на сегодня"}</h2>
                <p className="text-sm text-muted">
                  {s.goal.today} из {s.goal.target} ответов{s.goal.today < s.goal.target ? `, осталось ${s.goal.target - s.goal.today}` : ""}. За последние 30 дней цель выполнена{" "}
                  {s.goal.metDays} {plural(s.goal.metDays, "раз", "раза", "раз")}.
                </p>
              </div>
              <Link href="/settings#goal" className="text-xs text-accent hover:underline">
                Изменить цель
              </Link>
            </Card>

            <Card>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[15px] font-semibold text-bright">Активность за год</h2>
                <span className="text-xs text-muted">
                  {yearAnswers} {plural(yearAnswers, "ответ", "ответа", "ответов")} за последние 12 месяцев
                </span>
              </div>
              <Heatmap days={s.days} today={s.today} />
            </Card>

            <div className="grid gap-5 lg:grid-cols-2">
              <section className="overflow-hidden rounded-md border border-border bg-surface">
                <PanelTitle>По темам</PanelTitle>
                {s.topics.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-muted">Тем пока нет.</p>
                ) : (
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-xs text-muted">
                        <th className="px-3 py-1.5 font-normal">Тема</th>
                        <th className="px-2 py-1.5 text-right font-normal">Ответов</th>
                        <th className="px-2 py-1.5 text-right font-normal">Верно</th>
                        <th className="px-3 py-1.5 text-right font-normal">Освоено</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border border-t border-border">
                      {s.topics.map((t) => (
                        <tr key={t.id} className="hover:bg-surface-2/50">
                          <td className="max-w-0 truncate px-3 py-1.5">
                            <Link href={`/topics/${t.id}`} className="text-bright hover:text-accent">
                              {t.title}
                            </Link>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{t.answers}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{pct(t.correct, t.answers)}</td>
                          <td className="px-3 py-1.5 text-right text-muted tabular-nums">{t.total ? `${t.mastered} из ${t.total}` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <Card>
                <h2 className="text-[15px] font-semibold text-bright">Калибровка уверенности</h2>
                <p className="mt-1 mb-4 text-sm text-muted">Как часто ты прав на каждом уровне уверенности, по всем темам. Хорошая калибровка: «Уверен» почти всегда верно.</p>
                <Calibration rows={s.calibration} />
              </Card>
            </div>

            <Card>
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[15px] font-semibold text-bright">Расходы на модели</h2>
                <Link href="/settings#limit" className="text-xs text-accent hover:underline">
                  {s.cost.limit !== null ? `Лимит ${formatCost(s.cost.limit, true)} в день` : "Задать дневной лимит"}
                </Link>
              </div>
              <dl className="mb-5 grid grid-cols-3 gap-3 text-sm">
                {(
                  [
                    ["Сегодня", s.cost.today],
                    ["В этом месяце", s.cost.month],
                    ["Всего", s.cost.all],
                  ] as const
                ).map(([label, v]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="text-lg text-bright tabular-nums">{formatCost(v, s.cost.known || label === "Сегодня")}</dd>
                  </div>
                ))}
              </dl>
              <CostBars days={s.cost.days} limit={s.cost.limit} />
              {!s.cost.known && <p className="mt-3 text-xs text-muted">Часть вызовов без известной цены (подписка Claude или свой сервер): они показаны серыми столбиками и в суммы не входят.</p>}
            </Card>

            <FeedbackLog />
          </div>
        )}
      </Page>
    </>
  );
}
