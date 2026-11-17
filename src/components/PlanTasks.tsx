"use client";

import Link from "next/link";
import type { PlanTask } from "@/server/studyplan";
import { cx, Icon, type IconName } from "./ui";

const ICON: Record<PlanTask["kind"], IconName> = { start: "play", learn: "book", review: "clock", exam: "check", mistakes: "target" };

/** A day's tasks; on today's list finished ones are ticked off. */
export function PlanTasks({ tasks, today, showTopic = true }: { tasks: PlanTask[]; today?: boolean; showTopic?: boolean }) {
  return (
    <ul className="space-y-1">
      {tasks.map((t, i) => (
        <li key={i}>
          <Link
            href={t.href}
            className={cx("group flex min-h-8 items-center gap-2.5 rounded-sm px-2 py-1 text-[14px] hover:bg-surface-2", today && t.done && "text-muted")}
          >
            {today ? (
              <span
                className={cx("grid size-4 shrink-0 place-items-center rounded-full border", t.done ? "border-ok bg-ok text-bg" : "border-border-strong")}
                aria-label={t.done ? "сделано" : "не сделано"}
              >
                {t.done && <Icon name="check" size={10} className="[stroke-width:2.4]" />}
              </span>
            ) : (
              <Icon name={ICON[t.kind]} size={14} className="text-muted" />
            )}
            <span className={cx("min-w-0 flex-1 truncate", today && t.done && "line-through")}>{t.title}</span>
            {showTopic && t.topicTitle && <span className="hidden max-w-[40%] shrink-0 truncate text-xs text-muted sm:inline">{t.topicTitle}</span>}
            <Icon name="chevron" size={14} className="shrink-0 text-muted opacity-0 group-hover:opacity-100" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
