"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Badge, Button, Card, cx, Dots, Icon, inputClass, LinkButton, Loading, Notice, Page, Segmented, TopNav } from "@/components/ui";
import { api } from "@/lib/api";
import { gradeOf } from "@/lib/semester";
import type { HomeworkCriterion, HomeworkReview } from "@/server/db/schema";

interface View {
  id: number;
  week: number;
  title: string;
  task: string;
  rubric: HomeworkCriterion[];
  answer: string | null;
  review: HomeworkReview | null;
  status: "open" | "graded";
  semester: { id: number; title: string };
  modules: { id: number; title: string }[];
}

const DRAFT_KEY = (id: string) => `tutor-homework-draft-${id}`;

export default function HomeworkPage() {
  const { id, hid } = useParams<{ id: string; hid: string }>();
  const [h, setH] = useState<View | null>(null);
  const [answer, setAnswer] = useState("");
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const v = await api<View>(`/api/semesters/${id}/homework/${hid}`);
      setH(v);
      let draft = "";
      try {
        draft = localStorage.getItem(DRAFT_KEY(hid)) ?? "";
      } catch {}
      setAnswer(v.answer ?? draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id, hid]);
  useEffect(() => {
    load();
  }, [load]);

  const edit = (v: string) => {
    setAnswer(v);
    try {
      localStorage.setItem(DRAFT_KEY(hid), v);
    } catch {}
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setH(await api<View>(`/api/semesters/${id}/homework/${hid}`, { body: { answer } }));
      try {
        localStorage.removeItem(DRAFT_KEY(hid));
      } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const max = h?.rubric.reduce((n, c) => n + c.points, 0) ?? 0;

  return (
    <>
      <TopNav
        tab="Домашнее задание"
        icon="note"
        crumbs={[{ label: "Семестр", href: "/semester" }, { label: h?.semester.title ?? "…", href: `/semester/${id}` }, { label: `Неделя ${h?.week ?? ""}` }]}
        busy={busy}
      />
      <Page narrow>
        {error && (
          <div className="mb-4">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}
        {!h ? (
          !error && <Loading />
        ) : (
          <div className="space-y-5">
            <header>
              <h1 className="text-[26px] leading-tight font-normal text-bright">{h.title}</h1>
              <p className="mt-1 text-sm text-muted">
                Неделя {h.week}
                {h.modules.length ? ` · ${h.modules.map((m) => m.title).join(", ")}` : ""}
              </p>
            </header>

            <Card>
              <Markdown text={h.task} />
            </Card>

            <section className="rounded-md border border-border bg-surface px-3 py-2.5">
              <h2 className="mb-1.5 text-[13px] font-semibold text-bright">Как оценивается ({max} баллов)</h2>
              <ul className="space-y-1 text-sm">
                {h.rubric.map((c) => {
                  const got = h.review?.scores.find((x) => x.criterion === c.criterion);
                  return (
                    <li key={c.criterion} className="flex gap-3">
                      <span className="min-w-0 flex-1">
                        {c.criterion}
                        {got?.comment && <span className="mt-0.5 block text-[13px] text-muted">{got.comment}</span>}
                      </span>
                      <span className={cx("shrink-0 tabular-nums", got ? (got.got === got.max ? "text-ok" : got.got === 0 ? "text-bad" : "text-warn") : "text-muted")}>
                        {got ? `${got.got} / ${got.max}` : `${c.points} б.`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>

            {h.status === "graded" && h.review ? (
              <>
                <Notice tone={h.review.total >= 55 ? "ok" : "bad"}>
                  <b>
                    {h.review.total}% — {gradeOf(h.review.total).label}
                  </b>
                  . Результат записан в ведомость.
                </Notice>
                {h.review.feedback && (
                  <Card>
                    <Markdown text={h.review.feedback} />
                  </Card>
                )}
                <details className="rounded-md border border-border bg-surface px-3 py-2">
                  <summary className="cursor-pointer text-[13px] text-bright">Твой ответ</summary>
                  <div className="mt-2">
                    <Markdown text={h.answer ?? ""} />
                  </div>
                </details>
                <LinkButton href={`/semester/${id}`} variant="primary">
                  <Icon name="cap" /> К семестру
                </LinkButton>
              </>
            ) : (
              <Card className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-[15px] font-semibold text-bright">Решение</h2>
                  <div className="w-56">
                    <Segmented
                      label="Режим"
                      value={mode}
                      onChange={setMode}
                      options={
                        [
                          ["write", "Писать"],
                          ["preview", "Как будет выглядеть"],
                        ] as const
                      }
                    />
                  </div>
                </div>
                {mode === "write" ? (
                  <textarea
                    className={cx(inputClass, "min-h-72 resize-y font-mono text-[14px]")}
                    value={answer}
                    onChange={(e) => edit(e.target.value)}
                    placeholder="Пиши решение по шагам. Формулы — в $...$ и $$...$$, код — в блоках ``` с языком. Черновик сохраняется сам."
                  />
                ) : (
                  <div className="min-h-72 rounded-sm border border-border px-3 py-2">{answer.trim() ? <Markdown text={answer} /> : <p className="text-sm text-muted">Пока пусто.</p>}</div>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="primary" onClick={submit} disabled={busy || answer.trim().length < 20}>
                    {busy ? (
                      <>
                        <Dots /> Проверяю по критериям…
                      </>
                    ) : (
                      "Сдать на проверку"
                    )}
                  </Button>
                  <Badge>сдать можно один раз</Badge>
                </div>
              </Card>
            )}
          </div>
        )}
      </Page>
    </>
  );
}
