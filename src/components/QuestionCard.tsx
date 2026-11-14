"use client";

import { useEffect, useMemo, useState } from "react";
import { parsonsLines, seededShuffle } from "@/lib/grading";
import { runCode, type RunOutcome } from "@/lib/runner";
import { KIND_LABEL, PURPOSE_LABEL, type AnswerPayload, type Outcome, type Question, type TranscriptItem } from "@/lib/types";
import { CodeEditor } from "./CodeEditor";
import { Markdown } from "./Markdown";
import { Badge, Button, cx, Dots, inputClass, Notice } from "./ui";

type QItem = Extract<TranscriptItem, { type: "question" }>;

const OUTCOME: Record<Outcome, { label: string; tone: "ok" | "bad" | "warn" | "neutral" }> = {
  correct: { label: "Верно", tone: "ok" },
  partial: { label: "Частично", tone: "warn" },
  wrong: { label: "Неверно", tone: "bad" },
  skipped: { label: "Пропущен", tone: "neutral" },
};

function Header({ q, outcome, waiting }: { q: Question; outcome?: Outcome | null; waiting?: boolean }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Badge tone="accent">{PURPOSE_LABEL[q.purpose]}</Badge>
      <Badge>{KIND_LABEL[q.kind]}</Badge>
      {outcome ? <Badge tone={OUTCOME[outcome].tone}>{OUTCOME[outcome].label}</Badge> : waiting ? <Badge tone="warn">Ждёт оценки</Badge> : null}
    </div>
  );
}

function Output({ label, text, tone }: { label: string; text: string; tone?: "bad" }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted">{label}</div>
      <pre
        className={cx(
          "max-h-60 overflow-auto rounded-lg border px-3 py-2 font-mono text-[13px] whitespace-pre-wrap",
          tone === "bad" ? "border-bad bg-bad-soft text-bad" : "border-border bg-code",
        )}
      >
        {text || "(пусто)"}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pre-show verification: runnable questions are checked before the learner
// sees them, so a broken reference solution never becomes the learner's problem.
// ---------------------------------------------------------------------------

type Prep = { state: "ready"; actualOutput?: string } | { state: "invalid"; detail: string } | { state: "infra"; detail: string };
const prepCache = new Map<number, Promise<Prep>>();
const reported = new Set<number>();

async function prepare(q: Question): Promise<Prep> {
  const lang = q.language!;
  const infra = (r: RunOutcome): Prep => ({ state: "infra", detail: r.error ?? "" });
  if (q.kind === "predict_output") {
    const r = await runCode(lang, q.code ?? "");
    if (r.infra) return infra(r);
    if (!r.ok) return { state: "invalid", detail: `Программа из code завершается с ошибкой: ${r.error}` };
    if (!r.stdout.trim()) return { state: "invalid", detail: "Программа из code ничего не печатает." };
    return { state: "ready", actualOutput: r.stdout };
  }
  if (q.kind === "code" || q.kind === "find_bug") {
    const sol = await runCode(lang, q.solution ?? "", q.tests);
    if (sol.infra) return infra(sol);
    if (!sol.ok) return { state: "invalid", detail: `Эталонное solution не проходит tests: ${sol.error}` };
    if (q.kind === "find_bug") {
      const bug = await runCode(lang, q.code ?? "", q.tests);
      if (bug.infra) return infra(bug);
      if (bug.ok) return { state: "invalid", detail: "Программа с ошибкой (code) проходит tests: тесты не ловят ошибку." };
    }
  }
  return { state: "ready" };
}

// ---------------------------------------------------------------------------

function ActiveQuestion({
  item,
  busy,
  onAnswer,
  onInvalid,
}: {
  item: QItem;
  busy: boolean;
  onAnswer: (a: AnswerPayload) => void;
  onInvalid: (detail: string) => void;
}) {
  const q = item.question;
  const runnable = q.kind === "code" || q.kind === "find_bug" || q.kind === "predict_output";

  const [prep, setPrep] = useState<Prep | null>(runnable ? null : { state: "ready" });
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [code, setCode] = useState(q.kind === "code" || q.kind === "find_bug" ? (q.code ?? "") : "");
  const [rows, setRows] = useState(() =>
    seededShuffle([...parsonsLines(q.solution ?? ""), ...(q.distractors ?? [])], item.attemptId).map((t) => ({ text: t, used: true })),
  );
  const [hints, setHints] = useState(0);
  const [confidence, setConfidence] = useState<1 | 2 | 3 | null>(null);
  const [thinking, setThinking] = useState("");
  const [showThinking, setShowThinking] = useState(false);
  const [run, setRun] = useState<RunOutcome | null>(null);
  const [working, setWorking] = useState<null | "run" | "submit">(null);
  const [problem, setProblem] = useState<string | null>(null);

  const order = useMemo(
    () => seededShuffle((q.options ?? []).map((_, i) => i), item.attemptId),
    [q.options, item.attemptId],
  );

  useEffect(() => {
    if (!runnable) return;
    let alive = true;
    let p = prepCache.get(item.attemptId);
    if (!p) {
      p = prepare(q);
      prepCache.set(item.attemptId, p);
    }
    p.then((r) => {
      if (!alive) return;
      setPrep(r);
      // Report a broken question once, even if this card remounts.
      if (r.state === "invalid" && !reported.has(item.attemptId)) {
        reported.add(item.attemptId);
        onInvalid(r.detail);
      }
      if (r.state === "infra") prepCache.delete(item.attemptId);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.attemptId]);

  if (!prep || prep.state === "invalid") {
    return (
      <div className="flex items-center gap-3 text-sm text-muted">
        <Dots /> {prep ? "Задача не прошла проверку, репетитор исправляет…" : "Готовлю задачу (первый запуск Python занимает несколько секунд)…"}
      </div>
    );
  }
  if (prep.state === "infra") {
    return (
      <div className="space-y-3">
        <Notice tone="warn">
          Не удалось загрузить среду выполнения кода. {prep.detail}
        </Notice>
        <Button
          onClick={() => {
            setPrep(null);
            const p = prepare(q);
            prepCache.set(item.attemptId, p);
            p.then((r) => {
              setPrep(r);
              if (r.state === "invalid" && !reported.has(item.attemptId)) {
                reported.add(item.attemptId);
                onInvalid(r.detail);
              }
            });
          }}
        >
          Повторить
        </Button>
      </div>
    );
  }

  const common = (): Pick<AnswerPayload, "confidence" | "hintsUsed" | "thinking"> => ({
    confidence,
    hintsUsed: hints,
    thinking: thinking.trim() || undefined,
  });

  const canSubmit =
    !busy &&
    !working &&
    (q.kind === "choice"
      ? choice !== null
      : q.kind === "parsons"
        ? rows.some((r) => r.used)
        : q.kind === "code" || q.kind === "find_bug"
          ? code.trim() !== ""
          : text.trim() !== "");

  const submit = async () => {
    setProblem(null);
    if (q.kind === "choice") return onAnswer({ choice: choice!, ...common() });
    if (q.kind === "parsons") return onAnswer({ lines: rows.filter((r) => r.used).map((r) => r.text), ...common() });
    if (q.kind === "predict_output") return onAnswer({ text, actualOutput: prep.actualOutput, ...common() });
    if (q.kind === "code" || q.kind === "find_bug") {
      setWorking("submit");
      const r = await runCode(q.language!, code, q.tests);
      setWorking(null);
      if (r.infra) return setProblem("Не удалось запустить код: " + (r.error ?? ""));
      setRun(r);
      return onAnswer({ code, run: { ok: r.ok, stdout: r.stdout, error: r.error, timedOut: r.timedOut }, ...common() });
    }
    onAnswer({ text, ...common() });
  };

  const tryRun = async () => {
    setWorking("run");
    setRun(await runCode(q.language!, code));
    setWorking(null);
  };

  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <div className="space-y-4">
      {q.kind === "predict_output" && <CodeEditor value={q.code ?? ""} language={q.language} readOnly />}

      {q.kind === "choice" && (
        <div className="space-y-2" role="radiogroup">
          {order.map((idx) => (
            <button
              key={idx}
              role="radio"
              aria-checked={choice === idx}
              onClick={() => setChoice(idx)}
              className={cx(
                "flex min-h-12 w-full items-start gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors",
                choice === idx ? "border-accent bg-accent-soft" : "border-border bg-surface hover:bg-surface-2",
              )}
            >
              <span className={cx("mt-1 size-4 shrink-0 rounded-full border-2", choice === idx ? "border-accent bg-accent" : "border-muted")} />
              <Markdown text={q.options![idx]} className="min-w-0 flex-1" />
            </button>
          ))}
        </div>
      )}

      {(q.kind === "free" || q.kind === "math") && (
        <div className="space-y-2">
          <textarea
            className={cx(inputClass, "min-h-32 resize-y", q.kind === "math" && "font-mono text-[15px]")}
            placeholder={q.kind === "math" ? "Пиши решение по шагам, каждый шаг с новой строки. Формулы можно в $...$" : "Твой ответ своими словами"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {q.kind === "math" && text.includes("$") && (
            <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
              <div className="mb-1 text-xs text-muted">Как это выглядит</div>
              <Markdown text={text.replace(/\n/g, "  \n")} />
            </div>
          )}
        </div>
      )}

      {q.kind === "predict_output" && (
        <textarea
          className={cx(inputClass, "min-h-20 resize-y font-mono text-[15px]")}
          placeholder="Что напечатает программа? Точно, построчно"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      )}

      {(q.kind === "code" || q.kind === "find_bug") && (
        <div className="space-y-3">
          <CodeEditor value={code} onChange={setCode} language={q.language} minHeight="160px" />
          <Button small onClick={tryRun} disabled={!!working || busy}>
            {working === "run" ? "Запускаю…" : "▶ Запустить"}
          </Button>
          {run && (
            <div className="space-y-2">
              {run.stdout && <Output label="Вывод" text={run.stdout} />}
              {run.error && <Output label="Ошибка" text={run.error} tone="bad" />}
              {!run.stdout && !run.error && <div className="text-sm text-muted">Выполнено без вывода.</div>}
            </div>
          )}
        </div>
      )}

      {q.kind === "parsons" && (
        <div className="space-y-1.5">
          <div className="text-sm text-muted">
            Расставь строки в правильном порядке кнопками ↑ ↓.{q.distractors?.length ? " Лишние строки отключи галочкой." : ""}
          </div>
          {rows.map((r, i) => (
            <div key={`${i}-${r.text}`} className={cx("flex items-stretch gap-1.5", !r.used && "opacity-45")}>
              {!!q.distractors?.length && (
                <label className="grid w-10 shrink-0 place-items-center rounded-lg border border-border bg-surface">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={r.used}
                    aria-label="Использовать строку"
                    onChange={() => setRows((rs) => rs.map((x, k) => (k === i ? { ...x, used: !x.used } : x)))}
                  />
                </label>
              )}
              <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-code px-3 py-2.5 font-mono text-[13px] whitespace-pre">
                {r.text}
              </pre>
              <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Выше" className="w-11 shrink-0 rounded-lg border border-border bg-surface disabled:opacity-30">
                ↑
              </button>
              <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Ниже" className="w-11 shrink-0 rounded-lg border border-border bg-surface disabled:opacity-30">
                ↓
              </button>
            </div>
          ))}
        </div>
      )}

      {!!q.hints?.length && (
        <div className="space-y-2">
          {q.hints.slice(0, hints).map((h, i) => (
            <div key={i} className="rounded-lg bg-warn-soft px-3 py-2 text-sm">
              <span className="font-medium text-warn">Подсказка {i + 1}. </span>
              <Markdown text={h} className="inline [&>p]:inline" />
            </div>
          ))}
          {hints < q.hints.length && (
            <Button small variant="ghost" onClick={() => setHints((n) => n + 1)}>
              Показать подсказку ({hints + 1} из {q.hints.length})
            </Button>
          )}
        </div>
      )}

      <div className="space-y-3 border-t border-border pt-4">
        <div>
          <div className="mb-1.5 text-sm text-muted">Насколько уверен в ответе?</div>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                [1, "Угадываю"],
                [2, "Скорее да"],
                [3, "Уверен"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setConfidence(confidence === v ? null : v)}
                aria-pressed={confidence === v}
                className={cx(
                  "min-h-11 rounded-lg border px-2 text-sm transition-colors",
                  confidence === v ? "border-accent bg-accent-soft font-medium text-accent" : "border-border bg-surface text-muted hover:bg-surface-2",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {showThinking ? (
          <textarea
            className={cx(inputClass, "min-h-20 resize-y")}
            placeholder="Мысли вслух: как рассуждал, в чём сомневаешься. Репетитор учтёт это."
            value={thinking}
            onChange={(e) => setThinking(e.target.value)}
            autoFocus
          />
        ) : (
          <Button small variant="ghost" onClick={() => setShowThinking(true)}>
            + Мысли вслух
          </Button>
        )}

        {problem && <Notice tone="bad">{problem}</Notice>}

        <Button variant="primary" className="w-full sm:w-auto" disabled={!canSubmit} onClick={submit}>
          {working === "submit" ? "Проверяю…" : q.kind === "code" || q.kind === "find_bug" ? "Проверить и ответить" : "Ответить"}
        </Button>
      </div>
    </div>
  );
}

function AnsweredQuestion({ item }: { item: QItem }) {
  const q = item.question;
  const a = item.answer;
  if (!a) return <div className="text-sm text-muted">Без ответа.</div>;
  return (
    <div className="space-y-3">
      {q.kind === "choice" && (
        <div className="space-y-1.5">
          {q.options!.map((o, i) => {
            const chosen = a.choice === i;
            const right = q.correct_option === i;
            return (
              <div
                key={i}
                className={cx(
                  "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
                  right ? "border-ok bg-ok-soft" : chosen ? "border-bad bg-bad-soft" : "border-border",
                )}
              >
                <span className="w-4 shrink-0 font-medium">{right ? "✓" : chosen ? "✗" : ""}</span>
                <Markdown text={o} className="min-w-0 flex-1" />
                {chosen && <span className="shrink-0 text-xs text-muted">твой ответ</span>}
              </div>
            );
          })}
          {q.explanation && <Markdown text={q.explanation} className="pt-1 text-sm text-muted" />}
        </div>
      )}
      {q.kind === "predict_output" && (
        <>
          <CodeEditor value={q.code ?? ""} language={q.language} readOnly />
          <div className="grid gap-3 sm:grid-cols-2">
            <Output label="Твой ответ" text={a.text ?? ""} />
            <Output label="Вывод программы" text={a.actualOutput ?? ""} />
          </div>
        </>
      )}
      {(q.kind === "code" || q.kind === "find_bug") && (
        <>
          <CodeEditor value={a.code ?? ""} language={q.language} readOnly />
          {a.run?.error && <Output label="Результат проверки" text={a.run.error} tone="bad" />}
        </>
      )}
      {q.kind === "parsons" && (
        <>
          <Output label="Твой порядок" text={(a.lines ?? []).join("\n")} />
          {item.outcome === "wrong" && <Output label="Правильная программа" text={parsonsLines(q.solution ?? "").join("\n")} />}
        </>
      )}
      {(q.kind === "free" || q.kind === "math") && (
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
          <div className="mb-1 text-xs text-muted">Твой ответ</div>
          <Markdown text={(a.text ?? "").replace(/\n/g, "  \n")} />
        </div>
      )}
      {(a.hintsUsed || a.confidence) && (
        <div className="text-xs text-muted">
          {a.confidence ? `Уверенность: ${["угадывал", "скорее да", "уверен"][a.confidence - 1]}` : ""}
          {a.confidence && a.hintsUsed ? " · " : ""}
          {a.hintsUsed ? `подсказок: ${a.hintsUsed}` : ""}
        </div>
      )}
    </div>
  );
}

export function QuestionCard({
  item,
  busy,
  onAnswer,
  onInvalid,
}: {
  item: QItem;
  busy: boolean;
  onAnswer: (attemptId: number, a: AnswerPayload) => void;
  onInvalid: (attemptId: number, detail: string) => void;
}) {
  const q = item.question;
  return (
    <section className={cx("rounded-xl border bg-surface p-4 sm:p-5", item.pending ? "border-accent" : "border-border")}>
      <Header q={q} outcome={item.pending ? null : item.outcome} waiting={!item.pending && !item.outcome && !!item.answer} />
      <Markdown text={q.prompt} className="mb-4" />
      {item.pending ? (
        <ActiveQuestion
          key={item.attemptId}
          item={item}
          busy={busy}
          onAnswer={(a) => onAnswer(item.attemptId, a)}
          onInvalid={(d) => onInvalid(item.attemptId, d)}
        />
      ) : (
        <AnsweredQuestion item={item} />
      )}
    </section>
  );
}
