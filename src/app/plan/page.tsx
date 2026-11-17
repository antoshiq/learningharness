"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Cells, cx, Field, Icon, inputClass, Loading, Notice, Page, PanelTitle, TopNav } from "@/components/ui";
import { useWorkbench } from "@/components/workbench-context";
import { api, daysWord } from "@/lib/api";
import type { PlanView } from "@/server/studyplan";

const PACE = { ok: ["ok", "в графике"], tight: ["warn", "плотный график"], behind: ["bad", "не успеваешь"] } as const;

export default function PlansPage() {
  const router = useRouter();
  const { topics } = useWorkbench();
  const [plans, setPlans] = useState<PlanView[] | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [chosen, setChosen] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ plans: PlanView[] }>("/api/plans")
      .then((r) => setPlans(r.plans))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    const t = Number(new URLSearchParams(window.location.search).get("topic"));
    if (t) setChosen([t]);
  }, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: number }>("/api/plans", { body: { title, examDate: date, topicIds: chosen } });
      router.push(`/plan/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const today = new Date();
  const min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <>
      <TopNav tab="Подготовка к дате" icon="calendar" crumbs={[{ label: "Подготовка к дате" }]} />
      <Page narrow>
        <h1 className="text-[26px] leading-tight font-normal text-bright">Подготовка к дате</h1>
        <p className="mt-1 mb-6 max-w-[64ch] text-muted">
          Укажи дату экзамена и темы. План разложит оставшиеся идеи по дням, добавит ежедневное повторение и пробные экзамены. Если отстанешь или обгонишь, план пересчитается сам.
        </p>
        {error && (
          <div className="mb-4">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}

        {plans === null ? (
          !error && <Loading />
        ) : (
          plans.length > 0 && (
            <section className="mb-6 overflow-hidden rounded-md border border-border bg-surface">
              <PanelTitle>Планы</PanelTitle>
              <ul className="divide-y divide-border">
                {plans.map((p, i) => {
                  const [tone, label] = PACE[p.pace];
                  return (
                    <li key={p.id} style={{ "--i": i } as React.CSSProperties} className="enter">
                      <Link href={`/plan/${p.id}`} className="group block px-3 py-2.5 hover:bg-surface-2/60">
                        <div className="flex flex-wrap items-center gap-2">
                          <Icon name="calendar" className="text-accent" />
                          <span className="min-w-0 flex-1 truncate text-bright group-hover:text-accent">{p.title}</span>
                          <span className="text-xs text-muted">{p.daysLeft < 0 ? "прошёл" : daysWord(p.daysLeft)}</span>
                          {p.daysLeft >= 0 && <Badge tone={tone}>{label}</Badge>}
                        </div>
                        {p.progress.total > 0 && (
                          <div className="mt-1.5 pl-6">
                            <Cells total={p.progress.total} mastered={p.progress.mastered} />
                          </div>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )
        )}

        <Card className="space-y-4">
          <h2 className="text-[15px] font-semibold text-bright">Новый план</h2>
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <Field label="Что сдаёшь">
              <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Экзамен по матанализу" />
            </Field>
            <Field label="Дата">
              <input type="date" className={inputClass} value={date} min={min} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <div>
            <div className="mb-1.5 text-[13px] text-bright">Темы</div>
            {!topics?.length ? (
              <p className="text-sm text-muted">
                Тем пока нет.{" "}
                <Link href="/?new=1" className="text-accent hover:underline">
                  Создай тему
                </Link>
                , можно сразу с материалами.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {topics.map((t) => {
                  const on = chosen.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => setChosen((c) => (on ? c.filter((x) => x !== t.id) : [...c, t.id]))}
                      aria-pressed={on}
                      className={cx("inline-flex h-8 max-w-full items-center gap-1.5 rounded-sm border px-2.5 text-[13px]", on ? "border-accent bg-accent-soft text-bright" : "border-border-strong text-muted hover:text-bright")}
                    >
                      {on && <Icon name="check" size={13} />}
                      <span className="truncate">{t.title}</span>
                      {t.total > 0 && <span className="text-xs text-muted">{t.mastered}/{t.total}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <Button variant="primary" onClick={create} disabled={busy || !date || !chosen.length}>
            <Icon name="calendar" /> {busy ? "Составляю…" : "Составить план"}
          </Button>
        </Card>
      </Page>
    </>
  );
}
