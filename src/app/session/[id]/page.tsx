"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { PlanGraph } from "@/components/PlanGraph";
import { QuestionCard } from "@/components/QuestionCard";
import { Button, cx, Dots, inputClass, LinkButton, Notice, Sheet, TopNav } from "@/components/ui";
import { api, formatCost, formatTokens, streamPost } from "@/lib/api";
import type { AnswerPayload, TranscriptItem, TurnInput } from "@/lib/types";
import type { SessionView } from "@/server/sessions";

const KIND = { lesson: "Урок", practice: "Практика", review: "Повторение" } as const;

function Item({
  item,
  busy,
  onAnswer,
  onInvalid,
}: {
  item: TranscriptItem;
  busy: boolean;
  onAnswer: (id: number, a: AnswerPayload) => void;
  onInvalid: (id: number, d: string) => void;
}) {
  if (item.type === "assistant") return <Markdown text={item.text} className="text-[16.5px]" />;
  if (item.type === "user") {
    return (
      <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 whitespace-pre-wrap">{item.text}</div>
    );
  }
  if (item.type === "event") return <div className="text-center text-xs text-muted">— {item.text} —</div>;
  return <QuestionCard item={item} busy={busy} onAnswer={onAnswer} onInvalid={onInvalid} />;
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
    <span className={cx("text-xs tabular-nums", over ? "font-medium text-warn" : "text-muted")} title="Время сессии">
      {min}
      {planned ? ` / ${planned}` : ""} мин
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
            <div key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-3 py-1.5 text-sm">
              {m.text}
            </div>
          ) : (
            <Markdown key={i} text={m.text} className="text-[15px]" />
          ),
        )}
        {asked && <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-3 py-1.5 text-sm">{asked}</div>}
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
          {saved ? "Сохранено ✓" : "Отложить и вернуться к уроку"}
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
        <TopNav back={{ href: "/", label: "Темы" }} />
        <div className="mx-auto max-w-2xl p-4">
          <Notice tone="bad">{fatal}</Notice>
        </div>
      </>
    );
  }
  if (!view) return <div className="p-6 text-sm text-muted">Загрузка…</div>;

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

  const spent =
    view.usage.cost !== null && (view.usage.cost > 0 || view.usage.costKnown)
      ? formatCost(view.usage.cost, view.usage.costKnown)
      : `${formatTokens(view.usage.inputTokens + view.usage.cacheReadTokens + view.usage.outputTokens)} токенов`;

  const onAnswer = (attemptId: number, answer: AnswerPayload) => send({ type: "answer", attemptId, answer });
  const onInvalid = (attemptId: number, detail: string) => send({ type: "invalid_question", attemptId, detail });
  const sendMessage = () => {
    const text = message.trim();
    if (!text || waiting) return;
    setMessage("");
    send({ type: "message", text });
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <TopNav
        back={{ href: `/topics/${view.topic.id}`, label: "Тема" }}
        title={`${KIND[view.kind]} · ${view.topic.title}`}
        right={<Timer startedAt={view.startedAt} endedAt={view.endedAt} planned={view.plannedMinutes} />}
      />

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-5 px-4 pt-4 pb-6">
        {boundary > 0 && (
          <button onClick={() => setShowHistory((v) => !v)} className="mx-auto block rounded-lg px-3 py-1.5 text-xs text-muted hover:bg-surface-2">
            {showHistory ? "Скрыть предыдущие шаги" : `Показать предыдущие шаги (${boundary})`}
          </button>
        )}

        {shown.map((it, i) => (
          <Item key={it.type === "question" ? `q${it.attemptId}` : `${(showHistory ? 0 : boundary) + i}-${it.type}`} item={it} busy={waiting} onAnswer={onAnswer} onInvalid={onInvalid} />
        ))}

        {streaming && <Markdown text={streaming} className="text-[16.5px]" />}
        {waiting && (
          <div className="flex items-center gap-2.5 text-sm text-muted" aria-live="polite">
            <Dots /> {status || (streaming ? "" : "Репетитор работает…")}
          </div>
        )}

        {error && (
          <Notice tone="bad">
            <div>{error}</div>
          </Notice>
        )}
        {!waiting && view.needsRetry && (
          <Button variant="primary" onClick={() => send({ type: "retry" })}>
            Повторить
          </Button>
        )}

        {overtime && !waiting && (
          <Notice tone="warn">
            Запланированное время вышло. Лучше закончить сейчас и вернуться завтра, чем продолжать уставшим.{" "}
            <button className="font-medium underline" onClick={() => send({ type: "finish" })}>
              Завершить и подвести итог
            </button>
          </Notice>
        )}

        {ended && (
          <section className="space-y-4 rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="text-lg font-semibold">Итог сессии</h2>
            {view.summary ? (
              <>
                {view.summary.learned.length > 0 && (
                  <div>
                    <div className="mb-1 text-sm font-medium text-ok">Освоено</div>
                    <ul className="list-disc space-y-0.5 pl-5 text-[15px]">
                      {view.summary.learned.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {view.summary.weak.length > 0 && (
                  <div>
                    <div className="mb-1 text-sm font-medium text-warn">Слабые места</div>
                    <ul className="list-disc space-y-0.5 pl-5 text-[15px]">
                      {view.summary.weak.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <div className="mb-1 text-sm font-medium text-muted">В следующий раз</div>
                  <p className="text-[15px]">{view.summary.next}</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">Сессия завершена.</p>
            )}
            <p className="text-xs text-muted">
              Расход: {formatTokens(view.usage.inputTokens + view.usage.cacheReadTokens)} токенов на вход, {formatTokens(view.usage.outputTokens)} на выход
              {view.usage.cost !== null && (view.usage.cost > 0 || view.usage.costKnown) ? ` · ${formatCost(view.usage.cost, view.usage.costKnown)}` : ""}
            </p>
            <LinkButton href={`/topics/${view.topic.id}`} variant="primary">
              К теме
            </LinkButton>
          </section>
        )}
        <div ref={bottom} />
      </div>

      {!ended && (
        <div className="safe-bottom sticky bottom-0 z-20 border-t border-border bg-bg/95 px-3 pt-2.5 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <textarea
              className={cx(inputClass, "max-h-32 min-h-11 flex-1 resize-none py-2.5")}
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
            <Button variant="primary" onClick={sendMessage} disabled={waiting || !message.trim()} aria-label="Отправить">
              ↑
            </Button>
          </div>
          <div className="mx-auto mt-1.5 flex max-w-2xl items-center gap-1 overflow-x-auto text-sm">
            <Button small variant="ghost" className="shrink-0 px-2.5 whitespace-nowrap" onClick={() => setSheet("side")} title="Короткий вопрос по текущему шагу">
              Вопрос<span className="hidden sm:inline">&nbsp;по шагу</span>
            </Button>
            <Button small variant="ghost" className="shrink-0 px-2.5 whitespace-nowrap" onClick={() => setSheet("parking")}>
              Парковка{view.parkingOpen ? ` · ${view.parkingOpen}` : ""}
            </Button>
            <Button small variant="ghost" className="shrink-0 px-2.5 whitespace-nowrap" onClick={() => setSheet("plan")}>
              План
            </Button>
            <span className="ml-auto hidden shrink-0 px-1 text-xs text-muted tabular-nums sm:inline" title="Расход за сессию">
              {spent}
            </span>
            <Button small variant="ghost" className="ml-auto shrink-0 px-2.5 whitespace-nowrap sm:ml-0" onClick={() => setSheet("finish")} disabled={waiting}>
              Завершить
            </Button>
          </div>
        </div>
      )}

      <SidePanel view={view} open={sheet === "side"} onClose={() => setSheet(null)} onChanged={load} />
      <ParkingSheet view={view} open={sheet === "parking"} onClose={() => setSheet(null)} onChanged={load} />
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
