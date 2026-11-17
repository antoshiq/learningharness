"use client";

import { useState, type CSSProperties } from "react";
import { api } from "@/lib/api";
import { KIND_LABEL, SELF_GRADED, type AnswerPayload, type DrillItem, type Outcome, type SelfGrade } from "@/lib/types";
import { ActiveQuestion, AnsweredQuestion, OUTCOME, type QItem } from "./QuestionCard";
import { Markdown } from "./Markdown";
import { Badge, Button, cx, Icon, Kbd, KeyHandler, Mark, Notice } from "./ui";
import { notifyChanged } from "./workbench-context";

export interface DrillResult {
  item: DrillItem;
  outcome: Outcome;
}

type Phase =
  | { step: "answer" }
  | { step: "self"; answer: AnswerPayload }
  | { step: "done"; answer: AnswerPayload; outcome: Outcome; status: string | null };

const SELF: [SelfGrade, string, string][] = [
  ["wrong", "Не вспомнил", "1"],
  ["partial", "Частично", "2"],
  ["correct", "Верно", "3"],
];
const STATUS_RU: Record<string, string> = { mastered: "идея освоена", learning: "идея ещё изучается", new: "" };

/** What the right answer looks like, for questions the browser cannot check. */
function Reference({ item }: { item: DrillItem }) {
  const q = item.question;
  const text = q.reference_answer || q.explanation;
  if (!text) return null;
  return (
    <div className="rounded-md border border-l-2 border-border border-l-ok bg-surface px-3 py-2">
      <div className="mb-1 text-xs font-medium text-ok">Эталон</div>
      <Markdown text={text.replace(/\n/g, "  \n")} />
      {q.reference_answer && q.explanation && <Markdown text={q.explanation} className="mt-2 text-sm text-muted" />}
    </div>
  );
}

/** Small squares, one per question: the run so far at a glance. */
export function ResultCells({ results, total }: { results: Outcome[]; total: number }) {
  const tone: Record<Outcome, string> = { correct: "bg-ok", partial: "bg-warn", wrong: "bg-bad", skipped: "bg-border-strong" };
  return (
    <div className="flex flex-wrap gap-[3px]" role="img" aria-label={`Отвечено ${results.length} из ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          style={{ "--i": i } as CSSProperties}
          className={cx("cell-in size-2.5 rounded-[1px]", i < results.length ? tone[results[i]] : "bg-surface-2 ring-1 ring-border-strong ring-inset")}
        />
      ))}
    </div>
  );
}

/**
 * Asks stored questions one after another without the tutor. Checkable kinds
 * are graded from what ran in the browser; free answers are compared with the
 * reference by the learner. Each answer moves the idea's review date.
 */
export function Drill({ items, mode, onFinish }: { items: DrillItem[]; mode: "review" | "mistakes"; onFinish: (results: DrillResult[]) => void }) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>({ step: "answer" });
  const [results, setResults] = useState<DrillResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A fresh option order each time, so the answer is not remembered by position.
  const [seeds] = useState(() => items.map(() => Math.floor(Math.random() * 2 ** 31)));

  const item = items[index];
  const q = item.question;
  const selfGraded = SELF_GRADED.includes(q.kind);
  const last = index === items.length - 1;

  const record = async (answer: AnswerPayload, selfGrade?: SelfGrade) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ outcome: Outcome; status: string | null }>("/api/practice", { body: { attemptId: item.attemptId, mode, answer, selfGrade } });
      setPhase({ step: "done", answer, outcome: r.outcome, status: r.status });
      setResults((rs) => [...rs, { item, outcome: r.outcome }]);
      notifyChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const next = (extra?: DrillResult) => {
    const all = extra ? [...results, extra] : results;
    if (extra) setResults(all);
    if (last) return onFinish(all);
    setIndex((i) => i + 1);
    setPhase({ step: "answer" });
    setError(null);
  };

  const skip = (why?: string) => {
    setNotice(why ?? null);
    next({ item, outcome: "skipped" });
  };

  const onKey = (e: KeyboardEvent, typing: boolean) => {
    if (typing || e.ctrlKey || e.metaKey) return;
    if (phase.step === "self" && !busy) {
      const g = SELF.find(([, , k]) => k === e.key);
      if (g) {
        e.preventDefault();
        record(phase.answer, g[0]);
      }
    } else if (phase.step === "done" && e.key === "Enter") {
      e.preventDefault();
      next();
    }
  };

  const answered: QItem | null =
    phase.step === "done"
      ? { type: "question", attemptId: item.attemptId, question: q, answer: phase.answer, outcome: phase.outcome, autoGraded: !selfGraded, pending: false }
      : null;
  const right = results.filter((r) => r.outcome === "correct").length;

  return (
    <div className="space-y-4">
      <KeyHandler onKey={onKey} />
      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="shrink-0 tabular-nums">
          {index + 1} из {items.length}
        </span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent-strong transition-[width] duration-300 ease-out" style={{ width: `${((index + (phase.step === "done" ? 1 : 0)) / items.length) * 100}%` }} />
        </div>
        <span className="flex shrink-0 items-center gap-1 tabular-nums" title="Верных ответов">
          <Icon name="check" size={14} className="text-ok" />
          {right}
        </span>
      </div>

      {notice && (
        <div className="enter">
          <Notice tone="warn">{notice}</Notice>
        </div>
      )}

      <section
        key={item.attemptId}
        className={cx(
          "enter overflow-hidden rounded-sm border border-l-2 bg-bg transition-colors duration-300",
          phase.step === "done" ? cx("border-border", OUTCOME[phase.outcome].edge) : "attention border-accent",
        )}
      >
        <div className="flex min-h-8 flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border bg-surface px-3 py-1 text-xs">
          <span className="min-w-0 truncate font-semibold text-accent">{item.topic.title}</span>
          {item.node && (
            <>
              <Icon name="chevron" size={12} className="text-muted" />
              <span className="min-w-0 truncate text-text">{item.node.title}</span>
            </>
          )}
          <span className="text-muted">{KIND_LABEL[q.kind]}</span>
          {mode === "mistakes" && phase.step !== "done" && <Badge tone={item.last.outcome === "partial" ? "warn" : "bad"}>в прошлый раз {item.last.outcome === "partial" ? "частично" : "неверно"}</Badge>}
          {!!item.overdueDays && phase.step !== "done" && <span className="text-muted">просрочено на {item.overdueDays} дн.</span>}
          <span className="flex-1" />
          {phase.step === "done" && <Mark tone={OUTCOME[phase.outcome].tone}>{OUTCOME[phase.outcome].label}</Mark>}
        </div>

        <div className="space-y-4 p-3 sm:p-4">
          <Markdown text={q.prompt} className="text-[15px] text-bright" />

          {phase.step === "answer" && (
            <ActiveQuestion
              key={item.attemptId}
              item={{ type: "question", attemptId: item.attemptId, question: q, answer: null, outcome: null, autoGraded: false, pending: true }}
              seed={seeds[index]}
              busy={busy}
              submitLabel={selfGraded ? "Сравнить с эталоном" : undefined}
              onAnswer={(a) => (selfGraded ? setPhase({ step: "self", answer: a }) : record(a))}
              onInvalid={(detail) => skip(`Вопрос пропущен: он больше не проходит проверку (${detail})`)}
            />
          )}

          {phase.step === "self" && (
            <div className="appear space-y-3">
              <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
                <div className="mb-1 text-xs text-muted">Твой ответ</div>
                <Markdown text={(phase.answer.text ?? "").replace(/\n/g, "  \n")} />
              </div>
              <Reference item={item} />
              <div>
                <div className="mb-1.5 text-[13px] text-bright">Насколько твой ответ совпал с эталоном?</div>
                <div className="flex flex-wrap gap-2">
                  {SELF.map(([g, label, key]) => (
                    <Button key={g} variant={g === "correct" ? "primary" : "secondary"} disabled={busy} onClick={() => record(phase.answer, g)}>
                      {label}
                      <Kbd className="ml-1 hidden sm:inline">{key}</Kbd>
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {phase.step === "done" && answered && (
            <div className="space-y-3">
              <AnsweredQuestion item={answered} />
              {selfGraded ? (
                <Reference item={item} />
              ) : (
                q.kind !== "choice" && q.explanation && <Markdown text={q.explanation} className="appear text-sm text-muted" />
              )}
              {mode === "mistakes" && item.last.misconception && (
                <p className="appear text-sm text-muted">
                  В прошлый раз: <span className="text-text">{item.last.misconception}</span>
                </p>
              )}
              {phase.status && STATUS_RU[phase.status] && <p className="appear text-xs text-muted">{item.node?.title}: {STATUS_RU[phase.status]}</p>}
            </div>
          )}

          {error && (
            <div className="enter">
              <Notice tone="bad">{error}</Notice>
            </div>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        {phase.step === "done" ? (
          <Button variant="primary" onClick={() => next()} autoFocus>
            {last ? "Завершить" : "Дальше"}
            <Kbd className="ml-1 hidden sm:inline">Enter</Kbd>
          </Button>
        ) : (
          <Button variant="ghost" small onClick={() => skip()} disabled={busy}>
            Пропустить
          </Button>
        )}
      </div>
    </div>
  );
}
