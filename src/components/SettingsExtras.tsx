"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatDate } from "@/lib/api";
import {
  DESIGN_STYLES,
  STYLE_META,
  THEME_LABEL,
  UI_LABEL,
  useDesignStyle,
  useThemePref,
  useUiStyle,
  type DesignStyle,
  type ThemePref,
  type UiStyle,
} from "@/lib/theme";
import type { AppConfig, TheoryDepth } from "@/lib/types";
import { Badge, Button, Card, cx, Icon, inputClass, Notice, Segmented, Sheet } from "./ui";
import { notifyChanged } from "./workbench-context";

/** Mini schematic preview of each design style's unique layout & palette. */
function StyleThumb({ id, swatches: [bg, surface, accent] }: { id: DesignStyle; swatches: [string, string, string] }) {
  const line = "rgba(150,150,165,0.28)";
  return (
    <div
      className="relative mb-2 h-16 w-full overflow-hidden border"
      style={{
        background: bg,
        borderColor: line,
        borderRadius: id === "gruvbox" ? 0 : id === "catppuccin" ? 12 : id === "linear" ? 10 : 6,
      }}
      aria-hidden
    >
      {id === "vscode" && (
        <>
          <div className="absolute inset-y-0 left-0 w-3 border-r" style={{ background: surface, borderColor: line }} />
          <div className="absolute inset-x-0 top-0 h-2.5 border-b" style={{ background: surface, borderColor: line }} />
          <div className="absolute top-4 left-5 h-2 w-12 rounded-xs" style={{ background: accent, opacity: 0.85 }} />
          <div className="absolute top-8 left-5 h-5 w-16 rounded-xs border" style={{ background: surface, borderColor: line }} />
        </>
      )}
      {id === "obsidian" && (
        <>
          <div className="absolute inset-y-0 left-0 w-3 border-r" style={{ background: surface, borderColor: line }}>
            <div className="mt-3 h-3 w-0.5" style={{ background: accent }} />
          </div>
          <div className="absolute inset-y-0 left-3 w-7 border-r" style={{ background: surface, borderColor: line, opacity: 0.7 }} />
          <div className="absolute top-0 left-10 h-2.5 w-10 border-t-2" style={{ background: bg, borderColor: accent }} />
          <div className="absolute top-5 left-12 h-7 w-14 rounded-sm border-l-2" style={{ background: surface, borderColor: accent }} />
        </>
      )}
      {id === "paper" && (
        <>
          <div className="absolute inset-x-0 top-0 flex h-3.5 items-center justify-between border-b px-2" style={{ background: surface, borderColor: line }}>
            <div className="h-1 w-6" style={{ background: accent }} />
            <div className="flex gap-1">
              <div className="h-1 w-3" style={{ background: line }} />
              <div className="h-1 w-3" style={{ background: line }} />
            </div>
          </div>
          <div className="mx-auto mt-5 flex w-16 flex-col gap-1">
            <div className="h-1.5 w-10" style={{ background: accent, opacity: 0.85 }} />
            <div className="h-1 w-full" style={{ background: line }} />
            <div className="h-1 w-4/5" style={{ background: line }} />
          </div>
        </>
      )}
      {id === "catppuccin" && (
        <>
          <div className="mx-auto mt-1.5 h-2 w-14 rounded-full" style={{ background: surface }} />
          <div className="mx-auto mt-1.5 h-6 w-20 rounded-lg" style={{ background: surface }} />
          <div className="absolute bottom-1.5 left-1/2 flex h-3.5 -translate-x-1/2 items-center gap-1 rounded-full px-2" style={{ background: surface, border: `1px solid ${line}` }}>
            <span className="size-1.5 rounded-full" style={{ background: accent }} />
            <span className="size-1.5 rounded-full" style={{ background: line }} />
            <span className="size-1.5 rounded-full" style={{ background: line }} />
          </div>
        </>
      )}
      {id === "gruvbox" && (
        <>
          <div className="absolute inset-x-0 top-0 flex h-3 items-center gap-1 border-b px-1" style={{ background: surface, borderColor: line }}>
            <div className="h-2 w-6" style={{ background: accent }} />
            <div className="h-1.5 w-5" style={{ background: line }} />
          </div>
          <div className="absolute top-5 left-2 h-6 w-16 border" style={{ background: surface, borderColor: line }} />
          <div className="absolute inset-x-0 bottom-0 flex h-2.5 items-center" style={{ background: surface }}>
            <div className="h-full w-6" style={{ background: accent }} />
          </div>
        </>
      )}
      {id === "linear" && (
        <>
          <div className="absolute inset-y-0 left-0 flex w-9 flex-col gap-1 border-r p-1.5" style={{ background: surface, borderColor: line }}>
            <div className="h-1.5 w-full rounded-xs" style={{ background: accent, opacity: 0.85 }} />
            <div className="h-1 w-4/5 rounded-xs" style={{ background: line }} />
            <div className="h-1 w-3/5 rounded-xs" style={{ background: line }} />
          </div>
          <div className="absolute top-2.5 right-2 left-11 h-10 rounded-md border" style={{ background: surface, borderColor: line }} />
        </>
      )}
    </div>
  );
}

export function AppearanceCard() {
  const [pref, setPref] = useThemePref();
  const [ui, setUi] = useUiStyle();
  const [style, setStyle] = useDesignStyle();
  return (
    <Card className="space-y-5">
      <h2 className="text-[15px] font-semibold text-bright">Оформление</h2>

      <div>
        <div className="mb-2 text-[13px] text-bright">Стиль интерфейса</div>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {DESIGN_STYLES.map((id) => {
            const meta = STYLE_META[id];
            const active = style === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setStyle(id)}
                aria-pressed={active}
                className={cx(
                  "flex flex-col rounded-md border p-2.5 text-left transition-colors",
                  active ? "border-accent bg-accent-soft/60 ring-1 ring-accent" : "border-border bg-bg/50 hover:border-border-strong hover:bg-surface-2/60",
                )}
              >
                <StyleThumb id={id} swatches={meta.swatches} />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-bright">{meta.name}</span>
                  <span className="flex items-center gap-1" aria-hidden>
                    {meta.swatches.map((c, i) => (
                      <span key={i} className="size-2.5 rounded-full border border-black/20" style={{ background: c }} />
                    ))}
                  </span>
                </div>
                <span className="mt-0.5 text-xs text-text">{meta.tagline}</span>
                <span className="mt-1 text-[11px] leading-snug text-muted">{meta.layout}</span>
              </button>
            );
          })}
        </div>
      </div>

      {style === "vscode" && (
        <div>
          <div className="mb-1 text-[13px] text-bright">Вид (для VS Code)</div>
          <Segmented label="Вид" value={ui} onChange={setUi} options={(["minimal", "classic"] as UiStyle[]).map((s) => [s, UI_LABEL[s]] as const)} />
          <p className="mt-1 text-sm text-muted">
            {ui === "minimal"
              ? "Спокойный: одна страница без рамок окна, основные разделы слева, остальное — через Ctrl+K."
              : "Как в редакторе кода: все разделы на панели, проводник, вкладка и строка состояния снизу."}
          </p>
        </div>
      )}

      <div>
        <div className="mb-1 text-[13px] text-bright">Тема</div>
        <Segmented
          label="Тема"
          value={pref}
          onChange={setPref}
          options={(["system", "light", "dark"] as ThemePref[]).map((p) => [p, THEME_LABEL[p]] as const)}
        />
      </div>
      <p className="text-sm text-muted">Выбор хранится в этом браузере. Стиль и тему можно быстро менять и через Ctrl+K.</p>
    </Card>
  );
}

/** How many answers a day the learner aims for. */
export function GoalCard({ cfg, put }: { cfg: AppConfig; put: (body: unknown) => Promise<void> }) {
  const [value, setValue] = useState(String(cfg.dailyGoal));
  const n = Math.round(Number(value));
  const valid = Number.isFinite(n) && n >= 1 && n <= 500;
  return (
    <Card className="space-y-3">
      <div id="goal" className="scroll-mt-20">
        <h2 className="text-[15px] font-semibold text-bright">Цель на день</h2>
        <p className="mt-1 text-sm text-muted">Сколько ответов в день ты хочешь давать: в уроках, повторении, работе над ошибками и экзаменах вместе. Прогресс — кольцо на главной и в статистике.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className={cx(inputClass, "max-w-24 tabular-nums")} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Ответов в день" />
        <span className="text-sm text-muted">ответов в день</span>
        {[5, 10, 20, 30].map((g) => (
          <Button key={g} small variant="ghost" onClick={() => setValue(String(g))}>
            {g}
          </Button>
        ))}
        <Button variant="primary" disabled={!valid || n === cfg.dailyGoal} onClick={() => put({ dailyGoal: n })}>
          Сохранить
        </Button>
      </div>
      {!valid && <p className="text-sm text-bad">От 1 до 500</p>}
    </Card>
  );
}

const DEPTH_OPTIONS: { value: TheoryDepth; label: string; text: string }[] = [
  { value: "brief", label: "Кратко", text: "Суть, формулировка и один пример, дальше сразу задачи. Подробнее — по кнопке на уроке." },
  { value: "balanced", label: "Обычно", text: "Зачем, точная формулировка, интуиция, разобранные примеры и частые ошибки, затем проверка." },
  { value: "detailed", label: "Подробно", text: "Основательная теория на несколько экранов: выводы и доказательства, примеры разной сложности, связи с другими идеями." },
];

/** How much theory the tutor gives on a new idea before the questions. */
export function TheoryCard({ cfg, put }: { cfg: AppConfig; put: (body: unknown) => Promise<void> }) {
  return (
    <Card className="space-y-3">
      <div id="theory" className="scroll-mt-20">
        <h2 className="text-[15px] font-semibold text-bright">Теория в уроках</h2>
        <p className="mt-1 text-sm text-muted">
          Сколько объяснять новую идею перед вопросами. Длинная теория идёт по экранам с кнопкой «Дальше», а «Объясни подробнее» на уроке разберёт текущую идею глубже
          при любом выборе. Действует с ближайшего хода.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {DEPTH_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => o.value !== cfg.theoryDepth && put({ theoryDepth: o.value })}
            aria-pressed={o.value === cfg.theoryDepth}
            className={cx(
              "rounded-md border p-3 text-left transition-colors",
              o.value === cfg.theoryDepth ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2",
            )}
          >
            <div className="text-sm font-medium text-bright">{o.label}</div>
            <div className="mt-1 text-xs text-muted">{o.text}</div>
          </button>
        ))}
      </div>
    </Card>
  );
}

/** Daily spending cap: model calls stop for the day once it is reached. */
export function LimitCard({ cfg, put }: { cfg: AppConfig; put: (body: unknown) => Promise<void> }) {
  const [value, setValue] = useState(cfg.dailyLimit === null ? "" : String(cfg.dailyLimit));
  const parsed = value.trim() === "" ? null : Number(value.replace(",", "."));
  const invalid = parsed !== null && (!Number.isFinite(parsed) || parsed <= 0);
  const dirty = parsed !== cfg.dailyLimit;
  const pct = cfg.dailyLimit ? Math.min(100, (cfg.spentToday / cfg.dailyLimit) * 100) : 0;
  return (
    <Card className="space-y-3">
      <div id="limit" className="scroll-mt-20">
        <h2 className="text-[15px] font-semibold text-bright">Дневной лимит расходов</h2>
        <p className="mt-1 text-sm text-muted">
          Когда за сутки потрачено больше лимита, уроки, боковые вопросы и конспекты ставятся на паузу до полуночи. Учитываются вызовы с известной ценой; подписка Claude и свой
          сервер в лимит не входят. Повторение без репетитора работает всегда.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted">$</span>
        <input
          className={cx(inputClass, "max-w-32 tabular-nums")}
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="без лимита"
          aria-label="Лимит в долларах в день"
        />
        <span className="text-sm text-muted">в день</span>
        <Button variant="primary" disabled={!dirty || invalid} onClick={() => put({ dailyLimit: parsed })}>
          Сохранить
        </Button>
        {cfg.dailyLimit !== null && (
          <Button
            variant="ghost"
            onClick={() => {
              setValue("");
              put({ dailyLimit: null });
            }}
          >
            Снять лимит
          </Button>
        )}
      </div>
      {invalid && <p className="text-sm text-bad">Нужно положительное число, например 2 или 0.5</p>}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted tabular-nums">
          <span>Сегодня потрачено ${cfg.spentToday.toFixed(cfg.spentToday < 0.01 && cfg.spentToday > 0 ? 4 : 2)}</span>
          {cfg.dailyLimit !== null && <span>из ${cfg.dailyLimit.toFixed(2)}</span>}
        </div>
        {cfg.dailyLimit !== null && (
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className={cx("grow-x h-full rounded-full", pct >= 100 ? "bg-bad" : pct >= 80 ? "bg-warn" : "bg-ok")} style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </Card>
  );
}

interface BackupInfo {
  name: string;
  size: number;
  at: number;
  auto: boolean;
}

const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

/** Download a copy of all progress, restore from a file or from an automatic copy. */
export function DataCard() {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [confirm, setConfirm] = useState<{ label: string; run: () => Promise<{ savedAs: string }> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const list = useCallback(() => {
    api<{ backups: BackupInfo[] }>("/api/backup?list=1")
      .then((r) => setBackups(r.backups))
      .catch(() => setBackups([]));
  }, []);
  useEffect(() => list(), [list]);

  const restore = async () => {
    if (!confirm) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await confirm.run();
      setMsg({ tone: "ok", text: `Данные восстановлены. Прежнее состояние сохранено как ${r.savedAs}: его можно вернуть из списка ниже.` });
      notifyChanged();
      list();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
    setConfirm(null);
  };

  const upload = async (f: File) => {
    const res = await fetch("/api/backup", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: f });
    const data = (await res.json().catch(() => ({}))) as { savedAs?: string; error?: string };
    if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
    return { savedAs: data.savedAs! };
  };

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold text-bright">Данные</h2>
        <p className="mt-1 text-sm text-muted">
          Весь прогресс — темы, планы, уроки, ответы и расписание повторений — хранится в одном файле. Скачай его, чтобы перенести на другой компьютер или сохранить копию. Ключи
          доступа в копию не входят.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href="/api/backup"
          className="inline-flex h-[34px] items-center gap-1.5 rounded-sm bg-accent-strong px-3 text-accent-fg transition-colors hover:bg-accent-hover sm:h-[30px]"
          download
        >
          <Icon name="download" /> Скачать резервную копию
        </a>
        <Button onClick={() => file.current?.click()}>
          <Icon name="upload" /> Восстановить из файла
        </Button>
        <input
          ref={file}
          type="file"
          accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3,application/x-sqlite3"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) setConfirm({ label: `файла «${f.name}»`, run: () => upload(f) });
          }}
        />
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div>
        <h3 className="mb-1.5 text-[13px] font-semibold text-bright">Сохранённые копии</h3>
        <p className="mb-2 text-sm text-muted">
          При каждом запуске через start.sh или start.cmd делается автоматическая копия, хранятся последние пять. Перед восстановлением текущее состояние тоже сохраняется сюда.
        </p>
        {backups === null ? null : backups.length === 0 ? (
          <p className="text-sm text-muted">Копий пока нет.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {backups.map((b) => (
              <li key={b.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{b.name}</span>
                {b.auto ? <Badge>авто</Badge> : <Badge tone="accent">перед восстановлением</Badge>}
                <span className="text-xs text-muted tabular-nums">
                  {formatDate(b.at)} · {size(b.size)}
                </span>
                <Button
                  small
                  variant="ghost"
                  onClick={() =>
                    setConfirm({ label: `копии от ${formatDate(b.at)}`, run: () => api<{ savedAs: string }>(`/api/backup?name=${encodeURIComponent(b.name)}`, { body: {} }) })
                  }
                >
                  Восстановить
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Sheet open={!!confirm} onClose={() => !busy && setConfirm(null)} title="Восстановить данные?">
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Текущие темы, уроки и прогресс заменятся данными из {confirm?.label}. Перед этим текущее состояние сохранится в «Сохранённые копии», так что шаг можно отменить.
          </p>
          <Button variant="danger" className="w-full" onClick={restore} disabled={busy}>
            {busy ? "Восстанавливаю…" : "Восстановить"}
          </Button>
        </div>
      </Sheet>
    </Card>
  );
}
