"use client";

import { useEffect, type ReactNode } from "react";
import { FONT_MAX, FONT_MIN, useEditorPrefs } from "@/lib/editor-prefs";
import { cx, Icon } from "./ui";

const btn = "grid h-6 min-w-6 place-items-center rounded-sm px-1 text-[12px] text-muted hover:bg-surface-2 hover:text-bright disabled:opacity-40";

/** Font size and line wrapping, shared by every code editor. */
export function EditorPrefsButtons() {
  const [p, set] = useEditorPrefs();
  return (
    <span className="flex items-center gap-0.5">
      <button type="button" className={btn} onClick={() => set({ fontSize: p.fontSize - 1 })} disabled={p.fontSize <= FONT_MIN} title="Мельче" aria-label="Уменьшить шрифт">
        A−
      </button>
      <span className="w-6 text-center text-[11px] text-muted tabular-nums">{p.fontSize}</span>
      <button type="button" className={btn} onClick={() => set({ fontSize: p.fontSize + 1 })} disabled={p.fontSize >= FONT_MAX} title="Крупнее" aria-label="Увеличить шрифт">
        A+
      </button>
      <button
        type="button"
        className={cx(btn, p.wrap && "bg-surface-2 text-bright")}
        onClick={() => set({ wrap: !p.wrap })}
        aria-pressed={p.wrap}
        title="Переносить длинные строки"
        aria-label="Перенос строк"
      >
        ↵
      </button>
    </span>
  );
}

/**
 * A code editor with a thin toolbar above it. `full` stretches it over the
 * whole window (Esc returns); the page behind keeps its state.
 */
export function EditorFrame({
  title,
  children,
  actions,
  full,
  onFull,
}: {
  title: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  full: boolean;
  onFull: (v: boolean) => void;
}) {
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onFull(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [full, onFull]);

  return (
    <div className={cx(full ? "fade-in fixed inset-0 z-50 flex flex-col bg-bg p-2 sm:p-4" : "space-y-1")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">{title}</span>
        <span className="flex-1" />
        {actions}
        <EditorPrefsButtons />
        <button type="button" className={btn} onClick={() => onFull(!full)} title={full ? "Свернуть (Esc)" : "Во весь экран"} aria-label={full ? "Свернуть редактор" : "Редактор во весь экран"}>
          <Icon name={full ? "close" : "sidebar"} size={13} />
        </button>
      </div>
      <div className={cx(full && "mt-2 min-h-0 flex-1")}>{children}</div>
    </div>
  );
}

export const toolButton = btn;
