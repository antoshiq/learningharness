"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, cx, inputClass, Notice, Sheet } from "./ui";

const KIND_TITLE = { lesson: "Новый урок", practice: "Практика", review: "Повторение" } as const;
const MINUTES = [15, 25, 45, 0] as const;

/** Focus ritual before a session: pick a time box and, optionally, a goal. */
export function StartSession({
  topicId,
  kind,
  onClose,
}: {
  topicId: number;
  kind: "lesson" | "practice" | "review" | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [minutes, setMinutes] = useState<number>(25);
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: number }>("/api/sessions", {
        body: { topicId, kind, goal, plannedMinutes: minutes || undefined },
      });
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
          <div className="mb-1.5 text-sm text-muted">Сколько времени есть?</div>
          <div className="grid grid-cols-4 gap-2">
            {MINUTES.map((m) => (
              <button
                key={m}
                onClick={() => setMinutes(m)}
                aria-pressed={minutes === m}
                className={cx(
                  "min-h-11 rounded-lg border text-sm",
                  minutes === m ? "border-accent bg-accent-soft font-medium text-accent" : "border-border bg-surface text-muted",
                )}
              >
                {m ? `${m} мин` : "Без таймера"}
              </button>
            ))}
          </div>
        </div>
        {kind === "lesson" && (
          <div>
            <div className="mb-1.5 text-sm text-muted">Цель на эту сессию (необязательно)</div>
            <input className={inputClass} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Например: разобраться с рекурсией" />
          </div>
        )}
        <p className="text-sm text-muted">Убери телефон в «Не беспокоить» и закрой лишние вкладки. Посторонние мысли записывай на «парковку» — к ним вернёмся после.</p>
        {error && <Notice tone="bad">{error}</Notice>}
        <Button variant="primary" className="w-full" onClick={start} disabled={busy}>
          {busy ? "Открываю…" : "Начать"}
        </Button>
      </div>
    </Sheet>
  );
}
