"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { BookInfo } from "@/server/book-read";
import { Markdown } from "./Markdown";
import { Button, cx, Dots, fieldClass, Icon, Notice } from "./ui";

type PdfDoc = import("pdfjs-dist").PDFDocumentProxy;

// One loaded PDF per book for the whole session: reopening the viewer does not download it again.
const docs = new Map<number, Promise<PdfDoc>>();

async function loadPdf(bookId: number): Promise<PdfDoc> {
  if (!docs.has(bookId)) {
    const p = (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/api/pdf-worker";
      // Range requests are not needed: the file is read once and cached by the browser.
      return pdfjs.getDocument({ url: `/api/books/${bookId}/file` }).promise;
    })();
    p.catch(() => docs.delete(bookId));
    docs.set(bookId, p);
  }
  return docs.get(bookId)!;
}

/** One page of a PDF, drawn to fit the width (and the zoom), sharp on high-density screens. */
function PdfPage({ bookId, page, zoom }: { bookId: number; page: number; zoom: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const doc = await loadPdf(bookId);
        const p = await doc.getPage(page);
        if (cancelled || !canvas.current || !box.current) return;
        const base = p.getViewport({ scale: 1 });
        const fit = (box.current.clientWidth || 700) / base.width;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const viewport = p.getViewport({ scale: fit * zoom * dpr });
        const c = canvas.current;
        c.width = Math.floor(viewport.width);
        c.height = Math.floor(viewport.height);
        c.style.width = `${Math.floor(viewport.width / dpr)}px`;
        c.style.height = `${Math.floor(viewport.height / dpr)}px`;
        const render = p.render({ canvasContext: c.getContext("2d")!, viewport, canvas: c });
        task = render;
        await render.promise;
      } catch (e) {
        if (!cancelled && !(e instanceof Error && e.name === "RenderingCancelledException")) setError(e instanceof Error ? e.message : String(e));
      }
      if (!cancelled) setBusy(false);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [bookId, page, zoom]);

  return (
    <div ref={box} className="relative w-full overflow-auto rounded-sm border border-border bg-white">
      {busy && (
        <div className="absolute inset-0 grid place-items-center">
          <Dots />
        </div>
      )}
      {error ? <div className="p-3"><Notice tone="bad">Не удалось показать страницу: {error}</Notice></div> : <canvas ref={canvas} className="mx-auto block" />}
    </div>
  );
}

/** The stored text of a page: text books, or a PDF whose original file is gone. */
function TextPage({ bookId, page }: { bookId: number; page: number }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setText(null);
    api<{ text: string }>(`/api/books/${bookId}/pages/${page}`)
      .then((r) => live && setText(r.text))
      .catch(() => live && setText(""));
    return () => {
      live = false;
    };
  }, [bookId, page]);
  if (text === null) return <Dots />;
  return <div className="rounded-sm border border-border bg-surface px-4 py-3">{text.trim() ? <Markdown text={text} /> : <p className="text-sm text-muted">Страница пустая.</p>}</div>;
}

/**
 * A book page by page: the real page for PDFs (drawn in the browser by pdf.js),
 * the text for text books. With the table of contents when `outline` is set.
 */
export function BookViewer({ bookId, page: start = 1, outline, onPage }: { bookId: number; page?: number; outline?: boolean; onPage?: (p: number) => void }) {
  const [info, setInfo] = useState<BookInfo | null>(null);
  const [page, setPageState] = useState(start);
  const [input, setInput] = useState(String(start));
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<"page" | "text">("page");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<BookInfo>(`/api/books/${bookId}`)
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [bookId]);

  const setPage = useCallback(
    (p: number) => {
      const n = Math.max(1, Math.min(info?.pages ?? p, Math.round(p)));
      setPageState(n);
      setInput(String(n));
      onPage?.(n);
    },
    [info, onPage],
  );
  useEffect(() => setPage(start), [start, setPage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea")) return;
      if (e.key === "ArrowRight") setPage(page + 1);
      if (e.key === "ArrowLeft") setPage(page - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, setPage]);

  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!info) return <Dots />;
  const pdf = info.format === "pdf" && info.hasFile && mode === "page";
  const section = [...info.sections].reverse().find((s) => s.pageFrom <= page && s.level <= 2);

  return (
    <div className={cx("grid gap-3", outline && info.sections.length > 0 && "lg:grid-cols-[240px_minmax(0,1fr)]")}>
      {outline && info.sections.length > 0 && (
        <nav className="max-h-[75dvh] overflow-y-auto rounded-sm border border-border bg-surface py-1 text-[13px] max-lg:hidden" aria-label="Оглавление">
          {info.sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setPage(s.pageFrom)}
              className={cx("block w-full truncate px-2 py-0.5 text-left hover:bg-surface-2", s.pageFrom <= page && page <= s.pageTo && s.level <= 2 ? "text-accent" : "text-text")}
              style={{ paddingLeft: `${s.level * 10}px` }}
              title={`${s.title}, стр. ${s.pageFrom}`}
            >
              {s.title}
            </button>
          ))}
        </nav>
      )}
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button small onClick={() => setPage(page - 1)} disabled={page <= 1} aria-label="Предыдущая страница">
            <Icon name="chevron" size={14} className="rotate-180" />
          </Button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPage(Number(input) || page);
            }}
            className="flex items-center gap-1 text-[13px] text-muted"
          >
            <input className={cx(fieldClass, "w-16 py-1 text-center sm:py-0.5")} value={input} onChange={(e) => setInput(e.target.value)} inputMode="numeric" aria-label="Страница" />
            из {info.pages}
          </form>
          <Button small onClick={() => setPage(page + 1)} disabled={page >= info.pages} aria-label="Следующая страница">
            <Icon name="chevron" size={14} />
          </Button>
          {info.format === "pdf" && info.hasFile && (
            <>
              <Button small variant="ghost" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Мельче">
                −
              </Button>
              <span className="w-10 text-center text-xs text-muted tabular-nums">{Math.round(zoom * 100)}%</span>
              <Button small variant="ghost" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} aria-label="Крупнее">
                +
              </Button>
              <Button small variant="ghost" onClick={() => setMode(mode === "page" ? "text" : "page")} title="Распознанный или извлечённый текст страницы">
                {mode === "page" ? "Текст" : "Страница"}
              </Button>
            </>
          )}
          <span className="min-w-0 flex-1 truncate text-right text-xs text-muted" title={section?.title}>
            {section?.title}
          </span>
        </div>
        {info.format === "pdf" && !info.hasFile && <Notice>Исходного файла на сервере нет (его нет в резервных копиях базы) — показан текст страницы.</Notice>}
        {pdf ? <PdfPage bookId={bookId} page={page} zoom={zoom} /> : <TextPage bookId={bookId} page={page} />}
      </div>
    </div>
  );
}
