"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DayActivity, DayCost } from "@/lib/types";
import { cx } from "./ui";

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

const parse = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const human = (d: Date) => d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

/** Hover tooltip that follows a mark inside a positioned container. */
function useTip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const show = (el: Element, body: ReactNode) => {
    const b = box.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!b) return;
    setTip({ x: r.left - b.left + r.width / 2 + (box.current?.scrollLeft ?? 0), y: r.top - b.top, body });
  };
  const node = tip && (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-sm border border-border-strong bg-surface px-2 py-1 text-xs whitespace-nowrap text-text shadow-widget"
      style={{ left: tip.x, top: tip.y - 6 }}
      role="tooltip"
    >
      {tip.body}
    </div>
  );
  return { box, show, hide: () => setTip(null), node };
}

/**
 * A year of activity as a calendar of squares, weeks in columns and weekdays
 * in rows, darker for more answers. Same idea as a contribution graph.
 */
export function Heatmap({ days, today }: { days: DayActivity[]; today: string }) {
  const { box, show, hide, node } = useTip();
  const scroller = useRef<HTMLDivElement>(null);

  const { weeks, months, levelOf } = useMemo(() => {
    const byDate = new Map(days.map((d) => [d.date, d]));
    const end = parse(today);
    // Monday-first weeks; the last column is the current week.
    const lastMonday = addDays(end, -((end.getDay() + 6) % 7));
    const start = addDays(lastMonday, -52 * 7);
    const weeks: ({ date: Date; key: string; d: DayActivity | undefined } | null)[][] = [];
    for (let w = 0; w < 53; w++) {
      const col = [];
      for (let i = 0; i < 7; i++) {
        const date = addDays(start, w * 7 + i);
        col.push(date > end ? null : { date, key: keyOf(date), d: byDate.get(keyOf(date)) });
      }
      weeks.push(col);
    }
    const months: { col: number; label: string }[] = [];
    weeks.forEach((col, i) => {
      const first = col[0]?.date;
      if (!first) return;
      const prev = weeks[i - 1]?.[0]?.date;
      if (!prev || prev.getMonth() !== first.getMonth()) months.push({ col: i, label: MONTHS[first.getMonth()] });
    });
    // Quartiles of the active days, so a light learner still sees contrast.
    const counts = days.map((d) => d.answers).filter((n) => n > 0).sort((a, b) => a - b);
    const q = (p: number) => counts[Math.min(counts.length - 1, Math.floor(p * counts.length))] ?? 0;
    const [q1, q2, q3] = counts.length >= 4 ? [q(0.25), q(0.5), q(0.75)] : [1, 2, 4];
    const levelOf = (n: number) => (n <= 0 ? 0 : n <= q1 ? 1 : n <= q2 ? 2 : n <= q3 ? 3 : 4);
    return { weeks, months: months.filter((m, i) => i === 0 || m.col - months[i - 1].col >= 3), levelOf };
  }, [days, today]);

  useEffect(() => {
    // On narrow screens start at the most recent weeks.
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weeks]);

  const CELL = 11;
  const GAP = 3;
  return (
    <div ref={box} className="relative" onMouseLeave={hide}>
      <div ref={scroller} className="overflow-x-auto pb-1">
        <div className="inline-grid min-w-max gap-y-1" style={{ gridTemplateColumns: `28px auto` }}>
          <span />
          <div className="relative h-4 text-[11px] text-muted">
            {months.map((m) => (
              <span key={m.col} className="absolute" style={{ left: m.col * (CELL + GAP) }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="grid text-[11px] leading-none text-muted" style={{ gridTemplateRows: `repeat(7, ${CELL}px)`, rowGap: GAP }}>
            {["Пн", "", "Ср", "", "Пт", "", ""].map((l, i) => (
              <span key={i} className="flex items-center">
                {l}
              </span>
            ))}
          </div>
          <div className="flex" style={{ gap: GAP }} role="img" aria-label="Активность по дням за год">
            {weeks.map((col, w) => (
              <div key={w} className="grid" style={{ gridTemplateRows: `repeat(7, ${CELL}px)`, rowGap: GAP }}>
                {col.map((c, i) =>
                  c ? (
                    <span
                      key={i}
                      className={cx("rounded-[2px] outline-offset-1 hover:outline hover:outline-1 hover:outline-text", `heat-${levelOf(c.d?.answers ?? 0)}`)}
                      style={{ width: CELL, height: CELL }}
                      onMouseEnter={(e) =>
                        show(
                          e.currentTarget,
                          <>
                            <b className="font-semibold text-bright">{c.d ? `${c.d.answers} ${c.d.answers === 1 ? "ответ" : c.d.answers < 5 ? "ответа" : "ответов"}` : "Нет активности"}</b>
                            {c.d && `, верно ${c.d.correct}`}
                            {c.d?.drills ? `, без репетитора ${c.d.drills}` : ""}
                            <span className="text-muted"> · {human(c.date)}</span>
                          </>,
                        )
                      }
                    />
                  ) : (
                    <span key={i} style={{ width: CELL, height: CELL }} />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-muted">
        Меньше
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={cx("size-[11px] rounded-[2px]", `heat-${l}`)} />
        ))}
        Больше
      </div>
      {node}
    </div>
  );
}

const money = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

/** Money per day for the last 30 days, with the daily cap as a dashed line. */
export function CostBars({ days, limit }: { days: DayCost[]; limit: number | null }) {
  const { box, show, hide, node } = useTip();
  const max = Math.max(limit ?? 0, ...days.map((d) => d.cost)) || 1;
  const H = 120;
  return (
    <div ref={box} className="relative" onMouseLeave={hide}>
      <div className="flex gap-2">
        <div className="flex w-12 shrink-0 flex-col justify-between text-right text-[11px] text-muted tabular-nums" style={{ height: H }}>
          <span>{money(max)}</span>
          <span>$0</span>
        </div>
        <div className="relative flex-1 border-b border-border-strong" style={{ height: H }}>
          <div className="absolute inset-x-0 top-0 border-t border-border" aria-hidden />
          <div className="absolute inset-x-0 top-1/2 border-t border-border" aria-hidden />
          {limit !== null && (
            <div className="absolute inset-x-0 border-t border-dashed border-warn" style={{ bottom: (limit / max) * H }} aria-hidden>
              <span className="absolute -top-4 right-0 bg-bg px-1 text-[11px] text-warn">лимит {money(limit)}</span>
            </div>
          )}
          <div className="absolute inset-0 flex items-end gap-[2px]" role="img" aria-label="Расходы по дням за 30 дней">
            {days.map((d) => (
              <div
                key={d.date}
                className="group flex h-full flex-1 items-end"
                onMouseEnter={(e) =>
                  show(
                    e.currentTarget.firstElementChild ?? e.currentTarget,
                    <>
                      <b className="font-semibold text-bright">{money(d.cost)}</b>
                      {d.unknown && " + без цены"}
                      <span className="text-muted">
                        {" "}
                        · {d.tokens.toLocaleString("ru-RU")} токенов · {parse(d.date).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                      </span>
                    </>,
                  )
                }
              >
                <div
                  className={cx("grow-y w-full rounded-t-[2px] transition-opacity group-hover:opacity-80", d.cost > 0 ? "bg-accent-strong" : d.tokens > 0 ? "bg-border-strong" : "")}
                  style={{ height: d.cost > 0 ? Math.max(2, (d.cost / max) * H) : d.tokens > 0 ? 2 : 0 }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-1 ml-14 flex justify-between text-[11px] text-muted">
        <span>{parse(days[0].date).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</span>
        <span>сегодня</span>
      </div>
      {node}
    </div>
  );
}

/** Today's answers against the daily goal: a ring that closes when the goal is met. */
export function GoalRing({ done, target, size = 56 }: { done: number; target: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const part = Math.min(1, target ? done / target : 0);
  const met = done >= target;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Цель на день: ${done} из ${target}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={5} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={met ? "var(--ok)" : "var(--accent-strong)"}
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={`${c * part} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-[stroke-dasharray] duration-700 ease-out"
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size / 4} fill="var(--bright)" className="tabular-nums">
        {met ? "✓" : `${done}`}
      </text>
    </svg>
  );
}

/** Share of correct answers at each confidence level. */
export function Calibration({ rows }: { rows: { level: number; total: number; correct: number }[] }) {
  const CONF = ["Угадывал", "Скорее да", "Уверен"];
  return (
    <div className="space-y-2.5">
      {rows.map((c) => {
        const pct = c.total ? Math.round((c.correct / c.total) * 100) : null;
        return (
          <div key={c.level} className="flex items-center gap-3 text-sm">
            <span className="w-24 shrink-0">{CONF[c.level - 1]}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div className="grow-x h-full rounded-full bg-accent-strong" style={{ width: `${pct ?? 0}%` }} />
            </div>
            <span className="w-28 shrink-0 text-right text-muted tabular-nums">{pct === null ? "нет данных" : `${pct}% из ${c.total}`}</span>
          </div>
        );
      })}
    </div>
  );
}

