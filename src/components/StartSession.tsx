"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Field, inputClass, Notice, Segmented, Sheet } from "./ui";

const KIND_TITLE = { lesson: "Новый урок", practice: "Практика", review: "Повторение" } as const;
const MINUTES = [
  [15, "15 мин"],
  [25, "25 мин"],
  [45, "45 мин"],
  [0, "Без таймера"],
] as const;

/** Focus ritual before a session: pick a time box and, optionally, a goal. */
export function StartSession({
  topicId,
  kind,
  onClose,
  initialGoal = "",
  onStarted,
}: {
  topicId: number;
  kind: "lesson" | "practice" | "review" | null;
  onClose: () => void;
  /** Prefill the goal, e.g. with a parked question. */
  initialGoal?: string;
  /** Runs after the session is created, before navigating to it. */
  onStarted?: () => Promise<void> | void;
}) {
  const router = useRouter();
  const [minutes, setMinutes] = useState<(typeof MINUTES)[number][0]>(25);
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (kind) setGoal(initialGoal);
  }, [kind, initialGoal]);

  const start = async () => {
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: number }>("/api/sessions", {
        body: { topicId, kind, goal, plannedMinutes: minutes || undefined },
      });
      await onStarted?.();
      router.push(`/session/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Sheet open={kind !== null} onClose={onClose} title={kind ? KIND_TITLE[kind] : ""}>
      <div className="space-y-4">
        <div>
          <div className="mb-1 text-[13px] text-bright">Сколько времени есть?</div>
          <Segmented label="Время на сессию" value={minutes} onChange={setMinutes} options={MINUTES} />
        </div>
        {kind === "lesson" && (
          <Field label="Цель на эту сессию (необязательно)">
            <input className={inputClass} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Разобраться с рекурсией" />
          </Field>
        )}
        <p className="text-[13px] text-muted">
          Включи на телефоне «Не беспокоить» и закрой лишние вкладки. Посторонние мысли записывай на парковку — вернёмся к ним после.
        </p>
        {error && <Notice tone="bad">{error}</Notice>}
        <Button variant="primary" className="w-full" onClick={start} disabled={busy}>
          {busy ? "Открываю…" : "Начать"}
        </Button>
      </div>
    </Sheet>
  );
}
