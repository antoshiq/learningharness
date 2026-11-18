"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { KIND_LABEL, SELF_GRADED, type AnswerPayload, type DrillItem, type Outcome, type SelfGrade } from "@/lib/types";
import { ResultCells } from "./Drill";
import { Markdown } from "./Markdown";
import { ActiveQuestion, AnsweredQuestion, OUTCOME } from "./QuestionCard";
import { Badge, Button, Card, cx, Icon, Kbd, LinkButton, Mark, Notice } from "./ui";
import { notifyChanged } from "./workbench-context";

interface Answered {
  item: DrillItem;
  answer: AnswerPayload | null;
  /** null until graded: free answers are graded by the learner at the end. */
  outcome: Outcome | null;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const points = (o: Outcome | null) => (o === "correct" ? 1 : o === "partial" ? 0.5 : 0);

function Timer({ deadline, onExpire }: { deadline: number; onExpire: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const left = deadline - now;
  useEffect(() => {
    if (left <= 0) onExpire();
  }, [left, onExpire]);
  return (
    <span className={cx("flex items-center gap-1 rounded px-2 py-0.5 tabular-nums", left < 60_000 ? "bg-bad-soft font-medium text-bad" : "bg-surface-2 text-text")} title="Осталось времени">
      <Icon name="clock" size={14} />
      {fmt(left)}
    </span>
  );
}

/**
 * An exam: every question in a row, no hints and no feedback until the end.
 * Checkable answers are graded on the server as they come; free ones are
 * compared with the reference by the learner on the results screen.
 */
/** Score and per-idea results; null while free answers wait for the learner's grade. */
function summarize(items: DrillItem[], answers: Answered[]): (ExamResult & { byNode: Map<string, { title: string; got: number; total: number }> }) | null {
  const byNode = new Map<string, { title: string; got: number; total: number }>();
  for (const it of items) {
    // Keys of different topics may coincide in an exam over several modules.
    const k = `${it.topic.id}:${it.node?.key ?? ""}`;
    const row = byNode.get(k) ?? { title: it.node?.title ?? "Без идеи плана", got: 0, total: 0 };
    row.total++;
    row.got += points(answers.find((x) => x.item === it)?.outcome ?? null);
    byNode.set(k, row);
  }
  if (answers.some((x) => x.outcome === null)) return null;
  // Unanswered questions count as zero.
  const score = answers.reduce((s, x) => s + points(x.outcome), 0);
  return { pct: Math.round((score / items.length) * 100), details: [...byNode.entries()].map(([key, r]) => ({ key, ...r })), byNode };
}

export interface ExamResult {
  pct: number;
  /** Per idea: "topicId:nodeKey", title, points got and questions asked. */
  details: { key: string; title: string; got: number; total: number }[];
}

export function Exam({
  items,
  minutes,
  topicId,
  onRestart,
  onFinish,
  after,
}: {
  items: DrillItem[];
  minutes: number | null;
  /** The topic the exam is about; null for an exam over several topics. */
  topicId: number | null;
  onRestart?: () => void;
  /** Called once, when every answer is graded (a semester records it). */
  onFinish?: (r: ExamResult) => void;
  /** Shown in place of the usual buttons at the end. */
  after?: React.ReactNode;
}) {
  const [deadline] = useState(() => (minutes ? Date.now() + minutes * 60_000 : null));
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answered[]>([]);
  const [finished, setFinished] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeds] = useState(() => items.map(() => Math.floor(Math.random() * 2 ** 31)));

  const reported = useRef(false);
  useEffect(() => {
    if (!finished || reported.current || !onFinish) return;
    const r = summarize(items, answers);
    if (!r) return;
    reported.current = true;
    onFinish({ pct: r.pct, details: r.details });
  }, [finished, answers, items, onFinish]);

  const item = items[index];
  const finish = (expired = false) => {
    if (finished) return;
    setTimedOut(expired);
    setFinished(true);
    notifyChanged();
  };

  const submit = async (a: AnswerPayload | null) => {
    setError(null);
    let outcome: Outcome | null = null;
    if (a && !SELF_GRADED.includes(item.question.kind)) {
      setBusy(true);
      try {
        outcome = (await api<{ outcome: Outcome }>("/api/practice", { body: { attemptId: item.attemptId, mode: "exam", answer: a } })).outcome;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    setAnswers((xs) => [...xs, { item, answer: a, outcome: a ? outcome : "skipped" }]);
    if (index + 1 >= items.length) finish();
    else setIndex(index + 1);
  };

  const grade = async (i: number, g: SelfGrade) => {
    const x = answers[i];
    try {
      await api("/api/practice", { body: { attemptId: x.item.attemptId, mode: "exam", answer: x.answer, selfGrade: g } });
      setAnswers((xs) => xs.map((y, k) => (k === i ? { ...y, outcome: g } : y)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!finished) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="shrink-0 tabular-nums">
            Вопрос {index + 1} из {items.length}
          </span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent-strong transition-[width] duration-300" style={{ width: `${(index / items.length) * 100}%` }} />
          </div>
          {deadline && <Timer deadline={deadline} onExpire={() => finish(true)} />}
        </div>
        <section key={item.attemptId} className="enter overflow-hidden rounded-sm border border-l-2 border-accent bg-bg">
          <div className="flex min-h-8 flex-wrap items-center gap-x-2.5 border-b border-border bg-surface px-3 py-1 text-xs">
            <span className="font-semibold text-accent">Экзамен</span>
            {item.node && <span className="truncate text-text">{item.node.title}</span>}
            <span className="text-muted">{KIND_LABEL[item.question.kind]}</span>
          </div>
          <div className="space-y-4 p-3 sm:p-4">
            <Markdown text={item.question.prompt} className="text-[15px] text-bright" />
            <ActiveQuestion
              key={item.attemptId}
              item={{ type: "question", attemptId: item.attemptId, question: item.question, answer: null, outcome: null, autoGraded: false, pending: true }}
              seed={seeds[index]}
              busy={busy}
              noHints
              submitLabel={index + 1 >= items.length ? "Ответить и завершить" : "Ответить"}
              onAnswer={submit}
              onInvalid={() => submit(null)}
            />
            {error && <Notice tone="bad">{error}</Notice>}
          </div>
        </section>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" small onClick={() => submit(null)} disabled={busy}>
            Пропустить
          </Button>
          <Button variant="ghost" small onClick={() => finish()} disabled={busy}>
            Завершить досрочно
          </Button>
        </div>
      </div>
    );
  }

  // Results. Unanswered questions count as zero.
  const pending = answers.filter((x) => x.outcome === null).length;
  const pct = Math.round((answers.reduce((s, x) => s + points(x.outcome), 0) / items.length) * 100);
  const byNode = summarize(items, answers.map((x) => (x.outcome === null ? { ...x, outcome: "skipped" as const } : x)))!.byNode;
  const weak = [...byNode.values()].filter((r) => r.got / r.total < 0.7);
  const wrong = answers.filter((x) => x.outcome === "wrong" || x.outcome === "partial");

  return (
    <div className="enter space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg text-bright">{timedOut ? "Время вышло" : "Экзамен закончен"}</h2>
          <span className={cx("text-2xl tabular-nums", pct >= 80 ? "text-ok" : pct >= 50 ? "text-warn" : "text-bad")}>{pending ? "…" : `${pct}%`}</span>
        </div>
        <ResultCells results={[...answers.map((x) => x.outcome ?? "skipped"), ...items.slice(answers.length).map(() => "skipped" as const)]} total={items.length} />
        <p className="text-sm text-muted">
          Отвечено {answers.filter((x) => x.answer).length} из {items.length}. {pending ? `Осталось оценить свободных ответов: ${pending} — ниже.` : ""}
        </p>
        {error && <Notice tone="bad">{error}</Notice>}
      </Card>

      {answers.some((x) => x.outcome === null) && (
        <Card className="space-y-4">
          <h3 className="text-[15px] font-semibold text-bright">Оцени свободные ответы</h3>
          {answers.map((x, i) =>
            x.outcome !== null ? null : (
              <div key={x.item.attemptId} className="space-y-2 border-t border-border pt-3 first-of-type:border-t-0 first-of-type:pt-0">
                <Markdown text={x.item.question.prompt} className="text-bright" />
                <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
                  <div className="mb-1 text-xs text-muted">Твой ответ</div>
                  <Markdown text={(x.answer?.text ?? "").replace(/\n/g, "  \n")} />
                </div>
                <div className="rounded-md border border-l-2 border-border border-l-ok bg-surface px-3 py-2">
                  <div className="mb-1 text-xs text-ok">Эталон</div>
                  <Markdown text={x.item.question.reference_answer || x.item.question.explanation || ""} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["wrong", "Не совпало"],
                      ["partial", "Частично"],
                      ["correct", "Верно"],
                    ] as const
                  ).map(([g, label]) => (
                    <Button key={g} small variant={g === "correct" ? "primary" : "secondary"} onClick={() => grade(i, g)}>
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            ),
          )}
        </Card>
      )}

      {!pending && (
        <>
          <section className="overflow-hidden rounded-md border border-border bg-surface">
            <div className="flex min-h-9 items-center border-b border-border px-3 text-[13px] font-semibold text-bright">По идеям плана</div>
            <ul className="divide-y divide-border">
              {[...byNode.values()].map((r) => {
                const p = Math.round((r.got / r.total) * 100);
                return (
                  <li key={r.title} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-2">
                      <div className={cx("grow-x h-full rounded-full", p >= 80 ? "bg-ok" : p >= 50 ? "bg-warn" : "bg-bad")} style={{ width: `${p}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-muted tabular-nums">
                      {r.got} из {r.total}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
          {weak.length > 0 && (
            <Notice tone="warn">
              Слабые места: {weak.map((w) => w.title).join(", ")}. Ошибки уже в «Работе над ошибками», а эти идеи вернутся в повторение раньше.
            </Notice>
          )}
          {wrong.length > 0 && (
            <details className="rounded-md border border-border bg-surface px-3 py-2">
              <summary className="cursor-pointer text-[13px] text-bright">Разбор ошибок: {wrong.length}</summary>
              <div className="mt-3 space-y-4">
                {wrong.map((x) => (
                  <div key={x.item.attemptId} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Mark tone={OUTCOME[x.outcome!].tone}>{OUTCOME[x.outcome!].label}</Mark>
                      {x.item.node && <Badge>{x.item.node.title}</Badge>}
                    </div>
                    <Markdown text={x.item.question.prompt} className="text-bright" />
                    {x.answer && (
                      <AnsweredQuestion item={{ type: "question", attemptId: x.item.attemptId, question: x.item.question, answer: x.answer, outcome: x.outcome, autoGraded: true, pending: false }} />
                    )}
                    {x.item.question.kind !== "choice" && x.item.question.explanation && <Markdown text={x.item.question.explanation} className="text-sm text-muted" />}
                  </div>
                ))}
              </div>
            </details>
          )}
          {after}
          <div className="flex flex-wrap gap-2">
            {wrong.length > 0 && (
              <LinkButton href={topicId ? `/mistakes?topic=${topicId}` : "/mistakes"} variant={after ? "secondary" : "primary"}>
                <Icon name="target" /> Работа над ошибками
              </LinkButton>
            )}
            {onRestart && (
              <Button onClick={onRestart}>
                <Icon name="redo" /> Ещё экзамен
              </Button>
            )}
            {topicId && !after && (
              <LinkButton href={`/topics/${topicId}`} variant="ghost">
                К теме
              </LinkButton>
            )}
            <span className="hidden self-center text-xs text-muted sm:inline">
              <Kbd>Ctrl+Enter</Kbd> ответить
            </span>
          </div>
        </>
      )}
    </div>
  );
}
