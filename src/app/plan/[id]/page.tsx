"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PlanTasks } from "@/components/PlanTasks";
import { Badge, Button, Card, Cells, cx, Loading, Notice, Page, PanelTitle, Sheet, StatusItem, TopNav } from "@/components/ui";
import { api, daysWord, plural } from "@/lib/api";
import type { PlanView } from "@/server/studyplan";

const PACE = {
  ok: ["ok", "в графике", ""],
  tight: ["warn", "плотный график", "Каждый день нужно осваивать по несколько идей. Если получится, добавь урок вечером."],
  behind: ["bad", "не успеваешь", "Идей больше, чем дней. Сосредоточься на главных темах или сдвинь дату."],
} as const;

const weekday = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });
};

export default function PlanPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [p, setP] = useState<PlanView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    api<PlanView>(`/api/plans/${id}`)
      .then(setP)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const [tone, label, advice] = p ? PACE[p.pace] : PACE.ok;
  const today = p?.days[0];
  const done = today ? today.tasks.filter((t) => t.done).length : 0;

  return (
    <>
      <TopNav
        tab={p?.title ?? "План"}
        icon="calendar"
        crumbs={[{ label: "Подготовка к дате", href: "/plan" }, { label: p?.title ?? "…" }]}
        status={p && <StatusItem icon="calendar">{p.daysLeft < 0 ? "дата прошла" : `экзамен ${daysWord(p.daysLeft)}`}</StatusItem>}
      />
      <Page narrow>
        {error && <Notice tone="bad">{error}</Notice>}
        {!p ? (
          !error && <Loading />
        ) : (
          <div className="space-y-5">
            <div>
              <h1 className="text-[26px] leading-tight font-normal text-bright">{p.title}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted">
                <span>{weekday(p.examDay)}</span>
                <span>·</span>
                <span className={cx(p.daysLeft <= 3 && p.daysLeft >= 0 && "font-medium text-warn")}>
                  {p.daysLeft < 0 ? "дата прошла" : p.daysLeft === 0 ? "сегодня" : `осталось ${p.daysLeft} ${plural(p.daysLeft, "день", "дня", "дней")}`}
                </span>
                {p.daysLeft >= 0 && <Badge tone={tone}>{label}</Badge>}
              </div>
            </div>

            <dl className="grid grid-cols-3 overflow-hidden rounded-md border border-border bg-surface">
              {(
                [
                  ["Освоено", p.progress.total ? `${p.progress.mastered} из ${p.progress.total}` : "—"],
                  ["Темп", p.perDay ? `${p.perDay} ${plural(p.perDay, "идея", "идеи", "идей")} в день` : "всё изучено"],
                  ["Сегодня", today ? `${done} из ${today.tasks.length}` : "—"],
                ] as const
              ).map(([k, v], i) => (
                <div key={k} style={{ "--i": i + 1 } as React.CSSProperties} className={cx("enter px-3 py-2.5", i > 0 && "border-l border-border")}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="mt-0.5 text-[15px] text-bright tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            {p.progress.total > 0 && <Cells total={p.progress.total} mastered={p.progress.mastered} />}
            {advice && p.daysLeft >= 0 && <Notice tone={tone === "bad" ? "bad" : "warn"}>{advice}</Notice>}
            {p.topics.some((t) => !t.hasPlan) && (
              <Notice tone="neutral">
                У тем без плана сначала идёт первый урок с диагностикой: после него репетитор построит план и расписание уточнится.
              </Notice>
            )}

            {today && p.daysLeft >= 0 && (
              <Card>
                <h2 className="mb-2 text-[15px] font-semibold text-bright">План на сегодня</h2>
                <PlanTasks tasks={today.tasks} today />
              </Card>
            )}

            {p.days.length > 1 && (
              <section className="overflow-hidden rounded-md border border-border bg-surface">
                <PanelTitle>Дальше</PanelTitle>
                <ol className="divide-y divide-border">
                  {p.days.slice(1).map((d) => (
                    <li key={d.date} className="px-3 py-2">
                      <div className="mb-1 text-xs font-medium text-muted capitalize">{weekday(d.date)}</div>
                      <PlanTasks tasks={d.tasks} />
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section className="overflow-hidden rounded-md border border-border bg-surface">
              <PanelTitle>Темы</PanelTitle>
              <ul className="divide-y divide-border">
                {p.topics.map((t) => (
                  <li key={t.id}>
                    <a href={`/topics/${t.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-surface-2/60">
                      <span className="min-w-0 flex-1 truncate text-bright">{t.title}</span>
                      <span className="text-xs text-muted tabular-nums">{t.hasPlan ? `${t.mastered} из ${t.total}` : "нет плана"}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>

            <div className="border-t border-border pt-3">
              <Button small variant="ghost" onClick={() => setConfirm(true)}>
                Удалить план
              </Button>
            </div>
            <Sheet open={confirm} onClose={() => setConfirm(false)} title="Удалить план?">
              <div className="space-y-3">
                <p className="text-sm text-muted">Удалится только расписание. Темы, прогресс и повторение останутся.</p>
                <Button
                  variant="danger"
                  className="w-full"
                  onClick={async () => {
                    await api(`/api/plans/${p.id}`, { method: "DELETE" });
                    router.push("/plan");
                  }}
                >
                  Удалить
                </Button>
              </div>
            </Sheet>
          </div>
        )}
      </Page>
    </>
  );
}
