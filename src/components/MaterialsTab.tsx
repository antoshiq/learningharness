"use client";

import { useState } from "react";
import { api, formatDate, streamPost } from "@/lib/api";
import { FilePicker, type PickedFile } from "./FilePicker";
import { Button, Dots, Icon, Notice } from "./ui";

export interface Material {
  id: number;
  name: string;
  chars: number;
  createdAt: number;
}

/** Roughly how many lesson-context characters the materials take: lessons see up to 250 000. */
const LESSON_BUDGET = 250_000;

/** Files the tutor teaches from: add more, remove what is no longer needed. */
export function MaterialsTab({ topicId, files, onChanged }: { topicId: number; files: Material[]; onChanged: () => Promise<void> }) {
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [skipVision, setSkipVision] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = files.reduce((n, f) => n + f.chars, 0);

  const add = async () => {
    setBusy(true);
    setError(null);
    setStatus("Загружаю файлы…");
    let failed = false;
    try {
      await streamPost(
        `/api/topics/${topicId}/files`,
        { uploads: picked.map(({ name, content, base64 }) => ({ name, content, base64 })), skipVision, stream: true },
        (e) => {
          if (e.type === "status") setStatus(e.text);
          else if (e.type === "error") {
            failed = true;
            setError(e.message);
          }
        },
      );
      if (!failed) {
        setPicked([]);
        await onChanged();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setStatus(null);
    setBusy(false);
  };

  const remove = async (id: number) => {
    setError(null);
    try {
      await api(`/api/topics/${topicId}/files?file=${id}`, { method: "DELETE" });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-4">
      <p className="max-w-[70ch] text-sm text-muted">
        Файлы, по которым учит репетитор: план, объяснения и вопросы строятся на их содержании. Они же идут в конспект и экзамен. Изменения учитываются со следующего урока.
      </p>
      {files.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border bg-surface">
          {files.map((f, i) => (
            <li key={f.id} style={{ "--i": Math.min(i, 10) } as React.CSSProperties} className="enter group flex items-center gap-3 px-3 py-2">
              <Icon name="file" className="text-accent" />
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{f.name}</span>
              <span className="shrink-0 text-xs text-muted tabular-nums">{f.chars.toLocaleString("ru-RU")} симв.</span>
              <span className="hidden shrink-0 text-xs text-muted sm:inline">{formatDate(f.createdAt)}</span>
              <button
                onClick={() => remove(f.id)}
                aria-label={`Удалить ${f.name}`}
                title="Удалить"
                className="grid size-7 shrink-0 place-items-center rounded-sm text-muted opacity-60 group-hover:opacity-100 hover:bg-surface-2 hover:text-bad"
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {total > LESSON_BUDGET && (
        <Notice tone="warn">
          Материалов {total.toLocaleString("ru-RU")} символов, а урок видит первые {LESSON_BUDGET.toLocaleString("ru-RU")}: остальное обрезается. Оставь главное или раздели на несколько тем.
        </Notice>
      )}
      <FilePicker files={picked} onChange={setPicked} skipVision={skipVision} onSkipVision={setSkipVision} />
      {busy && status && (
        <div className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
          <Dots /> {status}
        </div>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
      {picked.length > 0 && (
        <Button variant="primary" onClick={add} disabled={busy}>
          <Icon name="plus" /> {busy ? "Добавляю…" : `Добавить ${picked.length === 1 ? "файл" : `файлы (${picked.length})`}`}
        </Button>
      )}
    </div>
  );
}
