"use client";

import { useCallback, useEffect, useState } from "react";
import { api, formatDue } from "@/lib/api";
import { KIND_LABEL, type Question } from "@/lib/types";
import { Markdown } from "./Markdown";
import { Badge, Button, cx, Icon, Loading, Notice } from "./ui";
import { notifyChanged } from "./workbench-context";

interface CardRow {
  id: number;
  origin: "brief" | "notes" | "exam";
  question: Question;
  dueAt: number;
  lastOutcome: "correct" | "partial" | "wrong" | null;
  reps: number;
}

const ORIGIN = { brief: "из экскурса", notes: "из конспекта", exam: "с экзамена" } as const;

/** The topic's cards: what they ask, when they come back; make more from the cheat sheet; export to Anki. */
export function CardsTab({ topicId, hasNotes }: { topicId: number; hasNotes: boolean }) {
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [now] = useState(() => Date.now());

  const load = useCallback(() => {
    api<{ cards: CardRow[] }>(`/api/topics/${topicId}/cards`)
      .then((r) => setCards(r.cards))
      .catch((e) => setMsg({ tone: "bad", text: e instanceof Error ? e.message : String(e) }));
  }, [topicId]);
  useEffect(() => load(), [load]);

  const fromNotes = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ added: number }>(`/api/topics/${topicId}/cards`, { body: { count: 10 } });
      setMsg({ tone: "ok", text: `Добавлено карточек: ${r.added}. Они уже в «Повторении на сегодня».` });
      load();
      notifyChanged();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  };

  const remove = async (id: number) => {
    await api(`/api/cards?id=${id}`, { method: "DELETE" });
    setCards((c) => c?.filter((x) => x.id !== id) ?? null);
    notifyChanged();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={fromNotes} disabled={busy || !hasNotes} title={hasNotes ? "" : "Сначала составь конспект во вкладке «Конспект»"}>
          <Icon name="cards" /> {busy ? "Делаю карточки…" : "Карточки из конспекта"}
        </Button>
        <a
          href={`/api/topics/${topicId}/anki`}
          download
          className="inline-flex h-[34px] items-center gap-1.5 rounded-sm border border-border-strong bg-surface-2 px-3 text-text hover:border-muted hover:text-bright sm:h-[30px]"
          title="Вопросы уроков и карточки темы в файл для импорта в Anki"
        >
          <Icon name="download" /> Экспорт в Anki
        </a>
      </div>
      <p className="max-w-[70ch] text-sm text-muted">
        Карточки — вопросы не из уроков: из экскурса, конспекта или экзамена. У каждой своё расписание повторения. Экспорт в Anki забирает и вопросы уроков: в Anki открой «Файл →
        Импорт» и выбери скачанный файл, колода создастся сама.
      </p>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {cards === null ? (
        <Loading />
      ) : cards.length === 0 ? (
        <p className="text-muted">Карточек пока нет. Их можно сделать из экскурса или конспекта; экзамен тоже оставляет свои вопросы здесь.</p>
      ) : (
        <ul className="space-y-2">
          {cards.map((c, i) => (
            <li
              key={c.id}
              style={{ "--i": Math.min(i, 10) } as React.CSSProperties}
              className={cx(
                "enter group rounded-sm border border-l-2 border-border bg-surface p-3",
                c.lastOutcome === "correct" ? "border-l-ok" : c.lastOutcome === "wrong" ? "border-l-bad" : c.lastOutcome === "partial" ? "border-l-warn" : "border-l-border-strong",
              )}
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge>{KIND_LABEL[c.question.kind]}</Badge>
                <span>{ORIGIN[c.origin]}</span>
                <span>· {c.reps ? `повторений: ${c.reps}` : "ещё не повторялась"}</span>
                <span className={cx("ml-auto", c.dueAt <= now && "text-accent")}>{c.dueAt <= now ? "пора повторить" : formatDue(c.dueAt, now)}</span>
                <button
                  onClick={() => remove(c.id)}
                  aria-label="Удалить карточку"
                  title="Удалить карточку"
                  className="grid size-6 place-items-center rounded-sm text-muted opacity-60 group-hover:opacity-100 hover:bg-surface-2 hover:text-bad"
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
              <Markdown text={c.question.prompt} className="line-clamp-3" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
