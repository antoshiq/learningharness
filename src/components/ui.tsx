"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { useWorkbench } from "./workbench-context";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/**
 * Keeps an overlay mounted for a moment after it is closed so it can play its
 * exit animation. `closing` is true during that moment.
 */
export function usePresence(open: boolean, ms = 160) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open || !mounted) return;
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => setMounted(false), reduced ? 0 : ms);
    return () => clearTimeout(t);
  }, [open, mounted, ms]);
  return { mounted: open || mounted, closing: !open && mounted };
}

// ---------------------------------------------------------------------------
// Icons: thin outlines, the weight of the editor's own icon set.
// A plain string is drawn on a 16px grid; [path, 24] on a 24px grid.
// ---------------------------------------------------------------------------

const ICONS = {
  files: "M9.5 1.5H4a.5.5 0 0 0-.5.5v9.5a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V3.5l-2-2zm0 0v2h2M5.5 12v2a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V6l-2-2",
  gear: [
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    24,
  ],
  search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.6 10.6l3.9 3.9",
  sidebar: "M2.5 2.5h11v11h-11zM6 2.5v11",
  pin: "M6 1.5h4l-.5 4.5 2 2.5h-7l2-2.5L6 1.5zM8 8.5v6",
  file: "M9.5 1.5H4a.5.5 0 0 0-.5.5v12a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V4.5l-3-3zm0 0v3h3",
  repo: "M4.5 1.5h8v10h-8a1.5 1.5 0 0 0 0 3h8v-3M4.5 1.5A1.5 1.5 0 0 0 3 3v10M6.5 4.5h3",
  chevron: "M6 3.5L10.5 8 6 12.5",
  close: "M3.5 3.5l9 9M12.5 3.5l-9 9",
  check: "M2.5 8.5l3.5 3.5 7.5-8",
  cross: "M3.5 3.5l9 9M12.5 3.5l-9 9",
  half: "M3 8h10",
  skip: "M4 4l5 4-5 4M12 4v8",
  play: "M4.5 2.5v11l9-5.5-9-5.5z",
  up: "M8 13V3M3.5 7.5L8 3l4.5 4.5",
  down: "M8 3v10M3.5 8.5L8 13l4.5-4.5",
  clock: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 4.5V8l2.5 1.5",
  book: "M2.5 3.5c2-1 3.5-1 5.5 0 2-1 3.5-1 5.5 0v9c-2-1-3.5-1-5.5 0-2-1-3.5-1-5.5 0v-9zM8 3.5v9",
  info: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 7.5v3.5M8 5v.5",
  plus: "M8 3v10M3 8h10",
  chart: "M2.5 13.5h11M4.5 11V8M7 11V4.5M9.5 11V6.5M12 11V2.5",
  target: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 8h.01",
  redo: "M13 3v3.5H9.5M12.7 6.5A5.5 5.5 0 1 0 13 10",
  sun: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1.1 1.1M11.9 11.9L13 13M3 13l1.1-1.1M11.9 4.1L13 3",
  moon: "M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z",
  download: "M8 2v8.5M4.5 7L8 10.5 11.5 7M2.5 13.5h11",
  upload: "M8 10.5V2M4.5 5.5L8 2l3.5 3.5M2.5 13.5h11",
  note: "M3.5 1.5h9v13h-9zM5.5 4.5h5M5.5 7h5M5.5 9.5h3",
  flame: "M8 14.5c2.5 0 4.5-1.8 4.5-4.3 0-2.7-2.3-4.2-3-6.7-.9 1.2-1.3 2.3-1.2 3.5C7.3 6 6.4 5 6.2 3.5 4.6 5 3.5 7 3.5 10.2c0 2.5 2 4.3 4.5 4.3z",
  trash: "M2.5 4h11M6 4V2.5h4V4M4 4l.7 10h6.6L12 4M6.5 6.5v5M9.5 6.5v5",
  calendar: "M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3",
  chat: "M2.5 3.5h11v7.5H8L5 13.5V11H2.5z",
  cards: "M4.5 2.5h9v9h-9zM2.5 4.5v9h9",
  compass: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM10.5 5.5l-1.4 3.6-3.6 1.4 1.4-3.6 3.6-1.4z",
  contrast: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 1.5v13M8 4h4M8 7h5.5M8 10h5M8 13h2.5",
  keyboard: "M1.5 4h13v8h-13zM4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M5 9.5h6",
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const def = ICONS[name];
  const [d, grid] = typeof def === "string" ? [def, 16] : def;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${grid} ${grid}`}
      fill="none"
      stroke="currentColor"
      // Keep the same visual weight whichever grid the icon was drawn on.
      strokeWidth={(size >= 24 ? 1 : 1.2) * (grid / 16)}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx("shrink-0", className)}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent-strong text-accent-fg hover:bg-accent-hover disabled:opacity-45",
  secondary: "bg-surface-2 text-text border border-border-strong hover:border-muted hover:text-bright disabled:opacity-45",
  ghost: "text-muted hover:text-bright hover:bg-surface-2 disabled:opacity-40",
  danger: "border border-bad text-bad hover:bg-bad-soft disabled:opacity-40",
};
const buttonBase = "inline-flex items-center justify-center gap-1.5 rounded-sm font-normal whitespace-nowrap transition-[color,background-color,border-color,transform] duration-150 select-none active:scale-[0.97] disabled:active:scale-100";
// Compact like an editor on desktop, finger-sized on a phone.
const buttonSize = (small?: boolean) => (small ? "min-h-9 px-2.5 text-[13px] sm:min-h-[26px]" : "min-h-10 px-3.5 text-sm sm:min-h-[30px] sm:text-[13px]");

export function Button({
  variant = "secondary",
  small,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean }) {
  return <button type="button" {...rest} className={cx(buttonBase, buttonSize(small), VARIANT[variant], className)} />;
}

export function LinkButton({
  href,
  variant = "secondary",
  small,
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  small?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={cx(buttonBase, buttonSize(small), VARIANT[variant], className)}>
      {children}
    </Link>
  );
}

/** A panel: the darker chrome surface with a hairline border. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-md border border-border bg-surface p-4 sm:p-5", className)}>{children}</div>;
}

/** Header of a panel. */
export function PanelTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 border-b border-border px-3">
      <h2 className="text-[13px] font-semibold text-bright">{children}</h2>
      {right}
    </div>
  );
}

export const inputClass =
  "w-full rounded-sm border border-border-strong bg-input px-2.5 py-2 text-text placeholder:text-muted/80 transition-[border-color,box-shadow] duration-150 focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] focus:outline-none sm:py-1.5";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] text-bright">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[13px] text-muted">{hint}</span>}
    </label>
  );
}

/** One-of-several choice: a row of joined toggle buttons. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T | null;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="flex overflow-hidden rounded-sm border border-border-strong" role="group" aria-label={label}>
      {options.map(([v, text], i) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={cx(
            "min-h-10 flex-1 px-2 text-[13px] transition-colors sm:min-h-[28px]",
            i > 0 && "border-l border-border-strong",
            value === v ? "bg-accent-strong text-accent-fg" : "bg-input text-text hover:bg-surface-2",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

type Tone = "neutral" | "ok" | "bad" | "warn" | "accent";
const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  ok: "bg-ok-soft text-ok",
  bad: "bg-bad-soft text-bad",
  warn: "bg-warn-soft text-warn",
  accent: "bg-accent-soft text-accent",
};
const TONE_TEXT: Record<Tone, string> = { neutral: "text-muted", ok: "text-ok", bad: "text-bad", warn: "text-warn", accent: "text-accent" };
const TONE_EDGE: Record<Tone, string> = { neutral: "border-l-border-strong", ok: "border-l-ok", bad: "border-l-bad", warn: "border-l-warn", accent: "border-l-accent" };

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-sm px-1.5 py-px text-[11px] whitespace-nowrap", TONE[tone])}>{children}</span>;
}

/** Counter pill, as on the activity bar and view tabs. */
export function Count({ n, active }: { n: number; active?: boolean }) {
  return (
    <span className={cx("inline-grid h-4 min-w-4 place-items-center rounded-full px-1 text-[11px] leading-none tabular-nums", active ? "bg-accent-strong text-accent-fg" : "bg-surface-2 text-text")}>
      {n}
    </span>
  );
}

/** Inline message, shaped like an editor notification. */
export function Notice({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div className={cx("flex gap-2.5 rounded-sm border border-l-2 border-border bg-surface px-3 py-2 text-[13px] [overflow-wrap:anywhere]", TONE_EDGE[tone])}>
      <Icon name={tone === "bad" ? "cross" : tone === "ok" ? "check" : "info"} className={cx("mt-0.5", TONE_TEXT[tone])} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Result of a graded answer: a test-status icon with its label. */
export function Mark({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  const icon = tone === "ok" ? "check" : tone === "bad" ? "cross" : tone === "warn" ? "half" : "skip";
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[13px] font-semibold", TONE_TEXT[tone], className)}>
      <span className={cx("pop grid size-[18px] place-items-center rounded-full", TONE[tone])}>
        <Icon name={icon} size={12} className="[stroke-width:2]" />
      </span>
      {children}
    </span>
  );
}

/**
 * Progress as a row of squares, one per idea of the plan:
 * solid green when mastered, hatched while being learned.
 */
export function Cells({ total, mastered, learning = 0 }: { total: number; mastered: number; learning?: number }) {
  const label = `Освоено ${mastered} из ${total}`;
  if (total > 40) {
    return (
      <div className="flex h-1.5 overflow-hidden bg-surface-2" role="img" aria-label={label}>
        <div className="grow-x bg-ok" style={{ width: `${(mastered / total) * 100}%` }} />
        <div className="cell-learning" style={{ width: `${(learning / total) * 100}%` }} />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-[3px]" role="img" aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} style={{ "--i": i } as CSSProperties} className={cx("cell-in size-2.5 rounded-[1px]", i < mastered ? "bg-ok" : i < mastered + learning ? "cell-learning" : "bg-surface-2 ring-1 ring-border-strong ring-inset")} />
      ))}
    </div>
  );
}

/** Command-palette style widget on desktop, bottom sheet on phones. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  const { mounted, closing } = usePresence(open);
  if (!mounted) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-start sm:px-4 sm:pt-[12dvh]" role="dialog" aria-modal="true" aria-label={title} inert={closing}>
      <div className={cx(closing ? "fade-out" : "fade-in", "absolute inset-0 bg-black/45")} onClick={onClose} />
      <div
        className={cx(
          closing ? "sheet-out" : "sheet-in",
          "sheet-bottom relative flex max-h-[88dvh] w-full flex-col rounded-t-lg border border-border-strong bg-surface shadow-widget sm:max-h-[80dvh] sm:rounded-lg",
          wide ? "sm:max-w-3xl" : "sm:max-w-lg",
        )}
      >
        <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border pr-1.5 pl-4">
          <h2 className="text-[13px] font-semibold text-bright">{title}</h2>
          <button onClick={onClose} aria-label="Закрыть" className="grid size-8 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-bright">
            <Icon name="close" />
          </button>
        </div>
        <div className="safe-bottom overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function Dots() {
  return (
    <span className="inline-flex gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="dot size-1.5 rounded-full bg-accent" style={{ animationDelay: `${i * 0.2}s` }} />
      ))}
    </span>
  );
}

export function Loading() {
  return (
    <div className="flex items-center gap-2.5 p-6 text-[13px] text-muted">
      <Dots /> Загрузка
    </div>
  );
}

export function Page({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return <main className={cx("enter mx-auto w-full px-4 pt-6 pb-16 sm:px-8 sm:pt-9", narrow ? "max-w-3xl" : "max-w-5xl")}>{children}</main>;
}

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="1.5" y="1.5" width="17" height="17" rx="3" fill="var(--accent-strong)" />
      <path d="M6 7l3 3-3 3M11 13h3.5" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Editor group chrome: tab strip with breadcrumbs, and the status bar.
// The title bar, activity bar and side bar live in Workbench.tsx.
// ---------------------------------------------------------------------------

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Top of the editor group: the open "file" as a tab, and the path to it as
 * breadcrumbs. `status` fills the blue status bar at the bottom of the window.
 */
export function TopNav({
  tab,
  icon = "file",
  crumbs = [],
  right,
  status,
  busy,
}: {
  tab: string;
  icon?: IconName;
  crumbs?: Crumb[];
  right?: ReactNode;
  status?: ReactNode;
  busy?: boolean;
}) {
  const trail: Crumb[] = [{ label: "Репетитор", href: "/" }, ...crumbs];
  const { model, mock, openPalette } = useWorkbench();
  return (
    <>
      <header className="sticky top-0 z-30 bg-bg">
        <div className="flex h-10 items-center border-b border-border bg-surface px-1.5">
          <div className="flex h-7 max-w-[70%] items-center gap-2 rounded-md bg-surface-2 px-2.5 text-[13px] text-bright">
            <Icon name={icon} className="text-accent" />
            <span className="truncate">{tab}</span>
          </div>
          <div className="flex flex-1 items-center justify-end gap-1 px-2">{right}</div>
        </div>
        <nav className="flex h-7 items-center gap-0.5 overflow-hidden px-3 text-[13px] text-muted" aria-label="Путь">
          {trail.map((c, i) => (
            <span key={i} className="flex min-w-0 items-center gap-0.5">
              {i > 0 && <Icon name="chevron" size={14} className="opacity-70" />}
              {c.href ? (
                <Link href={c.href} className="truncate rounded-sm px-1 hover:text-bright">
                  {c.label}
                </Link>
              ) : (
                <span className="truncate px-1">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
        <div className="h-0.5 overflow-hidden" aria-hidden>
          {busy && <div className="progress-bar h-full w-1/4 bg-accent-strong" />}
        </div>
      </header>
      <footer className="fixed inset-x-0 bottom-0 z-40 hidden h-7 items-center gap-4 bg-chrome px-3.5 pt-px text-xs whitespace-nowrap text-muted sm:flex">
        <span className="flex items-center gap-1.5 text-accent">
          <Icon name="book" size={14} />
          Репетитор
        </span>
        {status}
        <span className="flex-1" />
        {(mock || model) && (
          <Link href="/settings" className="flex h-full items-center gap-1.5 rounded-sm px-1.5 hover:bg-surface-2 hover:text-bright" title="Модель, которая ведёт уроки. Открыть настройки">
            <Icon name="gear" size={14} />
            {mock ? "тестовая модель" : model}
          </Link>
        )}
        <button onClick={openPalette} className="flex h-full items-center gap-1.5 rounded-sm px-1.5 hover:bg-surface-2 hover:text-bright" title="Поиск и команды">
          <Icon name="search" size={14} />
          Ctrl+K
        </button>
      </footer>
    </>
  );
}

/** One item of the status bar. Put `className="ml-auto"` on the first right-aligned one. */
export function StatusItem({ icon, children, className, title }: { icon?: IconName; children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={cx("flex items-center gap-1.5 tabular-nums", className)} title={title}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

/** A key or key combination, as printed in menus. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx("rounded-sm border border-border-strong bg-surface-2 px-1.5 py-px font-sans text-[11px] text-text", className)}>{children}</kbd>;
}

/**
 * Page-level keyboard shortcuts. `typing` is true when focus is in a text
 * field or the code editor, so plain letters must be left alone. Nothing fires
 * while a dialog (sheet, command palette) is open.
 */
export function KeyHandler({ onKey }: { onKey: (e: KeyboardEvent, typing: boolean) => void }) {
  const handle = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.isComposing || e.repeat) return;
    if (document.querySelector('[role="dialog"]')) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    onKey(e, typing);
  });
  useEffect(() => {
    // Capture phase: Ctrl+Enter must reach us before the code editor inserts a line.
    const f = (e: KeyboardEvent) => handle(e);
    window.addEventListener("keydown", f, true);
    return () => window.removeEventListener("keydown", f, true);
  }, []);
  return null;
}

/** Ctrl+Enter (Cmd+Enter on a Mac). */
export const isSubmitKey = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && e.key === "Enter";
/** The H key on both Latin and Russian layouts. */
export const isKey = (e: KeyboardEvent, latin: string) => !e.ctrlKey && !e.metaKey && e.code === `Key${latin.toUpperCase()}`;
