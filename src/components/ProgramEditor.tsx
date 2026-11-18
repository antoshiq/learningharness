"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { BookView, ModuleView } from "@/server/semester";
import { Badge, Button, cx, fieldClass, Icon, inputClass, Notice, Sheet } from "./ui";

interface EditSection {
  title: string;
  summary: string;
  refs: number[];
  /** Labels of the referenced book sections, for display. */
  sources: string[];
}

interface EditModule {
  id?: number;
  part: string;
  title: string;
  summary: string;
  hours: number;
  sections: EditSection[];
}

const pages = (from: number, to: number) => (from === to ? `стр. ${from}` : `стр. ${from}–${to}`);

const fromView = (modules: ModuleView[]): EditModule[] =>
  modules
    .filter((m) => m.kind === "regular")
    .map((m) => ({
      id: m.id,
      part: m.part,
      title: m.title,
      summary: m.summary,
      hours: m.hours,
      sections: m.sections.map((s) => ({ title: s.title, summary: s.summary, refs: s.refs, sources: s.sources.map((x) => `${x.book} · ${pages(x.pageFrom, x.pageTo)}`) })),
    }));

function move<T>(list: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

interface Outline {
  id: number;
  level: number;
  title: string;
  pageFrom: number;
  pageTo: number;
}

/** Pick sections of a book to add to a module. */
function BookPicker({ semesterId, books, onPick, onClose }: { semesterId: number; books: BookView[]; onPick: (s: EditSection[]) => void; onClose: () => void }) {
  const ready = books.filter((b) => b.status === "ready");
  const [bookId, setBookId] = useState<number | null>(ready[0]?.id ?? null);
  const [outline, setOutline] = useState<Record<number, Outline[]>>({});
  const [chosen, setChosen] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loaded = bookId !== null && !!outline[bookId];
  useEffect(() => {
    if (bookId === null || loaded) return;
    let live = true;
    api<{ sections: Outline[] }>(`/api/semesters/${semesterId}/books/${bookId}`)
      .then((r) => live && setOutline((o) => ({ ...o, [bookId]: r.sections })))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [semesterId, bookId, loaded]);
  const load = (id: number) => setBookId(id);
  const book = ready.find((b) => b.id === bookId);
  const list = bookId ? outline[bookId] : undefined;

  return (
    <Sheet open onClose={onClose} title="Добавить разделы из книги" wide>
      {!ready.length ? (
        <p className="text-sm text-muted">Нет размеченных книг.</p>
      ) : (
        <div className="space-y-3">
          {ready.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {ready.map((b) => (
                <button key={b.id} onClick={() => load(b.id)} aria-pressed={b.id === bookId} className={cx("h-8 rounded-sm border px-2.5 text-[13px]", b.id === bookId ? "border-accent bg-accent-soft text-bright" : "border-border-strong text-muted")}>
                  {b.name}
                </button>
              ))}
            </div>
          )}
          {error && <Notice tone="bad">{error}</Notice>}
          {!list ? (
            <p className="text-sm text-muted">Загрузка…</p>
          ) : (
            <ul className="max-h-[50dvh] overflow-y-auto rounded-sm border border-border">
              {list.map((s) => {
                const on = chosen.includes(s.id);
                return (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-2 py-1 text-sm hover:bg-surface-2" style={{ paddingLeft: `${s.level * 12}px` }}>
                      <input type="checkbox" className="size-4" checked={on} onChange={() => setChosen((c) => (on ? c.filter((x) => x !== s.id) : [...c, s.id]))} />
                      <span className="min-w-0 flex-1 truncate">{s.title}</span>
                      <span className="shrink-0 text-xs text-muted">{pages(s.pageFrom, s.pageTo)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <Button
            variant="primary"
            disabled={!chosen.length}
            onClick={() => {
              const picked = (list ?? []).filter((s) => chosen.includes(s.id));
              onPick(picked.map((s) => ({ title: s.title, summary: "", refs: [s.id], sources: [`${book?.name} · ${pages(s.pageFrom, s.pageTo)}`] })));
              onClose();
            }}
          >
            Добавить: {chosen.length}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

/**
 * The draft program: parts, modules and sections. Everything can be renamed,
 * reordered, removed and added (also straight from a book's outline).
 */
export function ProgramEditor({
  semesterId,
  modules,
  books,
  onSaved,
  onDirty,
}: {
  semesterId: number;
  modules: ModuleView[];
  books: BookView[];
  onSaved: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [list, setList] = useState<EditModule[]>(() => fromView(modules));
  const [dirty, setDirtyState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<number | null>(null);
  const hasBooks = books.some((b) => b.status === "ready");

  const update = (next: EditModule[]) => {
    setList(next);
    setDirtyState(true);
    onDirty(true);
  };
  const setModule = (i: number, patch: Partial<EditModule>) => update(list.map((m, k) => (k === i ? { ...m, ...patch } : m)));
  const setSection = (i: number, j: number, patch: Partial<EditSection>) =>
    setModule(i, { sections: list[i].sections.map((s, k) => (k === j ? { ...s, ...patch } : s)) });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/semesters/${semesterId}/program`, { method: "PUT", body: { modules: list } });
      setDirtyState(false);
      onDirty(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const total = list.reduce((n, m) => n + (Number(m.hours) || 0), 0);

  return (
    <div className="space-y-3">
      {list.map((m, i) => {
        const newPart = m.part && (i === 0 || list[i - 1].part !== m.part);
        return (
          <div key={m.id ?? `new-${i}`}>
            {newPart && (
              <div className="mt-4 mb-2 flex items-center gap-2 first:mt-0">
                <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-wide text-muted uppercase">{m.part}</h3>
                <Button
                  small
                  variant="ghost"
                  title="Убрать всю часть из программы"
                  onClick={() => {
                    if (confirm(`Убрать из программы всю часть «${m.part}»?`)) update(list.filter((x) => x.part !== m.part));
                  }}
                >
                  <Icon name="trash" size={14} /> Часть
                </Button>
              </div>
            )}
            <section className="rounded-md border border-border bg-surface">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-2.5 py-1.5">
                <span className="w-7 shrink-0 text-center text-xs text-muted tabular-nums">{i + 1}</span>
                <input className={cx(inputClass, "min-w-0 flex-1 py-1 font-medium text-bright sm:py-0.5")} value={m.title} onChange={(e) => setModule(i, { title: e.target.value })} aria-label="Название модуля" />
                <label className="flex items-center gap-1 text-xs text-muted">
                  <input type="number" min={0.5} step={0.5} className={cx(fieldClass, "w-16 py-1 text-right sm:py-0.5")} value={m.hours} onChange={(e) => setModule(i, { hours: Number(e.target.value) })} aria-label="Часов на модуль" />ч
                </label>
                <div className="flex">
                  <button onClick={() => update(move(list, i, -1))} disabled={i === 0} aria-label="Выше" className="grid size-7 place-items-center rounded-sm text-muted hover:text-bright disabled:opacity-30">
                    <Icon name="up" size={14} />
                  </button>
                  <button onClick={() => update(move(list, i, 1))} disabled={i === list.length - 1} aria-label="Ниже" className="grid size-7 place-items-center rounded-sm text-muted hover:text-bright disabled:opacity-30">
                    <Icon name="down" size={14} />
                  </button>
                  <button onClick={() => update(list.filter((_, k) => k !== i))} aria-label="Убрать модуль" className="grid size-7 place-items-center rounded-sm text-muted hover:text-bad">
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
              <div className="space-y-2 px-2.5 py-2">
                <input className={cx(inputClass, "py-1 text-[13px] sm:py-0.5")} value={m.summary} placeholder="О чём модуль" onChange={(e) => setModule(i, { summary: e.target.value })} aria-label="Описание модуля" />
                <input className={cx(inputClass, "py-1 text-[13px] sm:py-0.5")} value={m.part} placeholder="Часть курса (необязательно)" onChange={(e) => setModule(i, { part: e.target.value })} aria-label="Часть курса" />
                <ol className="space-y-1">
                  {m.sections.map((s, j) => (
                    <li key={j} className="flex flex-wrap items-center gap-1.5 rounded-sm px-1 py-0.5 hover:bg-surface-2/60">
                      <span className="w-5 shrink-0 text-right text-xs text-muted tabular-nums">{j + 1}.</span>
                      <input className="min-w-[12rem] flex-1 bg-transparent px-1 py-0.5 text-sm focus:outline-none" value={s.title} onChange={(e) => setSection(i, j, { title: e.target.value })} aria-label="Название раздела" />
                      {s.sources.length ? (
                        s.sources.map((src) => (
                          <Badge key={src} tone="accent">
                            {src}
                          </Badge>
                        ))
                      ) : hasBooks ? (
                        <Badge tone="warn">не из твоих материалов</Badge>
                      ) : null}
                      <button onClick={() => setModule(i, { sections: move(m.sections, j, -1) })} disabled={j === 0} aria-label="Раздел выше" className="grid size-6 place-items-center text-muted hover:text-bright disabled:opacity-30">
                        <Icon name="up" size={12} />
                      </button>
                      <button onClick={() => setModule(i, { sections: move(m.sections, j, 1) })} disabled={j === m.sections.length - 1} aria-label="Раздел ниже" className="grid size-6 place-items-center text-muted hover:text-bright disabled:opacity-30">
                        <Icon name="down" size={12} />
                      </button>
                      <button onClick={() => setModule(i, { sections: m.sections.filter((_, k) => k !== j) })} aria-label="Убрать раздел" className="grid size-6 place-items-center text-muted hover:text-bad">
                        <Icon name="close" size={12} />
                      </button>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap gap-1.5">
                  <Button small variant="ghost" onClick={() => setModule(i, { sections: [...m.sections, { title: "Новый раздел", summary: "", refs: [], sources: [] }] })}>
                    <Icon name="plus" size={14} /> Раздел
                  </Button>
                  {hasBooks && (
                    <Button small variant="ghost" onClick={() => setPicker(i)}>
                      <Icon name="book" size={14} /> Из книги
                    </Button>
                  )}
                  <Button
                    small
                    variant="ghost"
                    onClick={() => update([...list.slice(0, i + 1), { part: m.part, title: "Новый модуль", summary: "", hours: 4, sections: [{ title: "Новый раздел", summary: "", refs: [], sources: [] }] }, ...list.slice(i + 1)])}
                  >
                    <Icon name="plus" size={14} /> Модуль после
                  </Button>
                </div>
              </div>
            </section>
          </div>
        );
      })}

      <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface/95 px-3 py-2 backdrop-blur">
        <span className="text-[13px] text-muted">
          {list.length} модулей · {total} ч
        </span>
        <span className="flex-1" />
        {dirty && <span className="text-xs text-warn">Есть несохранённые правки</span>}
        <Button small variant="primary" disabled={!dirty || busy} onClick={save}>
          {busy ? "Сохраняю…" : "Сохранить программу"}
        </Button>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      {picker !== null && (
        <BookPicker
          semesterId={semesterId}
          books={books}
          onClose={() => setPicker(null)}
          onPick={(secs) => setModule(picker, { sections: [...list[picker].sections, ...secs] })}
        />
      )}
    </div>
  );
}
