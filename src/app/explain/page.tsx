"use client";

import { useCallback, useEffect, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Badge, Button, Card, cx, Icon, inputClass, isSubmitKey, Kbd, KeyHandler, Loading, Mark, Notice, Page, TopNav } from "@/components/ui";
import { notifyChanged } from "@/components/workbench-context";
import { api, formatDate } from "@/lib/api";
import type { PlanNodeView } from "@/lib/types";

interface Round {
  text: string;
  review: { score: number; verdict: "correct" | "partial" | "wrong"; good: string[]; gaps: string[]; errors: string[]; followup: string; model: string };
  at: number;
}
interface Explanation {
  id: number;
  nodeKey: string | null;
  concept: string;
  rounds: Round[];
  updatedAt: number;
}

const MAX_ROUNDS = 4;
const VERDICT = { correct: ["ok", "Понято"], partial: ["warn", "Есть пробелы"], wrong: ["bad", "Не понято"] } as const;

function List({ title, items, tone }: { title: string; items: string[]; tone: "ok" | "warn" | "bad" }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className={cx("mb-1 text-xs font-semibold", tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-bad")}>{title}</h4>
      <ul className="space-y-1">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2 text-[14px]">
            <Icon name={tone === "ok" ? "check" : tone === "warn" ? "info" : "cross"} className={cx("mt-[3px]", tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-bad")} />
            <Markdown text={t} className="min-w-0 flex-1" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Review({ r, first }: { r: Round; first: boolean }) {
  const [tone, label] = VERDICT[r.review.verdict];
  const [showModel, setShowModel] = useState(false);
  return (
    <div className="space-y-3">
      <div className="ml-auto w-fit max-w-[90%] rounded-md bg-accent-soft px-3.5 py-2 whitespace-pre-wrap text-bright">
        <div className="mb-0.5 text-xs text-muted">{first ? "Твоё объяснение" : "Твой ответ"}</div>
        {r.text}
      </div>
      <Card className="enter space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Mark tone={tone}>{label}</Mark>
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-2">
            <div className={cx("grow-x h-full rounded-full", tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : "bg-bad")} style={{ width: `${r.review.score}%` }} />
          </div>
          <span className="text-xs text-muted tabular-nums">{r.review.score} из 100</span>
        </div>
        <List title="Получилось" items={r.review.good} tone="ok" />
        <List title="Пробелы" items={r.review.gaps} tone="warn" />
        <List title="Ошибки" items={r.review.errors} tone="bad" />
        {r.review.model && (
          <div>
            <button onClick={() => setShowModel((v) => !v)} className="flex items-center gap-1 text-[13px] text-muted hover:text-bright">
              <Icon name="chevron" size={14} className={cx("transition-transform duration-150", showModel && "rotate-90")} />
              Как объяснил бы репетитор
            </button>
            {showModel && <Markdown text={r.review.model} className="appear mt-1.5 rounded-sm border-l-2 border-accent bg-surface-2/60 px-3 py-2 text-[14px]" />}
          </div>
        )}
      </Card>
    </div>
  );
}

/** The learner explains an idea as if teaching someone; the tutor finds the gaps and asks one follow-up. */
export default function ExplainPage() {
  const [topicId, setTopicId] = useState<number | null>(null);
  const [topicTitle, setTopicTitle] = useState("");
  const [plan, setPlan] = useState<PlanNodeView[]>([]);
  const [history, setHistory] = useState<Explanation[]>([]);
  const [nodeKey, setNodeKey] = useState<string>("");
  const [concept, setConcept] = useState("");
  const [current, setCurrent] = useState<Explanation | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback((id: number) => {
    api<{ explanations: Explanation[] }>(`/api/explain?topic=${id}`)
      .then((r) => setHistory(r.explanations))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = Number(q.get("topic"));
    if (!id) {
      setError("Открой «Объясни своими словами» со страницы темы.");
      return;
    }
    setTopicId(id);
    api<{ topic: { title: string }; plan: PlanNodeView[] }>(`/api/topics/${id}`)
      .then((d) => {
        setTopicTitle(d.topic.title);
        setPlan(d.plan);
        const want = q.get("node");
        // Default to an idea that is being learned: that is where explaining helps most.
        const pick = (want && d.plan.find((n) => n.key === want)) || d.plan.find((n) => n.status === "learning") || d.plan.find((n) => n.status === "mastered") || d.plan[0];
        if (pick) setNodeKey(pick.key);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    loadHistory(id);
  }, [loadHistory]);

  const finished = !!current && (current.rounds.length >= MAX_ROUNDS || !current.rounds.at(-1)!.review.followup);
  const canSend = !busy && text.trim().length >= 20 && !finished && (!!current || !!nodeKey || !!concept.trim());

  const send = async () => {
    if (!canSend || !topicId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<Explanation>("/api/explain", {
        body: current ? { id: current.id, text } : { topicId, nodeKey: nodeKey || undefined, concept: nodeKey ? undefined : concept, text },
      });
      setCurrent(r);
      setText("");
      loadHistory(topicId);
      notifyChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const followup = current?.rounds.at(-1)?.review.followup;

  return (
    <>
      <TopNav tab="Объясни своими словами" icon="chat" crumbs={[...(topicId ? [{ label: topicTitle || "Тема", href: `/topics/${topicId}` }] : []), { label: "Объясни своими словами" }]} busy={busy} />
      <Page narrow>
        <KeyHandler
          onKey={(e) => {
            if (isSubmitKey(e) && canSend) {
              e.preventDefault();
              send();
            }
          }}
        />
        <h1 className="text-[26px] leading-tight font-normal text-bright">Объясни своими словами</h1>
        <p className="mt-1 mb-6 max-w-[64ch] text-muted">
          Расскажи идею так, будто учишь друга, который её не знает. Репетитор найдёт пробелы и ошибки и задаст уточняющий вопрос. Где объяснение спотыкается, там и пробел в понимании.
        </p>
        {error && (
          <div className="mb-4">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}
        {!topicId ? null : !topicTitle && !error ? (
          <Loading />
        ) : (
          <div className="space-y-4">
            {!current ? (
              <Card className="space-y-3">
                <div className="text-[13px] text-bright">Что объясняешь</div>
                {plan.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {plan.map((n) => (
                      <button
                        key={n.key}
                        onClick={() => setNodeKey(n.key)}
                        aria-pressed={nodeKey === n.key}
                        className={cx(
                          "inline-flex h-7 max-w-full items-center gap-1.5 rounded-sm border px-2 text-[13px]",
                          nodeKey === n.key ? "border-accent bg-accent-soft text-bright" : "border-border-strong text-muted hover:text-bright",
                        )}
                      >
                        <span className={cx("size-2 shrink-0 rounded-[1px]", n.status === "mastered" ? "bg-ok" : n.status === "learning" ? "cell-learning" : "ring-1 ring-border-strong")} />
                        <span className="truncate">{n.title}</span>
                      </button>
                    ))}
                    <button
                      onClick={() => setNodeKey("")}
                      aria-pressed={!nodeKey}
                      className={cx("inline-flex h-7 items-center rounded-sm border px-2 text-[13px]", !nodeKey ? "border-accent bg-accent-soft text-bright" : "border-border-strong text-muted hover:text-bright")}
                    >
                      Своё
                    </button>
                  </div>
                )}
                {(!nodeKey || !plan.length) && (
                  <input className={inputClass} value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Например: почему замыкание помнит переменные" aria-label="Что объясняешь" />
                )}
              </Card>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="accent">{current.concept}</Badge>
                <span className="text-muted">раунд {current.rounds.length} из {MAX_ROUNDS}</span>
              </div>
            )}

            {current?.rounds.map((r, i) => <Review key={i} r={r} first={i === 0} />)}

            {finished ? (
              <Card className="enter space-y-3">
                <p className="text-bright">{current!.rounds.at(-1)!.review.verdict === "correct" ? "Отлично: идея объяснена без пробелов." : "Хватит уточнений на этот раз: пробелы выше стоит повторить."}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    onClick={() => {
                      setCurrent(null);
                      setText("");
                    }}
                  >
                    <Icon name="redo" /> Объяснить другое
                  </Button>
                  <a href={`/topics/${topicId}`} className="inline-flex h-[34px] items-center rounded-sm px-3 text-muted hover:bg-surface-2 hover:text-bright sm:h-[30px]">
                    К теме
                  </a>
                </div>
              </Card>
            ) : (
              <Card className="space-y-2">
                {followup && (
                  <div className="flex gap-2 text-[15px] text-bright">
                    <Icon name="chat" className="mt-1 text-accent" />
                    <Markdown text={followup} className="min-w-0 flex-1" />
                  </div>
                )}
                <textarea
                  className={cx(inputClass, "min-h-36 resize-y")}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={current ? "Ответь на уточняющий вопрос" : "Своими словами: что это, зачем, как работает, пример. Без подглядывания."}
                  aria-label={current ? "Ответ на уточняющий вопрос" : "Объяснение"}
                  autoFocus
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="primary" onClick={send} disabled={!canSend}>
                    {busy ? "Репетитор читает…" : current ? "Ответить" : "Проверить объяснение"}
                  </Button>
                  <span className="text-xs text-muted">
                    {!current && !nodeKey && !concept.trim() ? (
                      "Напиши выше, что объясняешь"
                    ) : text.trim().length < 20 ? (
                      "Хотя бы пара предложений"
                    ) : (
                      <>
                        <Kbd>Ctrl+Enter</Kbd> отправить
                      </>
                    )}
                  </span>
                </div>
              </Card>
            )}

            {history.length > 0 && !current && (
              <section className="overflow-hidden rounded-md border border-border bg-surface">
                <div className="flex min-h-9 items-center border-b border-border px-3 text-[13px] font-semibold text-bright">Прошлые объяснения</div>
                <ul className="divide-y divide-border">
                  {history.map((h) => {
                    const last = h.rounds.at(-1)!.review;
                    const [tone, label] = VERDICT[last.verdict];
                    return (
                      <li key={h.id}>
                        <button onClick={() => setCurrent(h)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2/60">
                          <span className="min-w-0 flex-1 truncate text-bright">{h.concept}</span>
                          <Mark tone={tone}>{label}</Mark>
                          <span className="shrink-0 text-xs text-muted">{formatDate(h.updatedAt)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        )}
      </Page>
    </>
  );
}
