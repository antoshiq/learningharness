"use client";

import { useEffect, useState } from "react";
import { Exam } from "@/components/Exam";
import { Button, Card, Icon, Loading, Notice, Page, Segmented, TopNav } from "@/components/ui";
import { api } from "@/lib/api";
import type { DrillItem } from "@/lib/types";

const COUNTS = [
  [10, "10 вопросов"],
  [15, "15"],
  [25, "25"],
] as const;
const TIMES = [
  [10, "10 мин"],
  [20, "20 мин"],
  [30, "30 мин"],
  [0, "Без таймера"],
] as const;

export default function ExamPage() {
  const [topic, setTopic] = useState<{ id: number; title: string; plan: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<(typeof COUNTS)[number][0]>(15);
  const [minutes, setMinutes] = useState<(typeof TIMES)[number][0]>(20);
  const [generate, setGenerate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exam, setExam] = useState<{ items: DrillItem[]; generated: number; key: number } | null>(null);

  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("topic"));
    if (!id) {
      setError("Экзамен открывается со страницы темы.");
      return;
    }
    api<{ topic: { id: number; title: string }; plan: unknown[] }>(`/api/topics/${id}`)
      .then((d) => setTopic({ id: d.topic.id, title: d.topic.title, plan: d.plan.length }))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const start = async () => {
    if (!topic) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ items: DrillItem[]; generated: number }>("/api/exam", { body: { topicId: topic.id, count, generate } });
      setExam({ ...r, key: Date.now() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <>
      <TopNav tab="Экзамен" icon="check" crumbs={topic ? [{ label: topic.title, href: `/topics/${topic.id}` }, { label: "Экзамен" }] : [{ label: "Экзамен" }]} busy={busy} />
      <Page narrow>
        <h1 className="text-[26px] leading-tight font-normal text-bright">Экзамен{topic ? `: ${topic.title}` : ""}</h1>
        <p className="mt-1 mb-6 max-w-[64ch] text-muted">
          Вопросы по всем идеям темы подряд, без подсказок и без репетитора. Результаты — в конце, по каждой идее плана. Ошибки уйдут в «Работу над ошибками».
        </p>
        {error && (
          <div className="mb-4">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}
        {!topic ? (
          !error && <Loading />
        ) : exam ? (
          <>
            {exam.generated > 0 && <p className="mb-3 text-xs text-muted">Новых вопросов составлено: {exam.generated}. Они останутся в теме как карточки.</p>}
            <Exam key={exam.key} items={exam.items} minutes={minutes || null} topicId={topic.id} onRestart={() => setExam(null)} />
          </>
        ) : (
          <Card className="space-y-4">
            <div>
              <div className="mb-1 text-[13px] text-bright">Сколько вопросов</div>
              <Segmented label="Сколько вопросов" value={count} onChange={setCount} options={COUNTS} />
            </div>
            <div>
              <div className="mb-1 text-[13px] text-bright">Время</div>
              <Segmented label="Время" value={minutes} onChange={setMinutes} options={TIMES} />
            </div>
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 size-4" checked={generate} onChange={(e) => setGenerate(e.target.checked)} />
              <span>
                Если вопросов из уроков не хватает, пусть модель составит новые
                <span className="block text-xs text-muted">Один вызов основной модели. Без этого экзамен будет короче.</span>
              </span>
            </label>
            {topic.plan === 0 && <p className="text-sm text-warn">У темы ещё нет плана: вопросы будут по названию и цели темы.</p>}
            <Button variant="primary" onClick={start} disabled={busy}>
              <Icon name="play" /> {busy ? "Собираю вопросы…" : "Начать экзамен"}
            </Button>
            {busy && generate && (
              <p className="appear text-xs text-muted">Если своих вопросов не хватает, модель составляет новые: это может занять одну–три минуты. Страницу можно не обновлять.</p>
            )}
          </Card>
        )}
      </Page>
    </>
  );
}
