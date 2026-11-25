"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api, formatDate } from "@/lib/api";
import {
  DESIGN_STYLES,
  STYLE_META,
  THEME_LABEL,
  useDesignStyle,
  useThemePref,
  useUiStyle,
  type DesignStyle,
  type ThemePref,
} from "@/lib/theme";
import type { AppConfig, PlanNodeView } from "@/lib/types";
import type { SessionView, TopicCard } from "@/server/sessions";
import { Count, cx, Icon, Logo, usePresence, type IconName } from "./ui";
import { CHANGED_EVENT, NEW_TOPIC_EVENT, WorkbenchContext } from "./workbench-context";

const KIND = { lesson: "Урок", practice: "Практика", review: "Повторение" } as const;

/** What the side bar needs about the topic that is open right now. */
interface TopicDetail {
  topic: { id: number; title: string };
  plan: PlanNodeView[];
  sessions: { id: number; kind: keyof typeof KIND; startedAt: number; endedAt: number | null }[];
  parking: { id: number; text: string; done: boolean }[];
}

const SIDEBAR_KEY = "tutor.sidebar";

// ---------------------------------------------------------------------------
// Side bar
// ---------------------------------------------------------------------------

function Section({ title, count, children, defaultOpen = true }: { title: string; count?: number; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-t border-border first:border-t-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-7 w-full items-center gap-0.5 px-2 text-[13px] font-semibold text-bright"
      >
        <Icon name="chevron" size={14} className={cx("transition-transform", open && "rotate-90")} />
        <span className="flex-1 truncate text-left">{title}</span>
        {!!count && <span className="pr-2 font-normal text-muted tabular-nums">{count}</span>}
      </button>
      <div className="fold" data-open={open}>
        <div>
          <div className="px-1.5 pb-2">{children}</div>
        </div>
      </div>
    </section>
  );
}

/** Rows slide in one after another when a list first appears; long lists stop staggering early. */
const stagger = (i: number) => ({ "--i": Math.min(i, 10) }) as CSSProperties;

const rowClass = (active?: boolean) =>
  cx("enter flex h-[24px] w-full items-center gap-1.5 rounded-md pr-2 pl-4 text-left text-[13px] transition-colors duration-100", active ? "bg-surface-2 text-bright" : "text-text hover:bg-surface-2/60");

function NodeDot({ n }: { n: PlanNodeView }) {
  return (
    <span
      className={cx(
        "size-2.5 shrink-0 rounded-[1px]",
        n.status === "mastered" ? "bg-ok" : n.status === "learning" ? "cell-learning" : n.available ? "bg-accent-soft ring-1 ring-accent ring-inset" : "ring-1 ring-border-strong ring-inset",
      )}
    />
  );
}

function SideBar({
  open,
  topics,
  detail,
  topicId,
  sessionId,
  now,
  style,
  onClose,
}: {
  open: boolean;
  topics: TopicCard[] | null;
  detail: TopicDetail | null;
  topicId: number | null;
  sessionId: number | null;
  now: number;
  style: DesignStyle;
  onClose?: () => void;
}) {
  const parked = detail?.parking.filter((p) => !p.done) ?? [];
  const title =
    style === "obsidian"
      ? "Хранилище"
      : style === "paper"
        ? "Оглавление"
        : style === "gruvbox"
          ? "[дерево]"
          : "Проводник";
  const frameClass =
    style === "obsidian"
      ? "fixed top-9 bottom-0 left-11 z-30 hidden w-[252px] flex-col overflow-y-auto border-r border-border bg-chrome lg:flex"
      : style === "paper"
        ? "fixed top-14 bottom-0 left-0 z-40 flex w-[272px] flex-col overflow-y-auto border-r border-border bg-surface shadow-widget"
        : style === "catppuccin"
          ? "fixed top-14 bottom-20 left-3 z-40 flex w-[264px] flex-col overflow-y-auto rounded-2xl border border-border-strong bg-surface/95 shadow-widget backdrop-blur-md"
          : style === "gruvbox"
            ? "fixed top-9 bottom-7 left-0 z-30 hidden w-[250px] flex-col overflow-y-auto border-r border-border-strong bg-surface font-mono lg:flex"
            : "fixed top-9 bottom-7 left-[60px] z-30 hidden w-[250px] flex-col overflow-y-auto rounded-lg border border-border bg-surface lg:flex minimal:bottom-0 minimal:rounded-none minimal:border-y-0 minimal:border-l";

  return (
    <aside
      className={cx(
        "glide transition-[transform,opacity] duration-200 ease-out",
        frameClass,
        !open && "pointer-events-none -translate-x-6 opacity-0",
      )}
      aria-label={title}
      inert={!open}
    >
      <div className="flex h-10 shrink-0 items-center justify-between px-3.5 text-[13px] font-semibold text-bright">
        <span>{title}</span>
        {(style === "paper" || style === "catppuccin") && onClose && (
          <button onClick={onClose} aria-label="Закрыть" className="grid size-7 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-bright">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      <Section title="Темы" count={topics?.length}>
        {topics === null ? (
          <p className="px-4 py-1 text-xs text-muted">Загрузка…</p>
        ) : topics.length === 0 ? (
          <p className="px-4 py-1 text-xs text-muted">Тем пока нет. Создай первую на главной.</p>
        ) : (
          topics.map((t, i) => (
            <Link key={t.id} style={stagger(i)} href={`/topics/${t.id}`} className={rowClass(t.id === topicId)} title={t.goal || t.title}>
              <Icon name={t.kind === "repo" ? "repo" : "file"} className="text-accent" />
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              {t.due > 0 ? <Count n={t.due} active /> : t.total > 0 && <span className="text-xs text-muted tabular-nums">{t.mastered}/{t.total}</span>}
            </Link>
          ))
        )}
      </Section>

      {detail && (
        <>
          <Section title="План" count={detail.plan.length}>
            {detail.plan.length === 0 ? (
              <p className="px-4 py-1 text-xs text-muted">Появится после диагностики на первом уроке.</p>
            ) : (
              detail.plan.map((n, i) => {
                const locked = n.status === "new" && !n.available;
                const due = n.status !== "new" && n.dueAt !== null && n.dueAt <= now;
                return (
                  <Link key={n.key} style={stagger(i)} href={`/topics/${detail.topic.id}`} className={rowClass()} title={n.summary || n.title}>
                    <NodeDot n={n} />
                    <span className={cx("min-w-0 flex-1 truncate", locked && "text-muted")}>{n.title}</span>
                    {due && <span className="text-[11px] text-warn">повторить</span>}
                  </Link>
                );
              })
            )}
          </Section>

          <Section title="Сессии" count={detail.sessions.length}>
            {detail.sessions.length === 0 ? (
              <p className="px-4 py-1 text-xs text-muted">Сессий ещё не было.</p>
            ) : (
              detail.sessions.slice(0, 12).map((s, i) => (
                <Link key={s.id} style={stagger(i)} href={`/session/${s.id}`} className={rowClass(s.id === sessionId)}>
                  <Icon name="book" className={s.endedAt ? "text-muted" : "text-ok"} />
                  <span className="shrink-0">{KIND[s.kind]}</span>
                  <span className="min-w-0 flex-1 truncate text-right text-xs text-muted">{s.endedAt ? formatDate(s.startedAt) : "идёт"}</span>
                </Link>
              ))
            )}
          </Section>

          <Section title="Парковка" count={parked.length} defaultOpen={parked.length > 0}>
            {parked.length === 0 ? (
              <p className="px-4 py-1 text-xs text-muted">Отложенных мыслей нет.</p>
            ) : (
              parked.map((p, i) => (
                <Link key={p.id} style={stagger(i)} href={`/topics/${detail.topic.id}`} className={rowClass()} title={p.text}>
                  <Icon name="pin" className="text-muted" />
                  <span className="min-w-0 flex-1 truncate">{p.text}</span>
                </Link>
              ))
            )}
          </Section>
        </>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Command palette
// ---------------------------------------------------------------------------

interface Command {
  id: string;
  icon: IconName;
  label: string;
  hint?: string;
  /** Second line: a found passage. */
  detail?: string;
  run: () => void;
}

interface SearchHit {
  kind: "topic" | "brief" | "notes" | "question" | "card" | "parking" | "ask";
  title: string;
  snippet: string;
  href: string;
}
const HIT: Record<SearchHit["kind"], { icon: IconName; label: string }> = {
  topic: { icon: "file", label: "тема" },
  brief: { icon: "compass", label: "экскурс" },
  notes: { icon: "note", label: "конспект" },
  question: { icon: "target", label: "вопрос" },
  card: { icon: "cards", label: "карточка" },
  parking: { icon: "pin", label: "парковка" },
  ask: { icon: "chat", label: "вопрос к проекту" },
};

function Palette({ commands, onClose, closing, navigate }: { commands: Command[]; onClose: () => void; closing?: boolean; navigate: (href: string) => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const list = useRef<HTMLUListElement>(null);

  // Full-text search over everything, a moment after typing stops.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      api<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => setHits(r.hits))
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const own = commands.filter((c) => words.every((w) => `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(w)));
    const found: Command[] = hits
      .filter((h) => !(h.kind === "topic" && own.some((c) => c.label === h.title)))
      .map((h, i) => ({ id: `hit${i}`, icon: HIT[h.kind].icon, label: h.title, hint: HIT[h.kind].label, detail: h.kind === "topic" ? undefined : h.snippet, run: () => navigate(h.href) }));
    return [...own, ...found];
  }, [commands, query, hits, navigate]);
  const at = Math.min(index, Math.max(0, shown.length - 1));

  useEffect(() => {
    list.current?.children[at]?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const run = (c?: Command) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center px-3 pt-1.5" role="dialog" aria-modal="true" aria-label="Палитра команд" inert={closing}>
      <div className={cx(closing ? "fade-out" : "fade-in", "absolute inset-0 bg-black/30")} onClick={onClose} />
      <div className={cx(closing ? "sheet-out" : "sheet-in", "relative flex max-h-[70dvh] w-full max-w-[600px] flex-col self-start rounded-lg border border-border-strong bg-surface shadow-widget")}>
        <div className="p-1.5">
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex(Math.min(at + 1, shown.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex(Math.max(at - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(shown[at]);
              } else if (e.key === "Escape") onClose();
            }}
            placeholder="Тема, команда или поиск по всему"
            className="w-full rounded-sm border border-accent bg-input px-2 py-1.5 text-text placeholder:text-muted focus:outline-none sm:py-1"
            aria-label="Поиск темы или команды"
          />
        </div>
        <ul ref={list} className="overflow-y-auto px-1.5 pb-1.5" role="listbox">
          {shown.length === 0 && <li className="px-2 py-1.5 text-[13px] text-muted">{searching ? "Ищу…" : "Ничего не найдено"}</li>}
          {shown.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === at}>
              <button
                onClick={() => run(c)}
                onMouseMove={() => setIndex(i)}
                className={cx("flex min-h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px] sm:min-h-[26px]", i === at ? "bg-surface-2 text-bright" : "text-text")}
              >
                <Icon name={c.icon} className={cx("self-start mt-[5px] sm:mt-[3px]", i === at ? "" : "text-muted")} />
                <span className="min-w-0 flex-1 py-0.5">
                  <span className="block truncate">{c.label}</span>
                  {c.detail && <span className="line-clamp-2 block text-xs text-muted">{c.detail}</span>}
                </span>
                {c.hint && <span className="shrink-0 self-start pt-0.5 text-xs text-muted">{c.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

/** Window chrome around every page: title bar, activity bar, side bar, command palette. */
export function Workbench({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [topics, setTopics] = useState<TopicCard[] | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [detail, setDetail] = useState<TopicDetail | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const [palette, setPalette] = useState(false);
  const [themePref, setThemePref] = useThemePref();
  const [uiStyle, setUiStyle] = useUiStyle();
  const [designStyle, setDesignStyle] = useDesignStyle();
  const paletteShown = usePresence(palette, 110);
  const [now, setNow] = useState(() => Date.now());

  const bare = path === "/login";
  const sessionId = /^\/session\/(\d+)/.exec(path)?.[1];
  const topicIdInPath = /^\/topics\/(\d+)/.exec(path)?.[1];

  const refresh = useCallback(async () => {
    if (bare) return;
    setNow(Date.now());
    api<{ topics: TopicCard[] }>("/api/topics")
      .then((d) => setTopics(d.topics))
      .catch(() => {});
    api<AppConfig>("/api/settings")
      .then(setConfig)
      .catch(() => {});
    try {
      let id = topicIdInPath ?? null;
      if (!id && sessionId) id = String((await api<SessionView>(`/api/sessions/${sessionId}`)).topic.id);
      setDetail(id ? await api<TopicDetail>(`/api/topics/${id}`) : null);
    } catch {
      setDetail(null);
    }
  }, [bare, sessionId, topicIdInPath]);

  useEffect(() => {
    refresh();
    window.addEventListener(CHANGED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(CHANGED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  useEffect(() => {
    try {
      // The explorer starts hidden in the minimal look, unless it was opened before.
      const saved = localStorage.getItem(SIDEBAR_KEY);
      if (saved === "0" || (saved === null && document.documentElement.getAttribute("data-ui") !== "classic")) setSidebar(false);
    } catch {}
  }, []);
  const toggleSidebar = useCallback(() => {
    setSidebar((v) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, v ? "0" : "1");
      } catch {}
      return !v;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "k" || (k === "p" && e.shiftKey)) {
        e.preventDefault();
        setPalette((v) => !v);
      } else if (k === "b" && !e.shiftKey) {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [];
    for (const t of topics ?? []) {
      if (t.openSessionId) out.push({ id: `c${t.id}`, icon: "play", label: `Продолжить урок: ${t.title}`, run: () => router.push(`/session/${t.openSessionId}`) });
    }
    out.push({
      id: "new",
      icon: "plus",
      label: "Новая тема",
      run: () => (window.location.pathname === "/" ? window.dispatchEvent(new Event(NEW_TOPIC_EVENT)) : router.push("/?new=1")),
    });
    for (const t of topics ?? []) {
      out.push({
        id: `t${t.id}`,
        icon: t.kind === "repo" ? "repo" : "file",
        label: t.title,
        hint: t.due ? `повторить: ${t.due}` : t.total ? `освоено ${t.mastered} из ${t.total}` : "тема",
        run: () => router.push(`/topics/${t.id}`),
      });
    }
    out.push({ id: "brief", icon: "compass", label: "Быстрый экскурс", hint: "тема, файлы, ссылка или проект", run: () => router.push("/brief") });
    out.push({ id: "semester", icon: "cap", label: "Семестр", hint: "полный курс по учебнику или теме", run: () => router.push("/semester") });
    out.push({ id: "plan", icon: "calendar", label: "Подготовка к дате", hint: "план до экзамена", run: () => router.push("/plan") });
    out.push({ id: "sandbox", icon: "play", label: "Песочница кода", hint: "Python, JavaScript и SQL", run: () => router.push("/sandbox") });
    out.push({ id: "review-code", icon: "target", label: "Разбор моего кода", run: () => router.push("/brief?kind=review") });
    out.push({ id: "ask", icon: "chat", label: "Вопрос к проекту", hint: "папка или GitHub", run: () => router.push("/ask") });
    out.push({ id: "review", icon: "clock", label: "Повторение на сегодня", hint: "без репетитора", run: () => router.push("/review") });
    out.push({ id: "mistakes", icon: "target", label: "Работа над ошибками", run: () => router.push("/mistakes") });
    out.push({ id: "stats", icon: "chart", label: "Статистика и расходы", run: () => router.push("/stats") });
    out.push({ id: "home", icon: "files", label: "Все темы", run: () => router.push("/") });
    out.push({ id: "settings", icon: "gear", label: "Настройки: ключи и модели", run: () => router.push("/settings") });
    out.push({ id: "sidebar", icon: "sidebar", label: "Показать или скрыть проводник", hint: "Ctrl+B", run: toggleSidebar });
    for (const s of DESIGN_STYLES) {
      if (s === designStyle) continue;
      out.push({
        id: `design-${s}`,
        icon: "contrast",
        label: `Стиль: ${STYLE_META[s].name}`,
        hint: STYLE_META[s].tagline,
        run: () => setDesignStyle(s),
      });
    }
    if (designStyle === "vscode") {
      out.push({
        id: "ui-style",
        icon: "contrast",
        label: uiStyle === "minimal" ? "Вид: подробный (все панели)" : "Вид: минималистичный",
        hint: "оформление",
        run: () => setUiStyle(uiStyle === "minimal" ? "classic" : "minimal"),
      });
    }
    for (const t of ["light", "dark", "system"] as ThemePref[]) {
      if (t === themePref) continue;
      out.push({ id: `theme-${t}`, icon: t === "dark" ? "moon" : "sun", label: `Тема: ${THEME_LABEL[t].toLowerCase()}`, hint: "оформление", run: () => setThemePref(t) });
    }
    out.push({ id: "backup", icon: "download", label: "Скачать резервную копию данных", run: () => {
        // A file download, not a page: an <a download> keeps the app where it is.
        const a = document.createElement("a");
        a.href = "/api/backup";
        a.download = "";
        a.click();
      },
    });
    return out;
  }, [topics, router, toggleSidebar, themePref, setThemePref, uiStyle, setUiStyle, designStyle, setDesignStyle]);

  const openPalette = useCallback(() => setPalette(true), []);
  const navigate = useCallback((href: string) => router.push(href), [router]);
  const ctx = useMemo(
    () => ({ topics, model: config?.roles.strong.model ?? null, mock: !!config?.mockEnabled, openPalette }),
    [topics, config, openPalette],
  );

  if (bare) return <>{children}</>;

  const inSettings = path.startsWith("/settings");
  const section = path.startsWith("/semester")
    ? "semester"
    : path.startsWith("/plan")
      ? "plan"
      : path.startsWith("/sandbox")
        ? "sandbox"
        : path.startsWith("/ask")
          ? "ask"
          : path.startsWith("/brief")
            ? "brief"
            : path.startsWith("/review")
              ? "review"
              : path.startsWith("/mistakes")
                ? "mistakes"
                : path.startsWith("/stats")
                  ? "stats"
                  : inSettings
                    ? "settings"
                    : "topics";
  const dueTotal = (topics ?? []).reduce((s, t) => s + t.due, 0);
  const cycleTheme = () => setThemePref(themePref === "dark" ? "light" : themePref === "light" ? "system" : "dark");
  const themeIcon: IconName = themePref === "dark" ? "moon" : themePref === "light" ? "sun" : "contrast";

  const activity = (href: string, icon: IconName, label: string, active: boolean, badge = 0, extra?: string) => (
    <Link
      href={href}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cx("relative mx-auto grid size-9 place-items-center rounded-lg transition-[color,background-color,transform] duration-150 active:scale-90", active ? "bg-surface-2 text-bright" : "text-muted hover:text-bright", extra)}
    >
      <Icon name={icon} size={22} />
      {badge > 0 && (
        <span className="absolute -right-1 -bottom-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent-strong px-1 text-[10px] leading-none text-white tabular-nums">{badge}</span>
      )}
    </Link>
  );

  // ---- 1. OBSIDIAN LAYOUT: left ribbon with violet bar + collapsible vault ----
  if (designStyle === "obsidian") {
    const ribbonItem = (href: string, icon: IconName, label: string, active: boolean, badge = 0) => (
      <Link
        href={href}
        title={label}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cx(
          "relative mx-auto grid size-9 place-items-center rounded-md transition-colors",
          active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-bright",
        )}
      >
        {active && <span className="absolute top-1.5 bottom-1.5 -left-1 w-[3px] rounded-r-full bg-accent" />}
        <Icon name={icon} size={19} />
        {badge > 0 && (
          <span className="absolute -right-0.5 -bottom-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent-strong px-1 text-[10px] leading-none text-accent-fg tabular-nums">
            {badge}
          </span>
        )}
      </Link>
    );
    return (
      <WorkbenchContext.Provider value={ctx}>
        <div className="fixed inset-x-0 top-0 z-40 flex h-9 items-center gap-2 border-b border-border bg-chrome px-2">
          <Link href="/" className="flex shrink-0 items-center gap-2 px-1 text-[13px] font-semibold text-bright" aria-label="Репетитор">
            <Logo size={17} />
            <span className="hidden sm:inline">Репетитор</span>
          </Link>
          <button
            onClick={toggleSidebar}
            title="Показать или скрыть хранилище (Ctrl+B)"
            aria-label="Показать или скрыть хранилище"
            aria-pressed={sidebar}
            className="hidden size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-bright lg:grid"
          >
            <Icon name="sidebar" />
          </button>
          <button
            onClick={openPalette}
            className="mx-auto flex h-6 w-full max-w-[440px] items-center justify-center gap-2 rounded-full border border-border bg-input px-3 text-xs text-muted hover:border-accent/60 hover:text-text"
          >
            <Icon name="search" size={13} className="text-accent" />
            <span className="truncate">{detail ? detail.topic.title : "Быстрый переход по хранилищу"}</span>
            <kbd className="hidden rounded bg-surface-2 px-1.5 font-mono text-[10px] sm:inline">Ctrl+K</kbd>
          </button>
          <button onClick={cycleTheme} aria-label="Сменить тему" className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-bright">
            <Icon name={themeIcon} size={16} />
          </button>
          <Link href="/settings" aria-label="Настройки" className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-bright sm:hidden">
            <Icon name="gear" size={16} />
          </Link>
        </div>

        <nav className="fixed top-9 bottom-0 left-0 z-40 hidden w-11 flex-col gap-1.5 border-r border-border bg-chrome py-2.5 sm:flex" aria-label="Разделы">
          {ribbonItem("/", "files", "Темы", section === "topics")}
          {ribbonItem("/semester", "cap", "Семестр", section === "semester")}
          {ribbonItem("/brief", "compass", "Быстрый экскурс", section === "brief")}
          {ribbonItem("/sandbox", "play", "Песочница", section === "sandbox")}
          {ribbonItem("/review", "clock", "Повторение", section === "review", dueTotal)}
          {ribbonItem("/mistakes", "target", "Работа над ошибками", section === "mistakes")}
          {ribbonItem("/stats", "chart", "Статистика", section === "stats")}
          <div className="flex-1" />
          {ribbonItem("/settings", "gear", "Настройки", section === "settings")}
        </nav>

        <SideBar open={sidebar} topics={topics} detail={detail} topicId={detail?.topic.id ?? null} sessionId={sessionId ? Number(sessionId) : null} now={now} style="obsidian" />

        <div
          id="editor"
          className={cx(
            "glide fixed inset-x-0 top-9 bottom-0 overflow-x-hidden overflow-y-auto bg-bg transition-[left] duration-200 ease-out sm:left-11",
            sidebar && "lg:left-[296px]",
          )}
        >
          {children}
        </div>
        {paletteShown.mounted && <Palette commands={commands} onClose={() => setPalette(false)} closing={paletteShown.closing} navigate={navigate} />}
      </WorkbenchContext.Provider>
    );
  }

  // ---- 2. PAPER / EDITORIAL LAYOUT: top serif masthead, NO side rail ----
  if (designStyle === "paper") {
    const navLink = (href: string, label: string, active: boolean, badge = 0) => (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cx(
          "relative flex h-14 items-center gap-1.5 px-2 text-sm whitespace-nowrap transition-colors",
          active ? "font-semibold text-bright" : "text-muted hover:text-bright",
        )}
      >
        <span>{label}</span>
        {badge > 0 && <Count n={badge} active />}
        {active && <span className="absolute inset-x-1 bottom-0 h-[2px] bg-accent" />}
      </Link>
    );
    return (
      <WorkbenchContext.Provider value={ctx}>
        <header className="fixed inset-x-0 top-0 z-40 h-14 border-b border-border-strong bg-chrome/95 backdrop-blur-sm">
          <div className="mx-auto flex h-full max-w-6xl items-center gap-3 px-4 sm:px-6">
            <button
              onClick={toggleSidebar}
              title="Оглавление (Ctrl+B)"
              aria-label="Оглавление"
              aria-pressed={sidebar}
              className="grid size-8 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-bright"
            >
              <Icon name="sidebar" size={17} />
            </button>
            <Link href="/" className="shrink-0 font-serif text-lg font-semibold tracking-tight text-bright">
              Репетитор
            </Link>
            <nav className="ml-2 hidden flex-1 items-center gap-2 overflow-x-auto md:flex" aria-label="Разделы">
              {navLink("/", "Темы", section === "topics")}
              {navLink("/semester", "Семестр", section === "semester")}
              {navLink("/brief", "Экскурс", section === "brief")}
              {navLink("/review", "Повторение", section === "review", dueTotal)}
              {navLink("/sandbox", "Песочница", section === "sandbox")}
              {navLink("/stats", "Статистика", section === "stats")}
              {navLink("/settings", "Настройки", section === "settings")}
            </nav>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={openPalette}
                className="flex h-8 items-center gap-2 rounded-sm border border-border-strong bg-input px-2.5 text-xs text-muted hover:text-bright"
              >
                <Icon name="search" size={14} />
                <span className="hidden sm:inline">Поиск</span>
                <kbd className="hidden rounded-xs bg-surface-2 px-1 font-mono text-[10px] sm:inline">Ctrl+K</kbd>
              </button>
              <button onClick={cycleTheme} aria-label="Сменить тему" className="grid size-8 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-bright">
                <Icon name={themeIcon} size={17} />
              </button>
              <Link href="/settings" aria-label="Настройки" className="grid size-8 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-bright md:hidden">
                <Icon name="gear" size={17} />
              </Link>
            </div>
          </div>
        </header>

        {sidebar && <div className="fixed inset-0 top-14 z-30 bg-black/25" onClick={toggleSidebar} />}
        <SideBar
          open={sidebar}
          topics={topics}
          detail={detail}
          topicId={detail?.topic.id ?? null}
          sessionId={sessionId ? Number(sessionId) : null}
          now={now}
          style="paper"
          onClose={toggleSidebar}
        />

        <div id="editor" className="fixed inset-x-0 top-14 bottom-0 overflow-x-hidden overflow-y-auto bg-bg">
          {children}
        </div>
        {paletteShown.mounted && <Palette commands={commands} onClose={() => setPalette(false)} closing={paletteShown.closing} navigate={navigate} />}
      </WorkbenchContext.Provider>
    );
  }

  // ---- 3. CATPPUCCIN LAYOUT: floating top pill bar + frosted glass bottom dock ----
  if (designStyle === "catppuccin") {
    const dockItem = (href: string, icon: IconName, label: string, active: boolean, badge = 0) => (
      <Link
        href={href}
        title={label}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cx(
          "relative grid size-10 place-items-center rounded-full transition-[transform,background-color,color] duration-150 hover:-translate-y-0.5 active:scale-95",
          active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-bright",
        )}
      >
        <Icon name={icon} size={20} />
        {active && <span className="absolute bottom-1 size-1 rounded-full bg-accent" />}
        {badge > 0 && (
          <span className="absolute top-0 right-0 grid h-4 min-w-4 place-items-center rounded-full bg-accent-strong px-1 text-[10px] leading-none text-accent-fg tabular-nums">
            {badge}
          </span>
        )}
      </Link>
    );
    return (
      <WorkbenchContext.Provider value={ctx}>
        <div className="fixed inset-x-0 top-0 z-40 flex h-12 items-center gap-2 bg-bg/85 px-3 backdrop-blur-md">
          <button
            onClick={toggleSidebar}
            title="Проводник (Ctrl+B)"
            aria-label="Проводник"
            aria-pressed={sidebar}
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-bright"
          >
            <Icon name="sidebar" size={17} />
          </button>
          <button
            onClick={openPalette}
            className="mx-auto flex h-8 w-full max-w-[440px] items-center justify-center gap-2 rounded-full border border-border bg-surface/90 px-4 text-xs text-muted shadow-xs hover:border-accent/50 hover:text-bright"
          >
            <Icon name="search" size={14} className="text-accent" />
            <span className="truncate">{detail ? detail.topic.title : "Репетитор · найти тему или команду"}</span>
            <kbd className="hidden rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] sm:inline">Ctrl+K</kbd>
          </button>
          <button onClick={cycleTheme} aria-label="Сменить тему" className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-bright">
            <Icon name={themeIcon} size={17} />
          </button>
        </div>

        {sidebar && <div className="fixed inset-0 z-30 bg-black/20" onClick={toggleSidebar} />}
        <SideBar
          open={sidebar}
          topics={topics}
          detail={detail}
          topicId={detail?.topic.id ?? null}
          sessionId={sessionId ? Number(sessionId) : null}
          now={now}
          style="catppuccin"
          onClose={toggleSidebar}
        />

        <div id="editor" className="fixed inset-x-0 top-12 bottom-0 overflow-x-hidden overflow-y-auto bg-bg pb-20">
          {children}
        </div>

        <nav
          className="fixed bottom-3 left-1/2 z-40 flex max-w-[94vw] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full border border-border-strong bg-surface/90 px-2 py-1.5 shadow-widget backdrop-blur-md"
          aria-label="Док разделов"
        >
          {dockItem("/", "files", "Темы", section === "topics")}
          {dockItem("/semester", "cap", "Семестр", section === "semester")}
          {dockItem("/brief", "compass", "Экскурс", section === "brief")}
          {dockItem("/review", "clock", "Повторение", section === "review", dueTotal)}
          {dockItem("/sandbox", "play", "Песочница", section === "sandbox")}
          {dockItem("/stats", "chart", "Статистика", section === "stats")}
          <span className="mx-0.5 h-5 w-px bg-border-strong" aria-hidden />
          {dockItem("/settings", "gear", "Настройки", section === "settings")}
        </nav>

        {paletteShown.mounted && <Palette commands={commands} onClose={() => setPalette(false)} closing={paletteShown.closing} navigate={navigate} />}
      </WorkbenchContext.Provider>
    );
  }

  // ---- 4. GRUVBOX TUI LAYOUT: Tmux numbered top tabline + Vim powerline footer ----
  if (designStyle === "gruvbox") {
    const tmuxTab = (num: number, href: string, label: string, active: boolean, badge = 0) => (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cx(
          "flex h-full shrink-0 items-center gap-1 border-r border-border px-2.5 text-xs transition-colors",
          active ? "bg-accent-strong font-semibold text-accent-fg" : "text-muted hover:bg-surface-2 hover:text-bright",
        )}
      >
        <span>
          {num}:{label}
        </span>
        {badge > 0 && <span className={cx("px-1 text-[10px]", active ? "bg-black/25 text-accent-fg" : "bg-accent-soft text-accent")}>+{badge}</span>}
      </Link>
    );
    return (
      <WorkbenchContext.Provider value={ctx}>
        <div className="fixed inset-x-0 top-0 z-40 flex h-9 items-center border-b border-border-strong bg-chrome font-mono">
          <button
            onClick={toggleSidebar}
            title="Показать/скрыть дерево (Ctrl+B)"
            aria-label="Дерево"
            aria-pressed={sidebar}
            className="hidden h-full shrink-0 items-center border-r border-border-strong bg-surface-2 px-2.5 text-xs font-semibold text-accent hover:bg-surface lg:flex"
          >
            [tree]
          </button>
          <nav className="flex h-full min-w-0 flex-1 items-center overflow-x-auto" aria-label="Вкладки разделов">
            {tmuxTab(1, "/", "темы", section === "topics")}
            {tmuxTab(2, "/semester", "семестр", section === "semester")}
            {tmuxTab(3, "/brief", "экскурс", section === "brief")}
            {tmuxTab(4, "/review", "повтор", section === "review", dueTotal)}
            {tmuxTab(5, "/sandbox", "код", section === "sandbox")}
            {tmuxTab(6, "/stats", "статы", section === "stats")}
            {tmuxTab(7, "/settings", "настр", section === "settings")}
          </nav>
          <button
            onClick={openPalette}
            className="flex h-full shrink-0 items-center gap-1.5 border-l border-border-strong bg-surface px-2.5 text-xs text-muted hover:bg-surface-2 hover:text-bright"
          >
            <Icon name="search" size={13} />
            <span className="hidden sm:inline">:поиск</span>
          </button>
          <button
            onClick={cycleTheme}
            aria-label="Сменить тему"
            className="grid h-full w-9 shrink-0 place-items-center border-l border-border-strong text-muted hover:bg-surface-2 hover:text-bright"
          >
            <Icon name={themeIcon} size={15} />
          </button>
        </div>

        <SideBar open={sidebar} topics={topics} detail={detail} topicId={detail?.topic.id ?? null} sessionId={sessionId ? Number(sessionId) : null} now={now} style="gruvbox" />

        <div
          id="editor"
          className={cx(
            "glide fixed inset-x-0 top-9 bottom-0 overflow-x-hidden overflow-y-auto bg-bg transition-[left] duration-200 ease-out sm:bottom-7",
            sidebar && "lg:left-[250px]",
          )}
        >
          {children}
        </div>
        {paletteShown.mounted && <Palette commands={commands} onClose={() => setPalette(false)} closing={paletteShown.closing} navigate={navigate} />}
      </WorkbenchContext.Provider>
    );
  }

  // ---- 5. LINEAR LAYOUT: full persistent labeled 232px left sidebar + airy canvas ----
  if (designStyle === "linear") {
    const sideItem = (href: string, icon: IconName, label: string, active: boolean, badge = 0) => (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cx(
          "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors",
          active ? "bg-accent-soft font-medium text-accent" : "text-text hover:bg-surface-2 hover:text-bright",
        )}
      >
        <Icon name={icon} size={16} className={active ? "text-accent" : "text-muted"} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge > 0 && <Count n={badge} active />}
      </Link>
    );
    return (
      <WorkbenchContext.Provider value={ctx}>
        {/* Mobile header for Linear (on desktop the full sidebar handles chrome) */}
        <div className="fixed inset-x-0 top-0 z-40 flex h-11 items-center gap-2 border-b border-border bg-chrome px-3 lg:hidden">
          <Link href="/" className="flex items-center gap-2 font-medium text-bright">
            <Logo size={18} />
            <span>Репетитор</span>
          </Link>
          <button
            onClick={openPalette}
            className="ml-auto flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs text-muted"
          >
            <Icon name="search" size={13} />
            Поиск
          </button>
          <button onClick={cycleTheme} aria-label="Сменить тему" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2">
            <Icon name={themeIcon} size={16} />
          </button>
          <Link href="/settings" aria-label="Настройки" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2">
            <Icon name="gear" size={16} />
          </Link>
        </div>

        <aside className="fixed inset-y-0 left-0 z-40 hidden w-[232px] flex-col border-r border-border bg-chrome px-2.5 py-3 lg:flex" aria-label="Навигация">
          <div className="mb-2.5 flex items-center justify-between px-1.5">
            <Link href="/" className="flex items-center gap-2 text-[14px] font-semibold tracking-tight text-bright">
              <Logo size={19} />
              <span>Репетитор</span>
            </Link>
            <button onClick={cycleTheme} title={`Тема: ${THEME_LABEL[themePref].toLowerCase()}`} aria-label="Сменить тему" className="grid size-7 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-bright">
              <Icon name={themeIcon} size={15} />
            </button>
          </div>

          <button
            onClick={openPalette}
            className="mb-3 flex h-8 w-full items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-xs text-muted shadow-2xs transition-colors hover:border-border-strong hover:text-text"
          >
            <Icon name="search" size={14} />
            <span className="flex-1 text-left">Поиск и команды</span>
            <kbd className="rounded bg-surface-2 px-1 font-mono text-[10px]">Ctrl+K</kbd>
          </button>

          <nav className="space-y-0.5" aria-label="Разделы">
            {sideItem("/", "files", "Темы", section === "topics")}
            {sideItem("/semester", "cap", "Семестр", section === "semester")}
            {sideItem("/brief", "compass", "Быстрый экскурс", section === "brief")}
            {sideItem("/plan", "calendar", "Подготовка к дате", section === "plan")}
            {sideItem("/review", "clock", "Повторение", section === "review", dueTotal)}
            {sideItem("/mistakes", "target", "Работа над ошибками", section === "mistakes")}
            {sideItem("/sandbox", "play", "Песочница кода", section === "sandbox")}
            {sideItem("/ask", "chat", "Вопрос к проекту", section === "ask")}
            {sideItem("/stats", "chart", "Статистика", section === "stats")}
          </nav>

          {topics && topics.length > 0 && (
            <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-border pt-3">
              <div className="mb-1.5 px-2 text-[11px] font-semibold tracking-wide text-muted uppercase">Мои темы</div>
              <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
                {topics.slice(0, 14).map((t) => (
                  <Link
                    key={t.id}
                    href={`/topics/${t.id}`}
                    className={cx(
                      "flex h-7 items-center gap-2 rounded-md px-2 text-xs transition-colors",
                      detail?.topic.id === t.id ? "bg-surface-2 font-medium text-bright" : "text-muted hover:bg-surface-2/70 hover:text-text",
                    )}
                    title={t.goal || t.title}
                  >
                    <Icon name={t.kind === "repo" ? "repo" : "file"} size={13} className="text-accent" />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    {t.due > 0 ? <Count n={t.due} active /> : t.total > 0 && <span className="text-[11px] tabular-nums">{t.mastered}/{t.total}</span>}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="mt-auto border-t border-border pt-2">
            {sideItem("/settings", "gear", "Настройки", section === "settings")}
          </div>
        </aside>

        <div id="editor" className="fixed inset-x-0 top-11 bottom-0 overflow-x-hidden overflow-y-auto bg-bg lg:top-0 lg:left-[232px]">
          {children}
        </div>
        {paletteShown.mounted && <Palette commands={commands} onClose={() => setPalette(false)} closing={paletteShown.closing} navigate={navigate} />}
      </WorkbenchContext.Provider>
    );
  }

  // ---- 0. DEFAULT VS CODE LAYOUT (unchanged original interface) ----
  return (
    <WorkbenchContext.Provider value={ctx}>
      {/* Title bar with the command center. It sits straight on the window backdrop. */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-9 items-center gap-2 bg-chrome px-1.5 minimal:border-b minimal:border-border">
        <Link href="/" className="flex shrink-0 items-center gap-2 px-1 sm:w-12 sm:justify-center sm:px-0" aria-label="Репетитор: все темы">
          <Logo size={18} />
        </Link>
        <button onClick={toggleSidebar} title="Показать или скрыть проводник (Ctrl+B)" aria-label="Показать или скрыть проводник" aria-pressed={sidebar} className="hidden size-7 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-bright lg:grid">
          <Icon name="sidebar" />
        </button>
        <button
          onClick={openPalette}
          className="mx-auto flex h-6 w-full max-w-[460px] items-center justify-center gap-2 rounded-md border border-border-strong bg-surface px-2 text-[13px] text-muted hover:bg-surface-2 hover:text-text"
        >
          <Icon name="search" size={14} />
          <span className="truncate">{detail ? detail.topic.title : "Репетитор"}</span>
          <kbd className="hidden rounded-sm bg-surface-2 px-1 font-sans text-[11px] sm:inline">Ctrl+K</kbd>
        </button>
        <Link href="/settings" aria-label="Настройки" className="grid size-7 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-bright sm:hidden">
          <Icon name="gear" />
        </Link>
        <span className="hidden w-[76px] shrink-0 sm:block" />
      </div>

      {/* Icons sit straight on the backdrop; the side bar and the editor are rounded blocks with gaps. */}
      {/* In the minimal look only the main sections stay here; the rest are one Ctrl+K away. */}
      <nav className="fixed top-9 bottom-7 left-1.5 z-40 hidden w-12 flex-col gap-2.5 py-1.5 sm:flex minimal:bottom-0 minimal:gap-3 minimal:pt-3" aria-label="Разделы">
        {activity("/", "files", "Темы", section === "topics")}
        {activity("/semester", "cap", "Семестр", section === "semester")}
        {activity("/plan", "calendar", "Подготовка к дате", section === "plan", 0, section === "plan" ? undefined : "minimal:hidden")}
        {activity("/brief", "compass", "Быстрый экскурс", section === "brief", 0, section === "brief" ? undefined : "minimal:hidden")}
        {activity("/ask", "chat", "Вопрос к проекту", section === "ask", 0, section === "ask" ? undefined : "minimal:hidden")}
        {activity("/review", "clock", "Повторение на сегодня", section === "review", dueTotal)}
        {activity("/mistakes", "target", "Работа над ошибками", section === "mistakes", 0, section === "mistakes" ? undefined : "minimal:hidden")}
        {activity("/stats", "chart", "Статистика", section === "stats")}
        <button onClick={openPalette} title="Поиск и команды (Ctrl+K)" aria-label="Поиск и команды" className="mx-auto grid size-9 place-items-center rounded-lg text-muted transition-[color,transform] duration-150 hover:text-bright active:scale-90">
          <Icon name="search" size={22} />
        </button>
        <div className="flex-1" />
        <button
          onClick={cycleTheme}
          title={`Тема: ${THEME_LABEL[themePref].toLowerCase()}. Нажми, чтобы сменить`}
          aria-label="Сменить тему оформления"
          className="mx-auto grid size-9 place-items-center rounded-lg text-muted transition-[color,transform] duration-150 hover:text-bright active:scale-90"
        >
          <Icon name={themeIcon} size={20} />
        </button>
        {activity("/settings", "gear", "Настройки", section === "settings")}
      </nav>

      {<SideBar open={sidebar} topics={topics} detail={detail} topicId={detail?.topic.id ?? null} sessionId={sessionId ? Number(sessionId) : null} now={now} style="vscode" />}

      <div
        id="editor"
        className={cx(
          "glide fixed inset-x-0 top-9 bottom-0 overflow-x-hidden overflow-y-auto bg-bg transition-[left] duration-200 ease-out sm:right-1.5 sm:bottom-7 sm:left-[60px] sm:rounded-lg sm:border sm:border-border",
          // Minimal: the page fills the window; one hairline separates it from the section icons.
          "minimal:sm:right-0 minimal:sm:bottom-0 minimal:sm:rounded-none minimal:sm:border-y-0 minimal:sm:border-r-0",
          sidebar && "lg:left-[316px]",
        )}
      >
        {children}
      </div>

      {paletteShown.mounted && <Palette commands={commands} onClose={() => setPalette(false)} closing={paletteShown.closing} navigate={navigate} />}
    </WorkbenchContext.Provider>
  );
}
