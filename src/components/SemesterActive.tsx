"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, formatDate } from "@/lib/api";
import { ASSESSMENT_LABEL, MASTERY_STEPS } from "@/lib/semester";
import type { ModuleView, SemesterView, TodayTask } from "@/server/semester";
import { Badge, Button, Card, Cells, cx, Dots, fieldClass, Icon, LinkButton, Notice, PanelTitle } from "./ui";

const when = (ms: number) => new Date(ms).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const CREDIT = { exam: "сдан", early: "сдан досрочно", placement: "по входному тесту" } as const;

/** Where to go to learn a module: the open lesson, or a new one. */
const learnHref = (m: ModuleView) => (m.openSessionId ? `/session/${m.openSessionId}` : `/topics/${m.topicId}?start=lesson`);
const examHref = (s: SemesterView, m: ModuleView, kind: "checkpoint" | "placement" = "checkpoint") => `/semester/${s.id}/exam?kind=${kind}&module=${m.id}`;

/** The four steps of knowing a module's ideas, as one bar per step. */
function Steps({ m }: { m: ModuleView }) {
  const i = m.ideas!;
  if (!i.total) return null;
  const values = [i.studied, i.checked, i.explained, i.lasting];
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
      {MASTERY_STEPS.map((label, k) => (
        <div key={label} title={`${label}: ${values[k]} из ${i.total}`}>
          <div className="flex justify-between text-[11px] text-muted">
            <span>{label}</span>
            <span className="tabular-nums">
              {values[k]}/{i.total}
            </span>
          </div>
          <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-surface-2">
            <div className={cx("grow-x h-full rounded-full", k === 3 ? "bg-ok" : k === 2 ? "bg-accent-strong" : "bg-ok/70")} style={{ width: `${(values[k] / i.total) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ModuleActions({ s, m, onChange }: { s: SemesterView; m: ModuleView; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (m.status === "locked") return <span className="text-xs text-muted">откроется после предыдущего</span>;
  if (!m.prepared) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          small
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api(`/api/semesters/${s.id}/modules/${m.id}`, { body: {} });
              onChange();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
            setBusy(false);
          }}
        >
          {busy ? (
            <>
              <Dots /> Готовлю идеи модуля
            </>
          ) : (
            "Подготовить модуль"
          )}
        </Button>
        {error && <span className="text-xs text-bad">{error}</span>}
      </div>
    );
  }
  const ready = m.ideas!.total > 0 && m.ideas!.checked === m.ideas!.total;
  const placementFirst = m.kind === "prereq" && !m.checkpoint?.tries;
  const wait = m.checkpoint?.nextTryAt;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {placementFirst && m.status === "open" ? (
        <LinkButton small variant="primary" href={examHref(s, m, "placement")}>
          <Icon name="check" size={14} /> Входной тест
        </LinkButton>
      ) : (
        <>
          {m.status !== "passed" && (
            <LinkButton small variant={ready ? "secondary" : "primary"} href={learnHref(m)}>
              <Icon name="play" size={14} /> {m.openSessionId ? "Продолжить урок" : "Учить"}
            </LinkButton>
          )}
          {m.status === "open" &&
            (wait ? (
              <span className="text-xs text-muted">пересдача {when(wait)}</span>
            ) : (
              <LinkButton small variant={ready ? "primary" : "ghost"} href={examHref(s, m)}>
                <Icon name="check" size={14} /> {ready ? "Контрольная" : "Сдать досрочно"}
              </LinkButton>
            ))}
        </>
      )}
      <LinkButton small variant="ghost" href={`/topics/${m.topicId}`}>
        Модуль
      </LinkButton>
      {(m.ideas?.studied ?? 0) > 0 && (
        <LinkButton small variant="ghost" href={`/oral?topic=${m.topicId}`}>
          Устно
        </LinkButton>
      )}
      {m.status === "passed" && (
        <LinkButton small variant="ghost" href={`/explain?topic=${m.topicId}`}>
          <Icon name="chat" size={14} /> Объяснить
        </LinkButton>
      )}
      {m.status === "passed" && m.kind === "regular" && !wait && (
        <Link href={examHref(s, m)} className="text-xs text-accent hover:underline" title="В оценку идёт лучшая попытка">
          пересдать на лучшую оценку
        </Link>
      )}
    </div>
  );
}

function ModuleRow({ s, m, onChange }: { s: SemesterView; m: ModuleView; onChange: () => void }) {
  const icon = m.status === "passed" ? "check" : m.status === "open" ? "play" : "pin";
  return (
    <li className={cx("space-y-2 px-3 py-3", m.status === "locked" && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx("grid size-6 shrink-0 place-items-center rounded-full", m.status === "passed" ? "bg-ok-soft text-ok" : m.status === "open" ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted")}>
          <Icon name={icon} size={13} />
        </span>
        <span className="text-xs text-muted tabular-nums">{m.kind === "prereq" ? "0" : m.idx}</span>
        <span className="min-w-0 flex-1 truncate text-bright">{m.title}</span>
        {m.credit && <Badge tone="ok">{CREDIT[m.credit]}</Badge>}
        {m.checkpoint?.best != null && <span className="text-xs text-muted tabular-nums">лучший результат {m.checkpoint.best}%</span>}
        <span className="text-xs text-muted">{m.hours} ч</span>
      </div>
      {m.prepared && m.ideas && m.ideas.total > 0 && (
        <div className="space-y-2 pl-8">
          <Cells total={m.ideas.total} mastered={m.ideas.checked} learning={m.ideas.studied - m.ideas.checked} />
          <Steps m={m} />
        </div>
      )}
      <div className="pl-8">
        <ModuleActions s={s} m={m} onChange={onChange} />
      </div>
    </li>
  );
}

function ExamLine({ s, kind }: { s: SemesterView; kind: "midterm" | "final" }) {
  const e = s.active![kind];
  if (kind === "midterm" && e.reason?.includes("короткий")) return null;
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
      <Icon name="check" className={e.passed ? "text-ok" : "text-muted"} />
      <span className="min-w-0 flex-1 text-bright">{ASSESSMENT_LABEL[kind]}</span>
      {e.best !== null && <span className="text-xs text-muted tabular-nums">лучший результат {e.best}%</span>}
      {e.passed ? (
        <>
          <Badge tone="ok">сдан</Badge>
          {e.available && (
            <Link href={`/semester/${s.id}/exam?kind=${kind}`} className="text-xs text-accent hover:underline" title="В оценку идёт лучшая попытка">
              пересдать на лучшую оценку
            </Link>
          )}
        </>
      ) : e.available ? (
        <LinkButton small variant="primary" href={`/semester/${s.id}/exam?kind=${kind}`}>
          Сдавать
        </LinkButton>
      ) : (
        <span className="text-xs text-muted">{e.nextTryAt ? `пересдача ${when(e.nextTryAt)}` : e.reason}</span>
      )}
    </li>
  );
}

/** The next thing to do, in one card. */
function Now({ s }: { s: SemesterView }) {
  const a = s.active!;
  if (s.status === "finished") {
    return (
      <Notice tone="ok">
        Семестр завершён{a.grade ? ` с оценкой «${a.grade.label}» (${a.grade.pct}%)` : ""}. Дальше знания держит интервальное повторение:{" "}
        <Link href="/review" className="text-accent hover:underline">
          повторение на сегодня
        </Link>
        .
      </Notice>
    );
  }
  const open = s.modules.find((m) => m.status === "open");
  if (s.pausedAt) return <Notice>Семестр на паузе: календарь стоит. Продолжить можно в «Паузе и переносе» ниже.</Notice>;
  let text: React.ReactNode = null;
  if (a.final.available && !a.final.passed) text = <>Все модули сданы — остался итоговый экзамен.</>;
  else if (a.midterm.available && !a.midterm.passed) text = <>Пора сдать промежуточный экзамен: он проверит, что пройденное не забылось.</>;
  else if (open) {
    if (open.kind === "prereq" && !open.checkpoint?.tries) text = <>Начни со входного теста: он покажет, что из нужного курсу ты уже знаешь.</>;
    else if (!open.prepared) text = <>Модуль «{open.title}» готовится: репетитор составляет его идеи по книге.</>;
    else if (open.ideas!.checked === open.ideas!.total && open.ideas!.total > 0) text = <>Все идеи модуля «{open.title}» освоены — сдай контрольную, чтобы открыть следующий.</>;
    else text = <>Сейчас: модуль «{open.title}». Освоено {open.ideas!.checked} из {open.ideas!.total} идей.</>;
  }
  return text ? <Notice tone="accent">{text}</Notice> : null;
}

const PACE = {
  ahead: ["ok", "опережаешь"],
  ok: ["ok", "в графике"],
  behind: ["warn", "отстаёшь"],
  late: ["bad", "срок вышел"],
  paused: ["neutral", "на паузе"],
} as const;

/** Freeze the semester or move its calendar. */
function Schedule({ s, onChange }: { s: SemesterView; onChange: () => void }) {
  const [days, setDays] = useState(7);
  const [weeks, setWeeks] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (url: string, body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api(url, { body });
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  const since = s.pausedAt ? new Date(s.pausedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : null;
  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface">
      <PanelTitle>Пауза и перенос</PanelTitle>
      <div className="space-y-3 px-3 py-3 text-sm">
        {since ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">
              Семестр на паузе с {since}. Календарь стоит; когда продолжишь, все сроки сдвинутся на дни паузы. Повторение идёт и сейчас — чтобы ничего не забылось.
            </span>
            <Button small variant="primary" disabled={busy} onClick={() => act(`/api/semesters/${s.id}/pause`, { action: "resume" })}>
              <Icon name="play" size={14} /> Продолжить
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 text-muted">Отпуск, болезнь, сессия по другому предмету — поставь семестр на паузу, и отставание не накопится.</span>
            <Button small disabled={busy} onClick={() => act(`/api/semesters/${s.id}/pause`, { action: "pause" })}>
              Поставить на паузу
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted">Сдвинуть календарь на</span>
          <input type="number" min={-60} max={120} className={cx(fieldClass, "w-20 py-1 text-right sm:py-0.5")} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Дней" />
          <span className="text-muted">дн.</span>
          <Button small disabled={busy || !days} onClick={() => act(`/api/semesters/${s.id}/reschedule`, { days })}>
            Сдвинуть
          </Button>
          <span className="w-4" />
          <span className="text-muted">Продлить на</span>
          <input type="number" min={-26} max={26} className={cx(fieldClass, "w-20 py-1 text-right sm:py-0.5")} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label="Недель" />
          <span className="text-muted">нед.</span>
          <Button small disabled={busy || !weeks} onClick={() => act(`/api/semesters/${s.id}/reschedule`, { weeks })}>
            Изменить
          </Button>
        </div>
        <p className="text-xs text-muted">
          Сейчас: {s.weeks} нед., начало {new Date(s.startDate).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}. Отрицательные числа сдвигают назад и укорачивают.
        </p>
        {error && <Notice tone="bad">{error}</Notice>}
      </div>
    </section>
  );
}

const TASK_ICON: Record<TodayTask["kind"], "play" | "check" | "clock" | "note"> = {
  placement: "check",
  learn: "play",
  checkpoint: "check",
  review: "clock",
  homework: "note",
  "new-homework": "note",
  midterm: "check",
  final: "check",
};

/** Today's list: what the calendar and the gates say to do now. */
function Today({ s }: { s: SemesterView }) {
  const router = useRouter();
  const a = s.active!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!a.today.length) return null;
  const newHomework = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: number }>(`/api/semesters/${s.id}/homework`, { body: {} });
      router.push(`/semester/${s.id}/homework/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface">
      <PanelTitle>Сегодня</PanelTitle>
      <ul className="divide-y divide-border">
        {a.today.map((t, i) => (
          <li key={t.kind + t.title}>
            {t.href ? (
              <Link href={t.href} className="group flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-surface-2/60">
                <Icon name={TASK_ICON[t.kind]} className={i === 0 ? "text-accent" : "text-muted"} />
                <span className={cx("min-w-0 flex-1 truncate group-hover:text-accent", i === 0 ? "text-bright" : "text-text")}>{t.title}</span>
                <Icon name="chevron" size={14} className="text-muted" />
              </Link>
            ) : (
              <button onClick={newHomework} disabled={busy} className="group flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface-2/60">
                <Icon name={TASK_ICON[t.kind]} className="text-muted" />
                <span className="min-w-0 flex-1 truncate group-hover:text-accent">{busy ? "Составляю задание… (около минуты)" : `${t.title}: получить`}</span>
                {busy ? <Dots /> : <Icon name="chevron" size={14} className="text-muted" />}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <div className="border-t border-border p-2">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
    </section>
  );
}

function CalendarView({ s }: { s: SemesterView }) {
  const c = s.active!.calendar;
  const [all, setAll] = useState(false);
  const [tone, label] = PACE[c.pace];
  const fmt = (ms: number) => new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  const shown = all ? c.weeks : c.weeks.filter((w) => Math.abs(w.week - Math.max(1, c.currentWeek)) <= 2);
  const title = c.currentWeek === 0 ? "Календарь: семестр ещё не начался" : c.currentWeek > s.weeks ? "Календарь: срок вышел" : `Календарь: неделя ${c.currentWeek} из ${s.weeks}`;
  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface">
      <PanelTitle right={<Badge tone={tone}>{label}</Badge>}>{title}</PanelTitle>
      <p className="px-3 py-2 text-[13px] text-muted">
        По плану к сегодняшнему дню сдано модулей: {c.expectedPassed}, у тебя — {c.passed} из {c.total}. Осталось {c.daysLeft} дн.
        {c.neededPerWeek > s.hoursPerWeek ? ` Чтобы успеть, нужно около ${c.neededPerWeek} ч в неделю вместо ${s.hoursPerWeek}.` : ""}
      </p>
      <ol className="divide-y divide-border border-t border-border">
        {shown.map((w) => (
          <li key={w.week} className={cx("flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5 text-sm", w.week === c.currentWeek && "bg-accent-soft/50")}>
            <span className={cx("w-24 shrink-0 tabular-nums", w.week === c.currentWeek ? "text-accent" : "text-muted")}>
              {w.week} · {fmt(w.start)}
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {w.modules.length ? <span>{w.modules.join(", ")}</span> : !w.final && <span className="text-muted">повторение и задачи</span>}
              {w.midterm && <Badge tone="accent">промежуточный экзамен</Badge>}
              {w.final && <Badge tone="accent">итоговый экзамен</Badge>}
            </span>
          </li>
        ))}
      </ol>
      {c.weeks.length > shown.length && (
        <button onClick={() => setAll(true)} className="w-full border-t border-border px-3 py-1.5 text-left text-[13px] text-accent hover:bg-surface-2/60">
          Показать все {c.weeks.length} недель
        </button>
      )}
    </section>
  );
}

function Homework({ s }: { s: SemesterView }) {
  const list = s.active!.homework;
  if (!list.length) return null;
  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface">
      <PanelTitle>Домашние задания</PanelTitle>
      <ul className="divide-y divide-border">
        {list.map((h) => (
          <li key={h.id}>
            <Link href={`/semester/${s.id}/homework/${h.id}`} className="group flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-surface-2/60">
              <Icon name="note" className={h.status === "graded" ? "text-ok" : "text-accent"} />
              <span className="w-16 shrink-0 text-xs text-muted">неделя {h.week}</span>
              <span className="min-w-0 flex-1 truncate group-hover:text-accent">{h.title}</span>
              {h.score !== null ? <span className={cx("tabular-nums", h.score >= 55 ? "text-ok" : "text-bad")}>{h.score}%</span> : <Badge tone="warn">не сдано</Badge>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The running semester: progress, the next step, modules with their gates, exams and the grade book. */
export function SemesterActive({ s, onChange }: { s: SemesterView; onChange: () => void }) {
  const a = s.active!;
  const regular = s.modules.filter((m) => m.kind === "regular");
  const passed = regular.filter((m) => m.credit).length;
  const parts = [...new Set(s.modules.map((m) => m.part))];

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 overflow-hidden rounded-md border border-border bg-surface sm:grid-cols-5">
        {(
          [
            ["Освоено программы", `${a.progress}%`, "text-ok"],
            ["Знаю надёжно", `${a.lasting}%`, "text-bright"],
            ["Модулей сдано", `${passed} из ${regular.length}`, "text-bright"],
            [s.status === "finished" ? "Итоговая оценка" : "Текущая оценка", a.grade ? `${a.grade.mark} · ${a.grade.pct}%` : "—", a.grade ? (a.grade.mark >= 4 ? "text-ok" : a.grade.mark === 3 ? "text-warn" : "text-bad") : "text-bright"],
            ["Порог контрольной", `${a.threshold}%`, "text-bright"],
          ] as const
        ).map(([label, value, tone], i) => (
          <div key={label} style={{ "--i": i + 1 } as React.CSSProperties} className="enter -mt-px -ml-px border-t border-l border-border px-3 py-2">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className={cx("mt-0.5 truncate text-[15px] leading-tight tabular-nums", tone)}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="-mt-3 text-xs text-muted">
        «Знаю надёжно» — идея проверена, объяснена своими словами и держится в памяти три недели и дольше.
      </p>

      <div className="-mt-2 flex flex-wrap gap-2">
        <LinkButton small href={`/semester/${s.id}/map`}>
          <Icon name="target" size={14} /> Карта курса
        </LinkButton>
      </div>

      <Now s={s} />
      {a.prepareError && <Notice tone="bad">{a.prepareError}</Notice>}
      <Today s={s} />
      {s.status === "active" && <CalendarView s={s} />}

      <section className="overflow-hidden rounded-md border border-border bg-surface">
        <PanelTitle right={a.preparing ? <span className="flex items-center gap-1.5 text-xs text-muted"><Dots /> готовлю модули</span> : undefined}>Модули</PanelTitle>
        {parts.map((part) => (
          <div key={part || "-"}>
            {part && <div className="border-b border-border bg-surface-2/50 px-3 py-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{part}</div>}
            <ul className="divide-y divide-border">
              {s.modules
                .filter((m) => m.part === part)
                .map((m) => (
                  <ModuleRow key={m.id} s={s} m={m} onChange={onChange} />
                ))}
            </ul>
          </div>
        ))}
      </section>

      <Homework s={s} />
      {s.status === "active" && <Schedule s={s} onChange={onChange} />}

      <section className="overflow-hidden rounded-md border border-border bg-surface">
        <PanelTitle>Экзамены</PanelTitle>
        <ul className="divide-y divide-border">
          <ExamLine s={s} kind="midterm" />
          <ExamLine s={s} kind="final" />
        </ul>
      </section>

      <section className="overflow-hidden rounded-md border border-border bg-surface">
        <PanelTitle right={a.grade ? <span className="text-xs text-muted">итог: {a.grade.label}</span> : undefined}>Ведомость</PanelTitle>
        {a.grades.length ? (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {a.grades.map((g) => (
                <tr key={g.id}>
                  <td className="px-3 py-1.5">
                    {ASSESSMENT_LABEL[g.kind]}
                    {g.module && <span className="text-muted"> · {g.module}</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap text-muted">{formatDate(g.createdAt)}</td>
                  <td className={cx("w-20 px-3 py-1.5 text-right tabular-nums", g.passed ? "text-ok" : "text-bad")}>{g.score}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-3 py-2.5 text-sm text-muted">Пока пусто: сюда попадут контрольные, домашние задания и экзамены.</p>
        )}
        {a.grade && (
          <p className="border-t border-border px-3 py-2 text-xs text-muted">
            Итог считается по лучшим попыткам: {a.grade.parts.map((p) => `${ASSESSMENT_LABEL[p.kind].toLowerCase()} ${p.pct}% (вес ${Math.round(p.weight * 100)}%)`).join(", ")}. 85% и выше — «отлично», 70% — «хорошо», 55% —
            «удовлетворительно».
          </p>
        )}
      </section>

      {s.finishedAt === null && s.status === "active" && (
        <Card className="text-sm text-muted">
          Каждый модуль открывается после контрольной по предыдущему. Модуль можно сдать досрочно, не проходя уроки, — так сэкономишь время на том, что уже знаешь.
          Провалил — пересдача через 20 часов, а ошибки сразу попадут в <Link href="/mistakes" className="text-accent hover:underline">работу над ошибками</Link>.
        </Card>
      )}
    </div>
  );
}
