"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Exam, type ExamResult } from "@/components/Exam";
import { Button, Card, Icon, LinkButton, Loading, Notice, Page, Segmented, TopNav } from "@/components/ui";
import { api } from "@/lib/api";
import { ASSESSMENT_LABEL } from "@/lib/semester";
import type { AssessmentKind } from "@/server/db/schema";
import type { SemesterView } from "@/server/semester";
import type { DrillItem } from "@/lib/types";

type Kind = Exclude<AssessmentKind, "homework" | "oral">;

const RULES: Record<Kind, string> = {
  placement: "Вопросы по тому, на что опирается курс. Что знаешь — засчитается, что слабо — подтянешь в нулевом модуле.",
  checkpoint: "Вопросы по всем идеям модуля, без подсказок и без репетитора. Сдашь — модуль закрыт и открывается следующий. Можно сдавать и досрочно, не проходя уроки.",
  midterm: "Накопительный экзамен по всем сданным модулям: старое спрашивается наравне с новым.",
  final: "Итоговый экзамен по всему курсу. Сдашь — семестр завершён.",
};
const DEFAULT_MINUTES: Record<Kind, number> = { placement: 20, checkpoint: 30, midterm: 45, final: 60 };

const when = (ms: number) => new Date(ms).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export default function SemesterExamPage() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<SemesterView | null>(null);
  const [kind, setKind] = useState<Kind>("checkpoint");
  const [moduleId, setModuleId] = useState<number | null>(null);
  const [minutes, setMinutes] = useState(30);
  const [exam, setExam] = useState<{ items: DrillItem[]; title: string; threshold: number; generated: number } | null>(null);
  const [verdict, setVerdict] = useState<{ passed: boolean; score: number; threshold: number; nextTryAt: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const k = (q.get("kind") ?? "checkpoint") as Kind;
    setKind(k);
    setMinutes(DEFAULT_MINUTES[k] ?? 30);
    setModuleId(Number(q.get("module")) || null);
    api<SemesterView>(`/api/semesters/${id}`)
      .then(setS)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const mod = s?.modules.find((m) => m.id === moduleId) ?? null;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setExam(await api(`/api/semesters/${id}/exam`, { body: { kind, moduleId } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const finish = useCallback(
    async (r: ExamResult) => {
      try {
        setVerdict(await api(`/api/semesters/${id}/assess`, { body: { kind, moduleId, score: r.pct, details: r.details } }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [id, kind, moduleId],
  );

  const title = kind === "checkpoint" || kind === "placement" ? `${ASSESSMENT_LABEL[kind]}${mod ? `: ${mod.title}` : ""}` : ASSESSMENT_LABEL[kind];

  return (
    <>
      <TopNav tab={ASSESSMENT_LABEL[kind]} icon="check" crumbs={[{ label: "Семестр", href: "/semester" }, { label: s?.title ?? "…", href: `/semester/${id}` }, { label: ASSESSMENT_LABEL[kind] }]} busy={busy} />
      <Page narrow>
        <h1 className="text-[26px] leading-tight font-normal text-bright">{title}</h1>
        <p className="mt-1 mb-6 max-w-[64ch] text-muted">{RULES[kind]}</p>
        {error && (
          <div className="mb-4">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}
        {!s ? (
          !error && <Loading />
        ) : exam ? (
          <>
            {exam.generated > 0 && <p className="mb-3 text-xs text-muted">Новых вопросов составлено: {exam.generated}.</p>}
            <Exam
              items={exam.items}
              minutes={minutes || null}
              topicId={mod?.topicId ?? null}
              onFinish={finish}
              after={
                verdict ? (
                  <div className="space-y-3">
                    <Notice tone={verdict.passed ? "ok" : "bad"}>
                      {verdict.passed ? (
                        <>
                          <b>Сдано</b>: {verdict.score}% при пороге {verdict.threshold}%.{" "}
                          {kind === "final" ? "Семестр завершён — дальше знания поддерживает повторение." : kind === "midterm" ? "Результат в ведомости." : "Модуль закрыт, следующий открыт."}
                        </>
                      ) : (
                        <>
                          <b>Не сдано</b>: {verdict.score}% при пороге {verdict.threshold}%. Разбери ошибки — пересдача будет доступна {verdict.nextTryAt ? when(verdict.nextTryAt) : "позже"}.
                          {kind === "placement" ? " Что ты знаешь, уже засчитано; остальное — в нулевом модуле." : ""}
                        </>
                      )}
                    </Notice>
                    <LinkButton href={`/semester/${id}`} variant="primary">
                      <Icon name="cap" /> К семестру
                    </LinkButton>
                  </div>
                ) : (
                  <p className="text-sm text-muted">Записываю результат…</p>
                )
              }
            />
          </>
        ) : (
          <Card className="space-y-4">
            <div>
              <div className="mb-1 text-[13px] text-bright">Время</div>
              <Segmented
                label="Время"
                value={minutes}
                onChange={setMinutes}
                options={[[DEFAULT_MINUTES[kind], `${DEFAULT_MINUTES[kind]} мин`], [DEFAULT_MINUTES[kind] * 2, `${DEFAULT_MINUTES[kind] * 2} мин`], [0, "Без таймера"]] as const}
              />
            </div>
            {kind !== "placement" && (
              <p className="text-sm text-muted">
                Порог — {s.active?.threshold ?? "—"}%. Результат попадёт в ведомость; при пересдаче в оценку идёт лучшая попытка.
              </p>
            )}
            <Button variant="primary" onClick={start} disabled={busy}>
              <Icon name="play" /> {busy ? "Собираю вопросы…" : "Начать"}
            </Button>
            {busy && <p className="appear text-xs text-muted">Если вопросов из уроков не хватает, модель составит новые: это может занять одну–три минуты.</p>}
          </Card>
        )}
      </Page>
    </>
  );
}
