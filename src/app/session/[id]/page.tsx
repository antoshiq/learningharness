"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookViewer } from "@/components/BookViewer";
import { Markdown } from "@/components/Markdown";
import { BOOK_HREF, linkPages, type LinkBook } from "@/lib/book-links";
import { PlanGraph } from "@/components/PlanGraph";
import { QuestionCard } from "@/components/QuestionCard";
import { Button, Count, cx, Dots, Icon, inputClass, LinkButton, Loading, Notice, Sheet, StatusItem, TopNav } from "@/components/ui";
import { notifyChanged } from "@/components/workbench-context";
import { api, formatCost, formatTokens, streamPost } from "@/lib/api";
import type { AnswerPayload, TranscriptItem, TurnInput } from "@/lib/types";
import { excerptOf, type StepFeedbackKind } from "@/lib/feedback";
import type { SessionView } from "@/server/sessions";

const KIND = { lesson: "Урок", practice: "Практика", review: "Повторение" } as const;

/** The tutor's text; with books, "стр. 142" opens the book at that page. */
function Prose({ text, books, onBook, className }: { text: string; books: LinkBook[]; onBook: (book: number, page: number) => void; className: string }) {
  if (!books.length) return <Markdown text={text} className={className} />;
  return (
    <Markdown
      text={linkPages(text, books)}
      className={className}
      components={{
        a: ({ href, children }) => {
          const m = BOOK_HREF.exec(href ?? "");
          if (!m) return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
          return (
            <button type="button" onClick={() => onBook(Number(m[1]), Number(m[2]))} className="text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid" title="Открыть страницу книги">
              {children}
            </button>
          );
        },
      }}
    />
  );
}

const MARKS: { kind: StepFeedbackKind; label: string; title: string }[] = [
  { kind: "unclear", label: "Непонятно", title: "Репетитор объяснит это место иначе" },
  { kind: "too_long", label: "Длинно", title: "Репетитор будет объяснять короче" },
  { kind: "wrong", label: "Ошибка", title: "В объяснении ошибка: репетитор перепроверит и исправит" },
];

/** Quiet marks under a step; the tutor reads them with the next action. */
function StepMarks({ text, marked, onMark }: { text: string; marked: Set<string>; onMark: (kind: StepFeedbackKind, text: string) => void }) {
  const ex = excerptOf(text);
  const any = MARKS.some((m) => marked.has(`${m.kind}:${ex}`));
  return (
    <div className={cx("-mt-3 flex items-center gap-1 transition-opacity", any ? "opacity-100" : "opacity-40 hover:opacity-100 focus-within:opacity-100")}>
      {MARKS.map((m) => {
        const on = marked.has(`${m.kind}:${ex}`);
        return (
          <button
            key={m.kind}
            type="button"
            onClick={() => onMark(m.kind, text)}
            title={on ? "Отметка стоит. Нажми ещё раз, чтобы убрать" : m.title}
            aria-pressed={on}
            className={cx(
              "rounded-sm px-1.5 py-0.5 text-xs",
              on ? (m.kind === "wrong" ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn") : "text-muted hover:bg-surface-2 hover:text-bright",
            )}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function Item({
  item,
  busy,
  onAnswer,
  onInvalid,
  books,
  onBook,
  marked,
  onMark,
}: {
  item: TranscriptItem;
  busy: boolean;
  onAnswer: (id: number, a: AnswerPayload) => void;
  onInvalid: (id: number, d: string) => void;
  books: LinkBook[];
  onBook: (book: number, page: number) => void;
  marked: Set<string>;
  onMark: (kind: StepFeedbackKind, text: string) => void;
}) {
  if (item.type === "assistant") {
    return (
      <>
        <Prose text={item.text} className="prose-lesson" books={books} onBook={onBook} />
        <StepMarks text={item.text} marked={marked} onMark={onMark} />
      </>
    );
  }
  if (item.type === "user") return <Said>{item.text}</Said>;
  if (item.type === "event") {
    return (
      <div className="enter flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-border" />
        {item.text}
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }
  return (
    <>
      <QuestionCard item={item} busy={busy} onAnswer={onAnswer} onInvalid={onInvalid} />
      <StepMarks text={item.question.prompt} marked={marked} onMark={onMark} />
    </>
  );
}

/** The learner's own words, set against the right edge like a chat request. */
function Said({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return (
    <div
      className={cx(
        "enter ml-auto w-fit max-w-[85%] rounded-md bg-accent-soft whitespace-pre-wrap text-bright",
        small ? "px-3 py-1.5 text-sm" : "px-3.5 py-2",
      )}
    >
      {children}
    </div>
  );
}

function SummaryList({ title, tone, items }: { title: string; tone: "ok" | "warn"; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold text-muted">{title}</h3>
      <ul className="space-y-1">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2">
            <Icon name={tone === "ok" ? "check" : "info"} className={cx("mt-[3px]", tone === "ok" ? "text-ok" : "text-warn")} />
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Timer({ startedAt, endedAt, planned }: { startedAt: number; endedAt: number | null; planned: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endedAt) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [endedAt]);
  const min = Math.max(0, Math.floor(((endedAt ?? now) - startedAt) / 60_000));
  const over = planned !== null && min >= planned;
  return (
    <span
      className={cx("rounded px-2 py-1 text-xs whitespace-nowrap tabular-nums", over ? "bg-warn-soft font-medium text-warn" : "bg-surface-2 text-muted")}
      title="Время сессии"
    >
      {min}
      {planned ? ` из ${planned}` : ""} мин
    </span>
  );
}

function SidePanel({ view, open, onClose, onChanged }: { view: SessionView; open: boolean; onClose: () => void; onChanged: () => void }) {
  const [text, setText] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = reply !== null;

  const ask = async () => {
    const q = text.trim();
    if (!q || busy) return;
    setText("");
    setAsked(q);
    setReply("");
    setError(null);
    try {
      await streamPost(`/api/sessions/${view.id}/side`, { text: q }, (e) => {
        if (e.type === "text") setReply((r) => (r ?? "") + e.delta);
        if (e.type === "error") setError(e.message);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    await onChanged();
    setReply(null);
    setAsked(null);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Боковой вопрос">
      <div className="space-y-3">
        <p className="text-sm text-muted">Короткое уточнение по текущему шагу. Урок при этом не сбивается, а ответ на открытый вопрос здесь не подскажут.</p>
        {view.side.map((m, i) =>
          m.role === "user" ? (
            <Said key={i} small>
              {m.text}
            </Said>
          ) : (
            <Markdown key={i} text={m.text} className="text-[15px]" />
          ),
        )}
        {asked && <Said small>{asked}</Said>}
        {reply !== null && (reply ? <Markdown text={reply} className="text-[15px]" /> : <Dots />)}
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="flex gap-2">
          <input
            className={inputClass}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
            placeholder="Что значит этот термин?"
          />
          <Button variant="primary" onClick={ask} disabled={busy || !text.trim()}>
            Спросить
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function ParkingSheet({ view, open, onClose, onChanged }: { view: SessionView; open: boolean; onClose: () => void; onChanged: () => void }) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const add = async () => {
    if (!text.trim()) return;
    await api("/api/parking", { body: { topicId: view.topic.id, sessionId: view.id, text } });
    setText("");
    setSaved(true);
    onChanged();
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 700);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Парковка">
      <div className="space-y-3">
        <p className="text-sm text-muted">Запиши постороннюю мысль или вопрос и вернись к уроку. Список хранится в теме; репетитор увидит его на следующем уроке.</p>
        <textarea className={cx(inputClass, "min-h-24 resize-y")} value={text} onChange={(e) => setText(e.target.value)} placeholder="Потом разобраться, почему…" autoFocus />
        <Button variant="primary" className="w-full" onClick={add} disabled={!text.trim()}>
          {saved ? "Отложено" : "Отложить и вернуться к уроку"}
        </Button>
        {view.parkingOpen > 0 && <p className="text-xs text-muted">Уже отложено: {view.parkingOpen}</p>}
      </div>
    </Sheet>
  );
}

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [view, setView] = useState<SessionView | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [book, setBook] = useState<{ id: number; page: number } | null>(null);
  const openBook = useCallback((id: number, page: number) => setBook({ id, page }), []);
  const [sheet, setSheet] = useState<null | "side" | "parking" | "plan" | "finish">(null);
  const [now, setNow] = useState(() => Date.now());
  const started = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const v = await api<SessionView>(`/api/sessions/${id}`);
      setView(v);
      return v;
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [id]);

  const send = useCallback(
    async (input: TurnInput) => {
      setBusy(true);
      setError(null);
      setStreaming("");
      setStatus("Думаю…");
      let sep = false;
      try {
        await streamPost(`/api/sessions/${id}/turn`, input, (e) => {
          if (e.type === "text") {
            setStreaming((s) => s + (sep ? "\n\n" : "") + e.delta);
            sep = false;
            setStatus("");
          } else if (e.type === "text_end") sep = true;
          else if (e.type === "status") setStatus(e.text);
          else if (e.type === "error") setError(e.message);
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      await load();
      notifyChanged();
      setStreaming("");
      setStatus("");
      setBusy(false);
    },
    [id, load],
  );

  // First load: start the session if nothing has happened yet.
  useEffect(() => {
    load().then((v) => {
      if (v && !started.current && !v.endedAt && !v.running && v.transcript.length === 0 && !v.needsRetry) {
        started.current = true;
        send({ type: "start" });
      }
    });
  }, [load, send]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // A turn may be running from another tab or an earlier page load: wait for it.
  useEffect(() => {
    if (!view?.running || busy) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [view?.running, busy, load]);

  useEffect(() => {
    if (busy) bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [streaming, busy, view?.transcript.length]);

  if (fatal) {
    return (
      <>
        <TopNav tab="Сессия" icon="book" />
        <div className="mx-auto max-w-2xl p-4">
          <Notice tone="bad">{fatal}</Notice>
        </div>
      </>
    );
  }
  if (!view) return <Loading />;

  const items = view.transcript;
  // The current step starts at the learner's last action; earlier steps are folded away.
  let boundary = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.type === "user" || (it.type === "question" && !it.pending)) {
      boundary = i;
      break;
    }
  }
  const shown = showHistory ? items : items.slice(boundary);
  const waiting = busy || view.running;
  const ended = !!view.endedAt;
  const overtime = view.plannedMinutes !== null && !ended && now - view.startedAt > view.plannedMinutes * 60_000;
  // The tutor stopped without a question: a theory step to read, then "Дальше".
  const canContinue = !waiting && !ended && !view.pendingAttemptId && !view.needsRetry && items.length > 0;

  const spent =
    view.usage.cost !== null && (view.usage.cost > 0 || view.usage.costKnown)
      ? formatCost(view.usage.cost, view.usage.costKnown)
      : `${formatTokens(view.usage.inputTokens + view.usage.cacheReadTokens + view.usage.outputTokens)} токенов`;

  const graded = items.flatMap((it) => (it.type === "question" && it.outcome ? [it.outcome] : []));
  const right = graded.filter((o) => o === "correct").length;
  const wrong = graded.filter((o) => o === "wrong" || o === "partial").length;

  const marked = new Set(view.feedback.map((f) => `${f.kind}:${f.excerpt}`));
  const onMark = async (kind: StepFeedbackKind, text: string) => {
    const comment = kind === "wrong" && !marked.has(`${kind}:${excerptOf(text)}`) ? (window.prompt("Что не так? (можно оставить пустым)") ?? null) : "";
    if (comment === null) return;
    try {
      const r = await api<{ feedback: SessionView["feedback"] }>(`/api/sessions/${id}/feedback`, { body: { kind, text, comment } });
      setView((v) => (v ? { ...v, feedback: r.feedback } : v));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const onAnswer = (attemptId: number, answer: AnswerPayload) => send({ type: "answer", attemptId, answer });
  const onInvalid = (attemptId: number, detail: string) => send({ type: "invalid_question", attemptId, detail });
  const sendMessage = () => {
    const text = message.trim();
    if (!text || waiting) return;
    setMessage("");
    send({ type: "message", text });
  };

  return (
    <div className="flex min-h-full flex-col">
      <TopNav
        tab={KIND[view.kind]}
        icon="book"
        crumbs={[{ label: view.topic.title, href: `/topics/${view.topic.id}` }, { label: KIND[view.kind] }]}
        busy={waiting}
        right={
          <>
            {view.books.length > 0 && (
              <Button small variant="ghost" onClick={() => setBook({ id: (view.books.find((b) => b.role === "main") ?? view.books[0]).id, page: book?.page ?? 1 })} title="Открыть учебник рядом с уроком">
                <Icon name="book" size={14} /> Книга
              </Button>
            )}
            <Timer startedAt={view.startedAt} endedAt={view.endedAt} planned={view.plannedMinutes} />
          </>
        }
        status={
          <>
            <StatusItem icon="file">{view.topic.title}</StatusItem>
            <StatusItem icon="check" title="Верных ответов за сессию">
              {right}
            </StatusItem>
            <StatusItem icon="cross" title="Неверных и частично верных ответов за сессию">
              {wrong}
            </StatusItem>
            {view.plan.length > 0 && (
              <StatusItem title="Освоено идей плана">
                План: {view.plan.filter((n) => n.status === "mastered").length} из {view.plan.length}
              </StatusItem>
            )}
            {waiting && <StatusItem>Репетитор работает…</StatusItem>}
            <StatusItem title="Расход за сессию">
              {spent}
            </StatusItem>
            <StatusItem>{ended ? "Сессия завершена" : KIND[view.kind]}</StatusItem>
          </>
        }
      />

      {/* The lesson reads like a notebook document: prose with question cells in between. */}
      <div className="mx-auto w-full max-w-3xl flex-1">
        <div className="space-y-5 px-4 pt-4 pb-8 sm:px-8">
        {boundary > 0 && (
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-bright"
          >
            <Icon name="chevron" size={14} className={cx("transition-transform duration-150", showHistory && "rotate-90")} />
            {showHistory ? "Скрыть предыдущие шаги" : `Предыдущие шаги: ${boundary}`}
          </button>
        )}

        {shown.map((it, i) => (
          <Item key={it.type === "question" ? `q${it.attemptId}` : `${(showHistory ? 0 : boundary) + i}-${it.type}`} item={it} busy={waiting} onAnswer={onAnswer} onInvalid={onInvalid} books={view.books} onBook={openBook} marked={marked} onMark={onMark} />
        ))}

        {streaming && <Prose text={streaming} className="prose-lesson streaming" books={view.books} onBook={openBook} />}
        {waiting && (
          <div className="appear flex items-center gap-2.5 text-sm text-muted" aria-live="polite">
            <Dots /> {status || (streaming ? "" : "Репетитор работает…")}
          </div>
        )}

        {canContinue && (
          <div className="enter flex flex-wrap items-center gap-2">
            <Button variant="primary" autoFocus onClick={() => send({ type: "continue" })}>
              Дальше
            </Button>
            <Button variant="ghost" onClick={() => send({ type: "more" })} title="Разобрать эту идею глубже, с другой стороны">
              Объясни подробнее
            </Button>
          </div>
        )}

        {error && (
          <div className="enter">
            <Notice tone="bad">
              <div>{error}</div>
            </Notice>
          </div>
        )}
        {!waiting && view.needsRetry && (
          <Button variant="primary" onClick={() => send({ type: "retry" })}>
            Повторить
          </Button>
        )}

        {overtime && !waiting && (
          <div className="enter">
          <Notice tone="warn">
            Запланированное время вышло. Лучше закончить сейчас и вернуться завтра, чем продолжать уставшим.{" "}
            <button className="font-medium underline" onClick={() => send({ type: "finish" })}>
              Завершить и подвести итог
            </button>
          </Notice>
          </div>
        )}

        {ended && (
          <section className="enter space-y-4 rounded-md border border-border bg-surface p-4 sm:p-5">
            <h2 className="text-lg text-bright">Итог сессии</h2>
            {view.summary ? (
              <>
                <SummaryList title="Освоено" tone="ok" items={view.summary.learned} />
                <SummaryList title="Слабые места" tone="warn" items={view.summary.weak} />
                <div>
                  <h3 className="mb-1.5 text-xs font-semibold text-muted">В следующий раз</h3>
                  <p>{view.summary.next}</p>
                </div>
              </>
            ) : (
              <p className="text-muted">Сессия завершена.</p>
            )}
            <p className="text-xs text-muted">
              Расход: {formatTokens(view.usage.inputTokens + view.usage.cacheReadTokens)} токенов на вход, {formatTokens(view.usage.outputTokens)} на выход
              {view.usage.cost !== null && (view.usage.cost > 0 || view.usage.costKnown) ? `, ${formatCost(view.usage.cost, view.usage.costKnown)}` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <LinkButton href={`/topics/${view.topic.id}`} variant="primary">
                Вернуться к теме
              </LinkButton>
              <LinkButton href={`/topics/${view.topic.id}?tab=notes`}>Обновить конспект</LinkButton>
            </div>
          </section>
        )}
        <div ref={bottom} />
        </div>
      </div>

      {!ended && (
        <div className="safe-bottom sticky bottom-0 z-20 border-t border-border bg-surface px-3 pt-2.5 sm:pb-2">
          <div className="mx-auto flex max-w-3xl items-end gap-2 sm:px-5">
            <textarea
              className={cx(inputClass, "max-h-32 min-h-10 flex-1 resize-none sm:min-h-[30px]")}
              rows={1}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={view.pendingAttemptId ? "Не понял вопрос? Напиши репетитору" : "Написать репетитору"}
            />
            <Button variant="primary" className="w-10 px-0 sm:w-[34px]" onClick={sendMessage} disabled={waiting || !message.trim()} aria-label="Отправить">
              <Icon name="up" className="[stroke-width:1.6]" />
            </Button>
          </div>
          <div className="mx-auto mt-1.5 flex max-w-3xl items-center gap-1 overflow-x-auto sm:px-5">
            <Button small variant="ghost" className="shrink-0 px-2.5 whitespace-nowrap" onClick={() => setSheet("side")} title="Короткий вопрос по текущему шагу">
              <span>
                Вопрос<span className="hidden sm:inline"> по шагу</span>
              </span>
            </Button>
            {view.pendingAttemptId !== null && (
              <Button
                small
                variant="ghost"
                className="shrink-0 px-2.5 whitespace-nowrap"
                onClick={() => send({ type: "more" })}
                disabled={waiting}
                title="Сначала разобрать идею подробнее, потом ответить: вопрос вернётся"
              >
                Подробнее
              </Button>
            )}
            <Button small variant="ghost" className="shrink-0 px-2.5 whitespace-nowrap" onClick={() => setSheet("parking")}>
              Парковка
              {view.parkingOpen > 0 && <Count n={view.parkingOpen} />}
            </Button>
            <Button small variant="ghost" className="shrink-0 px-2.5 whitespace-nowrap" onClick={() => setSheet("plan")}>
              План
            </Button>
            <Button small variant="ghost" className="ml-auto shrink-0 px-2.5 whitespace-nowrap" onClick={() => setSheet("finish")} disabled={waiting}>
              Завершить
            </Button>
          </div>
        </div>
      )}

      <SidePanel view={view} open={sheet === "side"} onClose={() => setSheet(null)} onChanged={load} />
      <ParkingSheet view={view} open={sheet === "parking"} onClose={() => setSheet(null)} onChanged={load} />
      <Sheet open={!!book} onClose={() => setBook(null)} title={view.books.find((b) => b.id === book?.id)?.name ?? "Книга"} wide>
        {book && <BookViewer key={book.id} bookId={book.id} page={book.page} />}
      </Sheet>
      <Sheet open={sheet === "plan"} onClose={() => setSheet(null)} title="План обучения" wide>
        <PlanGraph plan={view.plan} />
      </Sheet>
      <Sheet open={sheet === "finish"} onClose={() => setSheet(null)} title="Завершить сессию?">
        <div className="space-y-3">
          <p className="text-sm text-muted">Репетитор подведёт итог: что освоено, где слабые места и с чего начать в следующий раз. Прогресс по узлам уже сохранён.</p>
          <p className="text-sm text-muted">Расход за сессию: {spent}.</p>
          <Button
            variant="primary"
            className="w-full"
            onClick={() => {
              setSheet(null);
              send({ type: "finish" });
            }}
          >
            Завершить и подвести итог
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
