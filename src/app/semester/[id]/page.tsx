"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BookFiles, uploadBook, type BookFile } from "@/components/BookFiles";
import { ProgramEditor } from "@/components/ProgramEditor";
import { SemesterActive } from "@/components/SemesterActive";
import { Badge, Button, Card, cx, Dots, fieldClass, Icon, Loading, Notice, Page, PanelTitle, TopNav } from "@/components/ui";
import { api, plural } from "@/lib/api";
import { LEVELS, ROLES } from "@/lib/semester";
import type { BookRole } from "@/server/db/schema";
import type { BookView, SemesterView } from "@/server/semester";

const SOURCE: Record<string, string> = {
  bookmarks: "по закладкам PDF",
  toc: "по оглавлению",
  headings: "по заголовкам",
  model: "модель нашла главы",
  pages: "по страницам: структуры не нашлось",
};

function BookRow({ b, semesterId, editable, onChange }: { b: BookView; semesterId: number; editable: boolean; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="book" className={cx("shrink-0", b.status === "error" ? "text-bad" : "text-accent")} />
        <span className="min-w-0 flex-1 truncate">{b.name}</span>
        <span className="text-xs text-muted">
          {b.pages} {b.format === "pdf" ? "стр." : plural(b.pages, "фрагмент", "фрагмента", "фрагментов")}
        </span>
        {b.status === "ocr" && (
          <Badge tone="warn">
            <Dots /> распознаю сканы: {b.ocrDone} из {b.ocrTotal}
          </Badge>
        )}
        {b.status === "outlining" && (
          <Badge tone="warn">
            <Dots /> размечаю
          </Badge>
        )}
        {b.status === "ready" && b.outlineSource && (
          <span className="text-xs text-muted" title={SOURCE[b.outlineSource]}>
            {b.sections} {plural(b.sections, "раздел", "раздела", "разделов")} · {SOURCE[b.outlineSource]}
          </span>
        )}
        {b.status === "ready" && (
          <Link href={`/book/${b.id}`} className="text-xs text-accent hover:underline">
            Открыть
          </Link>
        )}
        {editable ? (
          <select
            className={cx(fieldClass, "py-1 text-[13px] sm:py-0.5")}
            value={b.role}
            aria-label="Роль файла"
            onChange={(e) => act(() => api(`/api/semesters/${semesterId}/books/${b.id}`, { method: "PATCH", body: { role: e.target.value } }))}
          >
            {(Object.keys(ROLES) as BookRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLES[r]}
              </option>
            ))}
          </select>
        ) : (
          <Badge>{ROLES[b.role]}</Badge>
        )}
        {editable && (
          <button
            onClick={() => confirm(`Убрать «${b.name}» из семестра?`) && act(() => api(`/api/semesters/${semesterId}/books/${b.id}`, { method: "DELETE" }))}
            aria-label="Убрать файл"
            className="grid size-7 place-items-center rounded-sm text-muted hover:text-bad"
          >
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>
      {b.error && <p className="mt-1 pl-6 text-xs text-bad">{b.error}</p>}
      {error && <p className="mt-1 pl-6 text-xs text-bad">{error}</p>}
    </li>
  );
}

function Books({ s, onChange }: { s: SemesterView; onChange: () => void }) {
  const [adding, setAdding] = useState<BookFile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = s.status !== "finished";

  const upload = async () => {
    setError(null);
    const failed: string[] = [];
    for (const [i, f] of adding.entries()) {
      setBusy(`Загружаю ${i + 1} из ${adding.length}`);
      try {
        await uploadBook(s.id, f);
      } catch (e) {
        failed.push(`${f.file.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    // A draft re-reads books in the background; an active semester starts on upload.
    if (s.status === "draft" || s.status === "preparing") await api(`/api/semesters/${s.id}/prepare`, { body: { rebuild: false } }).catch(() => {});
    setBusy(null);
    setAdding([]);
    if (failed.length) setError(failed.join(" "));
    onChange();
  };

  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface">
      <PanelTitle>Книги и материалы</PanelTitle>
      {s.books.length > 0 ? (
        <ul className="divide-y divide-border">
          {s.books.map((b) => (
            <BookRow key={b.id} b={b} semesterId={s.id} editable={editable && s.status !== "preparing"} onChange={onChange} />
          ))}
        </ul>
      ) : (
        <p className="px-3 py-2.5 text-sm text-muted">Книг нет: программа составлена по теме и уровню.</p>
      )}
      {editable && s.status !== "preparing" && (
        <div className="space-y-2 border-t border-border p-3">
          <BookFiles files={adding} onChange={setAdding} />
          {adding.length > 0 && (
            <Button small variant="primary" disabled={!!busy} onClick={upload}>
              <Icon name="upload" size={14} /> {busy ?? `Добавить ${adding.length} ${plural(adding.length, "файл", "файла", "файлов")}`}
            </Button>
          )}
          {s.status === "active" && <p className="text-xs text-muted">Новые материалы разметятся и подключатся к урокам модулей по поиску; программа не меняется.</p>}
          {error && <Notice tone="bad">{error}</Notice>}
        </div>
      )}
    </section>
  );
}

function Preparing({ s, failed, onChange }: { s: SemesterView; failed: string | null; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    await api(`/api/semesters/${s.id}/prepare`, { body: {} }).catch(() => {});
    setBusy(false);
    onChange();
  };
  return (
    <Card className="space-y-3">
      <h2 className="text-[15px] font-semibold text-bright">Готовлю программу</h2>
      {failed && <Notice tone="warn">Не все файлы загрузились: {failed}</Notice>}
      {s.error ? (
        <>
          <Notice tone="bad">{s.error}</Notice>
          <Button variant="primary" onClick={retry} disabled={busy}>
            <Icon name="redo" /> Повторить
          </Button>
        </>
      ) : (
        <div className="flex items-center gap-2.5 text-sm text-muted">
          <Dots /> {s.step ?? "Запускаю…"}
        </div>
      )}
      <p className="text-xs text-muted">
        Страницу можно закрыть: подготовка идёт на сервере. Толстая книга без закладок размечается дольше — модель просматривает начало каждой страницы. Сканы
        распознаются прямо на сервере, без модели: примерно 1–5 секунд на страницу, в зависимости от компьютера.
      </p>
    </Card>
  );
}

function Draft({ s, onChange }: { s: SemesterView; onChange: () => void }) {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const over = s.programHours > s.capacityHours * 1.15;
  const regular = s.modules.filter((m) => m.kind === "regular");
  const unread = s.books.some((b) => b.status === "outlining" || b.status === "ocr");

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h2 className="text-[15px] font-semibold text-bright">Проверь программу</h2>
        <p className="text-sm text-muted">
          Это черновик: переименуй, переставь, убери лишнее или добавь разделы из книги. После утверждения программа станет планом семестра, а идеи каждого модуля
          будут составлены перед его началом.
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <span>
            <span className="text-muted">Программа:</span> {s.programHours} ч, {regular.length} {plural(regular.length, "модуль", "модуля", "модулей")}
          </span>
          <span>
            <span className="text-muted">Есть времени:</span> {s.capacityHours} ч ({s.weeks} нед. × {s.hoursPerWeek} ч)
          </span>
          {s.estimateHours && (
            <span>
              <span className="text-muted">Оценка модели:</span> ~{s.estimateHours} ч
            </span>
          )}
        </div>
        {over && (
          <Notice tone="warn">
            Программа больше, чем помещается в семестр: примерно {Math.ceil(s.programHours / s.hoursPerWeek)} недель при {s.hoursPerWeek} ч в неделю. Можно убрать часть
            курса (кнопка у заголовка части) и пройти её следующим семестром, увеличить длительность или часы в неделю.
          </Notice>
        )}
        {s.notes.map((n) => (
          <Notice key={n}>{n}</Notice>
        ))}
        {s.recommended.length > 0 && (
          <Notice tone="accent">
            Книг нет, поэтому объяснения будут из знаний модели. Для надёжности стоит взять учебник — его можно добавить и позже, он подключится к урокам:{" "}
            {s.recommended.join("; ")}.
          </Notice>
        )}
        {s.prereqs.length > 0 && (
          <div className="text-sm">
            <span className="text-muted">Курс предполагает, что ты знаешь:</span> {s.prereqs.map((p) => p.title).join(", ")}. Перед первым модулем будет входной тест; что
            окажется слабым, войдёт в нулевой модуль.
          </div>
        )}
      </Card>

      <ProgramEditor key={s.modules.map((m) => m.id).join(",")} semesterId={s.id} modules={s.modules} books={s.books} onSaved={onChange} onDirty={setDirty} />

      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={dirty || busy || unread} title={dirty ? "Сначала сохрани правки" : unread ? "Дождись разметки книг" : ""} onClick={() => act(() => api(`/api/semesters/${s.id}/approve`, { body: {} }))}>
          <Icon name="check" /> Утвердить программу и начать
        </Button>
        <Button
          disabled={busy || unread}
          onClick={() => confirm("Составить программу заново по всем книгам? Твои правки пропадут.") && act(() => api(`/api/semesters/${s.id}/prepare`, { body: { rebuild: true } }))}
        >
          <Icon name="redo" /> Составить заново
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => confirm("Удалить семестр с программой и книгами?") && act(async () => {
              await api(`/api/semesters/${s.id}`, { method: "DELETE" });
              router.push("/semester");
            })
          }
        >
          <Icon name="trash" /> Удалить
        </Button>
      </div>
    </div>
  );
}

export default function SemesterPage() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<SemesterView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setS(await api<SemesterView>(`/api/semesters/${id}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    setFailed(new URLSearchParams(window.location.search).get("failed"));
    load();
  }, [load]);

  // While the server works, keep the page fresh.
  const working = !!s && (s.running || (s.status === "preparing" && !s.error) || s.books.some((b) => b.status === "outlining" || b.status === "ocr") || !!s.active?.preparing);
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [working, load]);

  return (
    <>
      <TopNav tab={s?.title ?? "Семестр"} icon="cap" crumbs={[{ label: "Семестр", href: "/semester" }, { label: s?.title ?? "…" }]} busy={working} />
      <Page narrow={s?.status !== "active" && s?.status !== "finished"}>
        {error && <Notice tone="bad">{error}</Notice>}
        {!s ? (
          !error && <Loading />
        ) : (
          <div className="space-y-5">
            <header>
              <h1 className="text-[26px] leading-tight font-normal text-bright">{s.title}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted">
                <Badge tone="accent">{LEVELS[s.level].label} уровень</Badge>
                <span>
                  {s.weeks} нед. × {s.hoursPerWeek} ч
                </span>
                {s.goal && <span>· {s.goal}</span>}
                {s.request && s.request !== s.title && <span>· запрос: {s.request}</span>}
              </div>
            </header>
            {s.status === "preparing" && <Preparing s={s} failed={failed} onChange={load} />}
            {s.status === "draft" && <Draft s={s} onChange={load} />}
            {(s.status === "active" || s.status === "finished") && <SemesterActive s={s} onChange={load} />}
            <Books s={s} onChange={load} />
          </div>
        )}
      </Page>
    </>
  );
}
