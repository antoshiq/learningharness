"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Badge, Button, Card, cx, Dots, Icon, inputClass, isSubmitKey, KeyHandler, LinkButton, Loading, Mark, Notice, Page, TopNav } from "@/components/ui";
import { api } from "@/lib/api";
import type { OralResult, OralTurn } from "@/server/db/schema";

interface Oral {
  id: number;
  topicId: number;
  turns: OralTurn[];
  status: "active" | "done";
  result: OralResult | null;
}

// The browser's own speech services: recognition (Chrome, Edge, Safari) and synthesis (all).
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type RecognitionCtor = new () => Recognition;
const recognitionCtor = (): RecognitionCtor | null =>
  typeof window === "undefined" ? null : ((window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition ?? null);

function speak(text: string, on: boolean) {
  if (!on || typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/\(тест\)\s*/g, ""));
  u.lang = "ru-RU";
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith("ru"));
  if (voice) u.voice = voice;
  u.rate = 1;
  window.speechSynthesis.speak(u);
}

const VERDICT = { correct: ["ok", "понимает"], partial: ["warn", "частично"], wrong: ["bad", "не ответил"] } as const;

export default function OralPage() {
  const [topic, setTopic] = useState<{ id: number; title: string; plan: number } | null>(null);
  const [oral, setOral] = useState<Oral | null>(null);
  const [answer, setAnswer] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [voice, setVoice] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canListen, setCanListen] = useState(false);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => {
    setCanListen(!!recognitionCtor());
    const q = new URLSearchParams(window.location.search);
    const id = Number(q.get("topic"));
    if (!id) {
      setError("Устный экзамен открывается со страницы темы или семестра.");
      return;
    }
    api<{ topic: { id: number; title: string }; plan: unknown[] }>(`/api/topics/${id}`)
      .then((d) => setTopic({ id: d.topic.id, title: d.topic.title, plan: d.plan.length }))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // Voices load asynchronously in some browsers.
    window.speechSynthesis?.getVoices();
    return () => window.speechSynthesis?.cancel();
  }, []);

  const last = oral?.turns.filter((t) => t.role === "examiner").at(-1);
  useEffect(() => {
    if (last && oral?.status === "active") speak(last.text, voice);
    // Speak each new question once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.at]);

  const stopListening = useCallback(() => {
    rec.current?.stop();
    rec.current = null;
    setListening(false);
    setInterim("");
  }, []);

  const listen = () => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    window.speechSynthesis?.cancel();
    const r = new Ctor();
    r.lang = "ru-RU";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let finalText = "";
      let temp = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else temp += res[0].transcript;
      }
      if (finalText) setAnswer((a) => `${a}${a && !a.endsWith(" ") ? " " : ""}${finalText.trim()}`);
      setInterim(temp);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed") setError("Браузер не дал доступ к микрофону. Разреши его в настройках сайта или отвечай текстом.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setError(`Распознавание речи: ${e.error}. Можно отвечать текстом.`);
    };
    r.onend = () => {
      setListening(false);
      setInterim("");
    };
    rec.current = r;
    r.start();
    setListening(true);
  };

  const call = async (label: string, fn: () => Promise<Oral>) => {
    setBusy(label);
    setError(null);
    try {
      setOral(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  const start = () => call("Экзаменатор готовит вопрос…", () => api<Oral>("/api/oral", { body: { topicId: topic!.id } }));
  const send = () => {
    if (!oral || !answer.trim()) return;
    stopListening();
    const text = answer;
    setAnswer("");
    call("Экзаменатор слушает…", () => api<Oral>(`/api/oral/${oral.id}`, { body: { answer: text } }));
  };
  const finish = () => {
    stopListening();
    window.speechSynthesis?.cancel();
    call("Оцениваю экзамен…", () => api<Oral>(`/api/oral/${oral!.id}`, { body: { finish: true } }));
  };

  return (
    <>
      <TopNav tab="Устный экзамен" icon="chat" crumbs={topic ? [{ label: topic.title, href: `/topics/${topic.id}` }, { label: "Устный экзамен" }] : [{ label: "Устный экзамен" }]} busy={!!busy} />
      <KeyHandler onKey={(e) => isSubmitKey(e) && oral?.status === "active" && !busy && send()} />
      <Page narrow>
        <h1 className="text-[26px] leading-tight font-normal text-bright">Устный экзамен{topic ? `: ${topic.title}` : ""}</h1>
        <p className="mt-1 mb-6 max-w-[64ch] text-muted">
          Экзаменатор задаёт вопросы вслух, ты отвечаешь голосом или текстом. Он уточняет, если ответ неполный, и не подсказывает. В конце — оценка по каждой идее;
          хорошо объяснённые идеи засчитываются как «объяснено».
        </p>
        {error && (
          <div className="mb-4">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}
        {!topic ? (
          !error && <Loading />
        ) : !oral ? (
          <Card className="space-y-3">
            {topic.plan === 0 && <Notice tone="warn">У темы ещё нет плана: сначала пройди урок.</Notice>}
            {!canListen && <Notice>Этот браузер не умеет распознавать речь (так бывает в Firefox). Отвечать можно текстом; голос работает в Chrome, Edge и Safari.</Notice>}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
              Читать вопросы вслух
            </label>
            <Button variant="primary" onClick={start} disabled={!!busy || topic.plan === 0}>
              <Icon name="play" /> {busy ?? "Начать экзамен"}
            </Button>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="space-y-3">
              {oral.turns.map((t, i) =>
                t.role === "examiner" ? (
                  <div key={i} className="enter flex gap-2.5">
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                      <Icon name="chat" size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Markdown text={t.text} className="text-[15px] text-bright" />
                      {oral.status === "active" && t === last && (
                        <button onClick={() => speak(t.text, true)} className="mt-1 text-xs text-accent hover:underline">
                          Повторить вопрос вслух
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="enter ml-9 rounded-md border border-border bg-surface px-3 py-2 text-sm whitespace-pre-wrap">
                    {t.text}
                  </div>
                ),
              )}
            </div>

            {oral.status === "active" ? (
              <Card className="space-y-3">
                <div className="relative">
                  <textarea
                    className={cx(inputClass, "min-h-28 resize-y")}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder={canListen ? "Нажми «Говорить» и отвечай вслух — текст появится здесь, его можно поправить." : "Твой ответ"}
                    disabled={!!busy}
                  />
                  {interim && <p className="mt-1 text-sm text-muted italic">{interim}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canListen &&
                    (listening ? (
                      <Button onClick={stopListening} className="border-bad text-bad">
                        <span className="dot size-2 rounded-full bg-bad" /> Стоп
                      </Button>
                    ) : (
                      <Button onClick={listen} disabled={!!busy}>
                        <Icon name="chat" size={14} /> Говорить
                      </Button>
                    ))}
                  <Button variant="primary" onClick={send} disabled={!!busy || !answer.trim()}>
                    Ответить
                  </Button>
                  <span className="flex-1" />
                  <Button variant="ghost" onClick={finish} disabled={!!busy}>
                    Закончить экзамен
                  </Button>
                </div>
                {busy && (
                  <p className="flex items-center gap-2 text-sm text-muted">
                    <Dots /> {busy}
                  </p>
                )}
              </Card>
            ) : oral.result ? (
              <div className="space-y-4">
                <Card className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="text-lg text-bright">Экзамен закончен</h2>
                    <span className={cx("text-2xl tabular-nums", oral.result.score >= 80 ? "text-ok" : oral.result.score >= 55 ? "text-warn" : "text-bad")}>{oral.result.score}%</span>
                  </div>
                  {oral.result.feedback && <Markdown text={oral.result.feedback} />}
                </Card>
                {oral.result.ideas.length > 0 && (
                  <section className="overflow-hidden rounded-md border border-border bg-surface">
                    <div className="flex min-h-9 items-center border-b border-border px-3 text-[13px] font-semibold text-bright">По идеям</div>
                    <ul className="divide-y divide-border">
                      {oral.result.ideas.map((g) => (
                        <li key={g.key} className="space-y-1 px-3 py-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 text-bright">{g.title}</span>
                            <Mark tone={VERDICT[g.verdict][0]}>{VERDICT[g.verdict][1]}</Mark>
                          </div>
                          {g.comment && <p className="text-muted">{g.comment}</p>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setOral(null)}>
                    <Icon name="redo" /> Ещё раз
                  </Button>
                  <LinkButton href={`/topics/${topic.id}`} variant="ghost">
                    К теме
                  </LinkButton>
                  <Badge>результат записан</Badge>
                </div>
              </div>
            ) : (
              <Loading />
            )}
          </div>
        )}
      </Page>
    </>
  );
}
