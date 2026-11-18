"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, cx, Icon, Loading, Notice, Page, Segmented, TopNav } from "@/components/ui";
import { api, plural } from "@/lib/api";
import type { IdeaLevel, MapIdea, MapModule } from "@/server/semester/modules";

const LEVEL: Record<IdeaLevel, { label: string; cell: string; hint: string }> = {
  0: { label: "новая", cell: "bg-surface-2 ring-1 ring-border-strong ring-inset", hint: "ещё не изучалась" },
  1: { label: "изучена", cell: "cell-learning", hint: "изучается, проверка ещё не пройдена" },
  2: { label: "проверена", cell: "bg-ok/45", hint: "проверки пройдены" },
  3: { label: "объяснена", cell: "bg-accent-strong/80", hint: "проверена и объяснена своими словами" },
  4: { label: "знаю надёжно", cell: "bg-ok", hint: "объяснена и держится в памяти три недели и дольше" },
};

type Filter = "all" | "weak" | "due";

/** Weak: answered wrongly and not yet explained, or started and not yet passing the checks. */
const weak = (i: MapIdea) => (i.mistakes > 0 && i.level < 3) || i.level === 1;
const hasMistakes = (i: MapIdea) => i.mistakes > 0 && i.level < 3;

function Idea({ i, topicId }: { i: MapIdea; topicId: number | null }) {
  const href = !topicId ? "#" : i.level >= 2 && i.level < 3 ? `/explain?topic=${topicId}` : `/topics/${topicId}`;
  const tip = `${i.title}: ${LEVEL[i.level].hint}${i.mistakes ? `; ошибок: ${i.mistakes}` : ""}${i.due ? "; пора повторить" : ""}`;
  return (
    <Link href={href} title={tip} className="group flex items-center gap-2 rounded-sm px-1.5 py-1 text-[13px] hover:bg-surface-2">
      <span className={cx("size-3 shrink-0 rounded-[2px]", LEVEL[i.level].cell)} />
      <span className="min-w-0 flex-1 truncate group-hover:text-accent">{i.title}</span>
      {hasMistakes(i) && <span className="size-1.5 shrink-0 rounded-full bg-bad" aria-label="есть ошибки" />}
      {i.due && <Icon name="clock" size={12} className="shrink-0 text-accent" />}
    </Link>
  );
}

function ModuleCard({ m, filter }: { m: MapModule; filter: Filter }) {
  const ideas = m.ideas.filter((i) => (filter === "weak" ? weak(i) : filter === "due" ? i.due : true));
  if (filter !== "all" && !ideas.length) return null;
  const counts = [0, 1, 2, 3, 4].map((l) => m.ideas.filter((i) => i.level === l).length);
  return (
    <section className={cx("flex flex-col overflow-hidden rounded-md border bg-surface", m.status === "open" ? "border-accent" : "border-border", m.status === "locked" && "opacity-70")}>
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
        <span className="text-xs text-muted tabular-nums">{m.kind === "prereq" ? "0" : m.idx}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-bright" title={m.title}>
          {m.title}
        </span>
        {m.status === "passed" && <Badge tone="ok">сдан</Badge>}
        {m.status === "open" && <Badge tone="accent">сейчас</Badge>}
      </div>
      {m.ideas.length > 0 && (
        <div className="flex h-1.5" aria-hidden>
          {[4, 3, 2, 1, 0].map((l) => counts[l] > 0 && <div key={l} className={cx(LEVEL[l as IdeaLevel].cell, "ring-0")} style={{ width: `${(counts[l] / m.ideas.length) * 100}%` }} />)}
        </div>
      )}
      <div className="flex-1 p-1">
        {m.ideas.length ? (
          ideas.map((i) => <Idea key={i.key} i={i} topicId={m.topicId} />)
        ) : (
          <ul className="space-y-0.5 px-1.5 py-1 text-[13px] text-muted">
            {m.sections.map((s) => (
              <li key={s} className="truncate">
                · {s}
              </li>
            ))}
            <li className="pt-1 text-xs">Идеи появятся, когда модуль подготовится.</li>
          </ul>
        )}
      </div>
    </section>
  );
}

/** The whole course at a glance: every idea of every module coloured by how well it is known. */
export default function CourseMapPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ title: string; modules: MapModule[]; totals: number[] } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ title: string; modules: MapModule[]; totals: number[] }>(`/api/semesters/${id}/map`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const total = data?.totals.reduce((a, b) => a + b, 0) ?? 0;
  const parts = data ? [...new Set(data.modules.map((m) => m.part))] : [];
  const weakCount = data?.modules.flatMap((m) => m.ideas).filter(weak).length ?? 0;
  const dueCount = data?.modules.flatMap((m) => m.ideas).filter((i) => i.due).length ?? 0;

  return (
    <>
      <TopNav tab="Карта курса" icon="cap" crumbs={[{ label: "Семестр", href: "/semester" }, { label: data?.title ?? "…", href: `/semester/${id}` }, { label: "Карта курса" }]} />
      <Page>
        <h1 className="text-[26px] leading-tight font-normal text-bright">Карта курса</h1>
        <p className="mt-1 mb-5 max-w-[70ch] text-muted">Каждая идея курса — квадрат её цвета. Красная точка — были ошибки, часы — пора повторить. Нажми на идею, чтобы учить её или объяснить своими словами.</p>
        {error && <Notice tone="bad">{error}</Notice>}
        {!data ? (
          !error && <Loading />
        ) : (
          <div className="space-y-5">
            <div className="space-y-2 rounded-md border border-border bg-surface p-3">
              {total > 0 && (
                <div className="flex h-3 overflow-hidden rounded-sm" role="img" aria-label="Идеи по ступеням">
                  {[4, 3, 2, 1, 0].map((l) => data.totals[l] > 0 && <div key={l} className={cx(LEVEL[l as IdeaLevel].cell, "ring-0")} style={{ width: `${(data.totals[l] / total) * 100}%` }} />)}
                </div>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                {([4, 3, 2, 1, 0] as IdeaLevel[]).map((l) => (
                  <span key={l} className="flex items-center gap-1.5" title={LEVEL[l].hint}>
                    <span className={cx("size-3 rounded-[2px]", LEVEL[l].cell)} />
                    {LEVEL[l].label}: <span className="tabular-nums">{data.totals[l]}</span>
                  </span>
                ))}
                <span className="text-muted">
                  · всего {total} {plural(total, "идея", "идеи", "идей")}
                </span>
              </div>
              <div className="max-w-md pt-1">
                <Segmented
                  label="Показать"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    ["all", "Все идеи"],
                    ["weak", `Слабые места${weakCount ? ` (${weakCount})` : ""}`],
                    ["due", `Повторить${dueCount ? ` (${dueCount})` : ""}`],
                  ] as const}
                />
              </div>
            </div>
            {parts.map((part) => (
              <div key={part || "-"} className="space-y-2">
                {part && <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">{part}</h2>}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.modules
                    .filter((m) => m.part === part)
                    .map((m) => (
                      <ModuleCard key={m.id} m={m} filter={filter} />
                    ))}
                </div>
              </div>
            ))}
            {filter !== "all" && !data.modules.some((m) => m.ideas.some((i) => (filter === "weak" ? weak(i) : i.due))) && (
              <Notice tone="ok">{filter === "weak" ? "Слабых мест нет." : "Повторять пока нечего."}</Notice>
            )}
          </div>
        )}
      </Page>
    </>
  );
}
