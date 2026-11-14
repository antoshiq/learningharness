"use client";

import Link from "next/link";
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90 disabled:opacity-40",
  secondary: "bg-surface border border-border text-text hover:bg-surface-2 disabled:opacity-40",
  ghost: "text-muted hover:text-text hover:bg-surface-2 disabled:opacity-40",
  danger: "bg-surface border border-bad text-bad hover:bg-bad-soft disabled:opacity-40",
};

export function Button({
  variant = "secondary",
  small,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors select-none",
        small ? "min-h-9 px-3 text-sm" : "min-h-11 px-4 text-[15px]",
        VARIANT[variant],
        className,
      )}
    />
  );
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
    <Link
      href={href}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
        small ? "min-h-9 px-3 text-sm" : "min-h-11 px-4 text-[15px]",
        VARIANT[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-xl border border-border bg-surface p-4 sm:p-5", className)}>{children}</div>;
}

export const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-text placeholder:text-muted focus:border-accent focus:outline-none";

type Tone = "neutral" | "ok" | "bad" | "warn" | "accent";
const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  ok: "bg-ok-soft text-ok",
  bad: "bg-bad-soft text-bad",
  warn: "bg-warn-soft text-warn",
  accent: "bg-accent-soft text-accent",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONE[tone])}>{children}</span>;
}

export function Notice({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={cx("rounded-lg px-3.5 py-2.5 text-sm [overflow-wrap:anywhere]", TONE[tone])}>{children}</div>;
}

/** Bottom sheet on phones, centered dialog on wider screens. */
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
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div
        className={cx(
          "relative flex max-h-[88dvh] w-full flex-col rounded-t-2xl border border-border bg-surface shadow-xl sm:rounded-2xl",
          wide ? "sm:max-w-3xl" : "sm:max-w-lg",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Закрыть" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text">
            ✕
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
        <span key={i} className="dot size-1.5 rounded-full bg-muted" style={{ animationDelay: `${i * 0.2}s` }} />
      ))}
    </span>
  );
}

export function Page({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return <main className={cx("mx-auto w-full px-4 pt-4 pb-24 sm:px-6 sm:pt-8", narrow ? "max-w-2xl" : "max-w-4xl")}>{children}</main>;
}

export function TopNav({ back, title, right }: { back?: { href: string; label: string }; title?: string; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-13 max-w-4xl items-center gap-2 px-3 sm:px-6">
        {back ? (
          <Link href={back.href} className="-ml-1 flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm text-muted hover:bg-surface-2 hover:text-text">
            <span aria-hidden>←</span> {back.label}
          </Link>
        ) : (
          <Link href="/" className="px-1 font-semibold">
            Репетитор
          </Link>
        )}
        <div className="min-w-0 flex-1 truncate text-center text-sm font-medium">{title}</div>
        <div className="flex items-center gap-1">{right}</div>
      </div>
    </header>
  );
}
