"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parsonsLines, seededShuffle } from "@/lib/grading";
import { runCode, type RunOutcome } from "@/lib/runner";
import { KIND_LABEL, PURPOSE_LABEL, type AnswerPayload, type Outcome, type Question, type TranscriptItem } from "@/lib/types";
import { openInSandbox } from "@/lib/sandbox";
import { CodeEditor } from "./CodeEditor";
import { EditorFrame, toolButton } from "./EditorTools";
import { Markdown } from "./Markdown";
import { PhotoButton } from "./PhotoButton";
import { FormulaButton, insertAtCursor } from "./FormulaButton";
import { Badge, Button, cx, Dots, Icon, inputClass, isKey, isSubmitKey, Kbd, KeyHandler, Mark, Notice, Segmented } from "./ui";

export type QItem = Extract<TranscriptItem, { type: "question" }>;

export const OUTCOME: Record<Outcome, { label: string; tone: "ok" | "bad" | "warn" | "neutral"; edge: string }> = {
  correct: { label: "Верно", tone: "ok", edge: "border-l-ok" },
  partial: { label: "Частично", tone: "warn", edge: "border-l-warn" },
  wrong: { label: "Неверно", tone: "bad", edge: "border-l-bad" },
  skipped: { label: "Пропущен", tone: "neutral", edge: "border-l-border-strong" },
};

function Header({ q, outcome, waiting }: { q: Question; outcome?: Outcome | null; waiting?: boolean }) {
  return (
    <div className="flex min-h-8 items-center gap-2.5 border-b border-border bg-surface px-3 text-xs">
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5">
        <span className="font-semibold text-accent">{PURPOSE_LABEL[q.purpose]}</span>
        <span className="text-muted">{KIND_LABEL[q.kind]}</span>
      </div>
      {outcome ? <Mark tone={OUTCOME[outcome].tone}>{OUTCOME[outcome].label}</Mark> : waiting ? <Badge tone="warn">Ждёт оценки</Badge> : null}
    </div>
  );
}

const Arrow = ({ up }: { up?: boolean }) => <Icon name={up ? "up" : "down"} className="mx-auto" />;

export function Output({ label, text, tone }: { label: string; text: string; tone?: "bad" }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted">{label}</div>
      <pre
        className={cx(
          "max-h-60 overflow-auto rounded-sm border px-3 py-2 font-mono text-[13px] whitespace-pre-wrap",
          tone === "bad" ? "border-bad/50 bg-bad-soft text-bad" : "border-border bg-surface",
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

export function ActiveQuestion({
  item,
  busy,
  onAnswer,
  onInvalid,
  submitLabel,
  seed,
  noHints,
}: {
  item: QItem;
  busy: boolean;
  onAnswer: (a: AnswerPayload) => void;
  onInvalid: (detail: string) => void;
  submitLabel?: string;
  /** Shuffle seed; defaults to the attempt id so a reload shows the same order. */
  seed?: number;
  /** Exam: hints are not offered. */
  noHints?: boolean;
}) {
  const q = item.question;
  const runnable = q.kind === "code" || q.kind === "find_bug" || q.kind === "predict_output";

  const [prep, setPrep] = useState<Prep | null>(runnable ? null : { state: "ready" });
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState("");
  const answerBox = useRef<HTMLTextAreaElement>(null);
  const [code, setCode] = useState(q.kind === "code" || q.kind === "find_bug" ? (q.code ?? "") : "");
  const [rows, setRows] = useState(() =>
    seededShuffle([...parsonsLines(q.solution ?? ""), ...(q.distractors ?? [])], seed ?? item.attemptId).map((t) => ({ text: t, used: true })),
  );
  const [hints, setHints] = useState(0);
  const [confidence, setConfidence] = useState<1 | 2 | 3 | null>(null);
  const [thinking, setThinking] = useState("");
  const [showThinking, setShowThinking] = useState(false);
  const [run, setRun] = useState<RunOutcome | null>(null);
  const [working, setWorking] = useState<null | "run" | "submit">(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  // The code the last run was of: an error line is marked only while the code is unchanged.
  const [ranCode, setRanCode] = useState<string | null>(null);

  const order = useMemo(
    () => seededShuffle((q.options ?? []).map((_, i) => i), seed ?? item.attemptId),
    [q.options, item.attemptId, seed],
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
      setRanCode(code);
      return onAnswer({ code, run: { ok: r.ok, stdout: r.stdout, error: r.error, timedOut: r.timedOut }, ...common() });
    }
    onAnswer({ text, ...common() });
  };

  const tryRun = async () => {
    setWorking("run");
    const snapshot = code;
    setRun(await runCode(q.language!, snapshot));
    setRanCode(snapshot);
    setWorking(null);
  };
  const errorLine = run?.errorAt && ranCode === code ? run.errorAt.line : null;

  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const hintsLeft = noHints ? 0 : (q.hints?.length ?? 0) - hints;
  const onKey = (e: KeyboardEvent, typing: boolean) => {
    if (isSubmitKey(e)) {
      if (canSubmit) {
        e.preventDefault();
        submit();
      }
      return;
    }
    if (typing || e.ctrlKey || e.metaKey) return;
    if (q.kind === "choice" && /^[1-9]$/.test(e.key) && Number(e.key) <= order.length) {
      e.preventDefault();
      setChoice(order[Number(e.key) - 1]);
    } else if (q.kind === "choice" && e.key === "Enter" && canSubmit && (e.target as HTMLElement)?.tagName !== "BUTTON") {
      e.preventDefault();
      submit();
    } else if (isKey(e, "h") && hintsLeft > 0) {
      e.preventDefault();
      setHints((n) => n + 1);
    }
  };

  return (
    <div className="space-y-4">
      <KeyHandler onKey={onKey} />
      {q.kind === "predict_output" && <CodeEditor value={q.code ?? ""} language={q.language} readOnly />}

      {q.kind === "choice" && (
        <div className="space-y-2" role="radiogroup">
          {order.map((idx, pos) => (
            <button
              key={idx}
              role="radio"
              aria-checked={choice === idx}
              onClick={() => setChoice(idx)}
              className={cx(
                "group flex min-h-10 w-full items-start gap-3 rounded-sm border px-2.5 py-2 text-left transition-colors",
                choice === idx ? "border-accent bg-accent-soft text-bright" : "border-transparent bg-surface hover:bg-surface-2",
              )}
            >
              <span
                className={cx(
                  "grid size-6 shrink-0 place-items-center rounded-sm font-mono text-xs transition-colors",
                  choice === idx ? "bg-accent-strong text-accent-fg" : "bg-surface-2 text-muted group-hover:text-bright",
                )}
                aria-hidden
              >
                {pos + 1}
              </span>
              <Markdown text={q.options![idx]} className="min-w-0 flex-1 pt-0.5" />
            </button>
          ))}
        </div>
      )}

      {(q.kind === "free" || q.kind === "math") && (
        <div className="space-y-2">
          <textarea
            ref={answerBox}
            className={cx(inputClass, "min-h-32 resize-y", q.kind === "math" && "font-mono text-[15px]")}
            placeholder={q.kind === "math" ? "Пиши решение по шагам, каждый шаг с новой строки. Формулы можно в $...$" : "Твой ответ своими словами"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap items-start gap-2">
            <FormulaButton
              onInsert={(s) => {
                const r = insertAtCursor(answerBox.current, text, s);
                setText(r.value);
                requestAnimationFrame(() => {
                  answerBox.current?.focus();
                  answerBox.current?.setSelectionRange(r.caret, r.caret);
                });
              }}
            />
            <PhotoButton context={q.prompt} onText={(t) => setText((cur) => (cur.trim() ? `${cur.trimEnd()}\n\n${t}` : t))} />
          </div>
          {(q.kind === "math" || q.kind === "free") && text.includes("$") && (
            <div className="rounded-md border border-dashed border-border-strong px-3 py-2">
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
          <EditorFrame
            full={full}
            onFull={setFull}
            title={<span className="font-mono">{q.language === "python" ? "Python" : "JavaScript"}</span>}
            actions={
              <>
                {code !== (q.code ?? "") && (
                  <button type="button" className={toolButton} onClick={() => setCode(q.code ?? "")} title="Вернуть исходную заготовку">
                    Сбросить
                  </button>
                )}
                <button type="button" className={toolButton} onClick={() => openInSandbox(q.language!, code)} title="Открыть этот код в песочнице">
                  В песочницу
                </button>
              </>
            }
          >
            <CodeEditor
              value={code}
              onChange={setCode}
              language={q.language}
              minHeight="160px"
              fill={full}
              errorLine={errorLine}
              errorMessage={run?.error?.split("\n").filter(Boolean).at(-1)}
            />
          </EditorFrame>
          {full && (
            // The run button and output stay reachable over the full-screen editor.
            <div className="fixed right-4 bottom-4 z-[60] flex max-w-[min(560px,90vw)] flex-col items-end gap-2">
              {run && (run.stdout || run.error) && (
                <pre className={cx("max-h-48 w-full overflow-auto rounded-sm border px-3 py-2 font-mono text-[12px] whitespace-pre-wrap shadow-widget", run.error ? "border-bad/50 bg-bad-soft text-bad" : "border-border bg-surface")}>
                  {run.stdout}
                  {run.error}
                </pre>
              )}
              <Button variant="primary" onClick={tryRun} disabled={!!working || busy}>
                <Icon name="play" /> {working === "run" ? "Запускаю…" : "Запустить"}
              </Button>
            </div>
          )}
          <Button small onClick={tryRun} disabled={!!working || busy}>
            <Icon name="play" className="text-ok" />
            {working === "run" ? "Запускаю…" : "Запустить"}
          </Button>
          {run && (
            <div className="space-y-2">
              {run.stdout && <Output label="Вывод" text={run.stdout} />}
              {run.error && <Output label={run.errorAt ? `Ошибка в строке ${run.errorAt.line}` : "Ошибка"} text={run.error} tone="bad" />}
              {!run.stdout && !run.error && <div className="text-sm text-muted">Выполнено без вывода.</div>}
            </div>
          )}
        </div>
      )}

      {q.kind === "parsons" && (
        <div className="space-y-1.5">
          <div className="text-sm text-muted">
            Расставь строки в правильном порядке стрелками.{q.distractors?.length ? " Лишние строки отключи галочкой." : ""}
          </div>
          {rows.map((r, i) => (
            <div key={`${i}-${r.text}`} className={cx("flex items-stretch gap-1.5", !r.used && "opacity-45")}>
              {!!q.distractors?.length && (
                <label className="grid w-10 shrink-0 place-items-center rounded-sm border border-border bg-surface">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={r.used}
                    aria-label="Использовать строку"
                    onChange={() => setRows((rs) => rs.map((x, k) => (k === i ? { ...x, used: !x.used } : x)))}
                  />
                </label>
              )}
              <pre className="min-w-0 flex-1 overflow-x-auto rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[13px] whitespace-pre">
                {r.text}
              </pre>
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Выше"
                className="w-11 shrink-0 rounded-md border border-border-strong bg-surface text-muted hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-30"
              >
                <Arrow up />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === rows.length - 1}
                aria-label="Ниже"
                className="w-11 shrink-0 rounded-md border border-border-strong bg-surface text-muted hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-30"
              >
                <Arrow />
              </button>
            </div>
          ))}
        </div>
      )}

      {!!q.hints?.length && !noHints && (
        <div className="space-y-2">
          {q.hints.slice(0, hints).map((h, i) => (
            <div key={i} className="enter rounded-r-md border-l-3 border-warn bg-warn-soft px-3 py-2 text-sm">
              <span className="font-semibold text-warn">Подсказка {i + 1}. </span>
              <Markdown text={h} className="inline [&>p]:inline" />
            </div>
          ))}
          {hints < q.hints.length && (
            <Button small variant="ghost" onClick={() => setHints((n) => n + 1)}>
              Показать подсказку {hints + 1} из {q.hints.length}
            </Button>
          )}
        </div>
      )}

      <div className="space-y-3 border-t border-border pt-4">
        <div>
          <div className="mb-1 text-[13px] text-muted">Насколько уверен в ответе?</div>
          <Segmented
            label="Уверенность"
            value={confidence}
            onChange={(v) => setConfidence(confidence === v ? null : v)}
            options={
              [
                [1, "Угадываю"],
                [2, "Скорее да"],
                [3, "Уверен"],
              ] as const
            }
          />
        </div>

        {showThinking ? (
          <textarea
            className={cx(inputClass, "enter min-h-20 resize-y")}
            placeholder="Мысли вслух: как рассуждал, в чём сомневаешься. Репетитор учтёт это."
            value={thinking}
            onChange={(e) => setThinking(e.target.value)}
            autoFocus
          />
        ) : (
          <Button small variant="ghost" onClick={() => setShowThinking(true)}>
            Добавить мысли вслух
          </Button>
        )}

        {problem && (
          <div className="enter">
            <Notice tone="bad">{problem}</Notice>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button variant="primary" className="w-full sm:w-auto" disabled={!canSubmit} onClick={submit}>
            {working === "submit" ? "Проверяю…" : (submitLabel ?? (q.kind === "code" || q.kind === "find_bug" ? "Проверить и ответить" : "Ответить"))}
          </Button>
          <span className="hidden items-center gap-3 text-xs text-muted sm:flex" aria-hidden>
            {q.kind === "choice" && (
              <span>
                <Kbd>1</Kbd>–<Kbd>{Math.min(order.length, 9)}</Kbd> выбрать
              </span>
            )}
            <span>
              <Kbd>Ctrl+Enter</Kbd> ответить
            </span>
            {hintsLeft > 0 && (
              <span>
                <Kbd>H</Kbd> подсказка
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

export function AnsweredQuestion({ item }: { item: QItem }) {
  const q = item.question;
  const a = item.answer;
  if (!a) return <div className="text-sm text-muted">Без ответа.</div>;
  return (
    <div className="appear space-y-3">
      {q.kind === "choice" && (
        <div className="space-y-1.5">
          {q.options!.map((o, i) => {
            const chosen = a.choice === i;
            const right = q.correct_option === i;
            return (
              <div
                key={i}
                className={cx(
                  "flex items-start gap-2 rounded-sm border px-2.5 py-1.5",
                  right ? "border-ok/60 bg-ok-soft" : chosen ? "border-bad/60 bg-bad-soft" : "border-border",
                )}
              >
                <span className={cx("mt-[3px] w-4 shrink-0", right ? "text-ok" : "text-bad")} aria-label={right ? "верный ответ" : chosen ? "неверно" : undefined}>
                  {(right || chosen) && <Icon name={right ? "check" : "cross"} className="[stroke-width:1.8]" />}
                </span>
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
        <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
          <div className="mb-1 text-xs text-muted">Твой ответ</div>
          <Markdown text={(a.text ?? "").replace(/\n/g, "  \n")} />
        </div>
      )}
      {(a.hintsUsed || a.confidence) && (
        <div className="text-xs text-muted">
          {a.confidence ? `Уверенность: ${["угадывал", "скорее да", "уверен"][a.confidence - 1]}` : ""}
          {a.confidence && a.hintsUsed ? ", " : ""}
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
    // A notebook cell: the focused one has the accent bar, a finished one carries its result colour.
    <section
      className={cx(
        "overflow-hidden rounded-sm border border-l-2 bg-bg transition-colors duration-300",
        item.pending ? "attention border-accent" : cx("border-border", item.outcome ? OUTCOME[item.outcome].edge : "border-l-border-strong"),
      )}
    >
      <Header q={q} outcome={item.pending ? null : item.outcome} waiting={!item.pending && !item.outcome && !!item.answer} />
      <div className="p-3 sm:p-4">
      <Markdown text={q.prompt} className="mb-4 text-[15px] text-bright" />
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
      </div>
    </section>
  );
}
