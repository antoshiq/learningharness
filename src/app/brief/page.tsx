"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FilePicker, type PickedFile } from "@/components/FilePicker";
import { Markdown } from "@/components/Markdown";
import { Badge, Button, Card, cx, Dots, Field, Icon, inputClass, isSubmitKey, Kbd, KeyHandler, Notice, Page, PanelTitle, Segmented, TopNav, type IconName } from "@/components/ui";
import { api, formatDate, streamPost } from "@/lib/api";
import { BRIEF_KIND_LABEL, DEPTH_LABEL } from "@/lib/brief";

type Kind = "topic" | "files" | "repo" | "url" | "changes" | "review";

const MODES: [Kind, string, IconName][] = [
  ["topic", "Тема", "compass"],
  ["files", "Файлы", "file"],
  ["url", "Ссылка или видео", "search"],
  ["repo", "Проект", "repo"],
  ["changes", "Изменения", "redo"],
  ["review", "Разбор кода", "target"],
];
type Depth = 1 | 5 | 15;
interface Row {
  id: number;
  kind: Kind;
  title: string;
  depth: number;
  topicId: number | null;
  createdAt: number;
}
const DEPTH_KEY = "tutor.briefDepth";

export default function BriefPage() {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("topic");
  const [depth, setDepth] = useState<Depth>(5);
  const [topic, setTopic] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [paths, setPaths] = useState("");
  const [uploads, setUploads] = useState<PickedFile[]>([]);
  const [history, setHistory] = useState<Row[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ briefs: Row[] }>("/api/briefs")
      .then((r) => setHistory(r.briefs))
      .catch(() => setHistory([]));
    try {
      const d = Number(localStorage.getItem(DEPTH_KEY));
      if (d === 1 || d === 5 || d === 15) setDepth(d);
    } catch {}
    // Links from other pages: ?kind=repo|changes&repo=…, ?kind=url&url=…
    const q = new URLSearchParams(window.location.search);
    const k = q.get("kind");
    if (MODES.some(([m]) => m === k)) setKind(k as Kind);
    if (q.get("repo")) setRepoPath(q.get("repo")!);
    if (q.get("url")) setUrl(q.get("url")!);
  }, []);

  const chooseDepth = (d: Depth) => {
    setDepth(d);
    try {
      localStorage.setItem(DEPTH_KEY, String(d));
    } catch {}
  };

  const pathList = paths
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const ready =
    !busy && (kind === "topic" ? !!topic.trim() || uploads.length > 0 : kind === "repo" || kind === "changes" ? !!repoPath.trim() : kind === "url" ? !!url.trim() : kind === "review" ? !!code.trim() || uploads.length > 0 : pathList.length + uploads.length > 0);

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    setText("");
    setStatus(kind === "topic" && !uploads.length ? "Пишу экскурс…" : "Готовлю материал…");
    let saved: number | null = null;
    // Files go along only where the mode uses them.
    const sent = kind === "topic" || kind === "files" || kind === "review" ? uploads.map(({ name, content, base64 }) => ({ name, content, base64 })) : [];
    try {
      await streamPost("/api/briefs", { kind, depth, topic, repoPath, url, code: kind === "review" ? code : "", paths: kind === "files" ? pathList : [], uploads: sent }, (e) => {
        if (e.type === "status") setStatus(e.text);
        else if (e.type === "text") {
          setStatus(null);
          setText((t) => t + e.delta);
        } else if (e.type === "error") setError(e.message);
        else if (e.type === "saved") saved = e.id;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
    setStatus(null);
    if (saved !== null) router.push(`/brief/${saved}`);
  };

  return (
    <>
      <TopNav tab="Быстрый экскурс" icon="compass" crumbs={[{ label: "Быстрый экскурс" }]} busy={busy} />
      <Page narrow>
        <KeyHandler
          onKey={(e) => {
            if (isSubmitKey(e) && ready) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <h1 className="text-[26px] leading-tight font-normal text-bright">Быстрый экскурс</h1>
        <p className="mt-1 mb-6 max-w-[64ch] text-muted">
          Краткая карта темы, файлов или проекта по тезисам: суть, главное, как работает, пример, ловушки. Нажми на любой пункт, чтобы раскрыть его подробнее.
        </p>

        <Card className="space-y-4">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Что разобрать">
            {MODES.map(([m, label, icon]) => (
              <button
                key={m}
                type="button"
                onClick={() => setKind(m)}
                aria-pressed={kind === m}
                className={cx(
                  "inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-[13px] transition-colors",
                  kind === m ? "border-accent bg-accent-soft text-bright" : "border-border-strong text-muted hover:text-bright",
                )}
              >
                <Icon name={icon} size={14} />
                {label}
              </button>
            ))}
          </div>

          {kind === "topic" && (
            <Field label="Тема">
              <input
                className={inputClass}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="async/await в Python, производная, индексы в PostgreSQL"
                autoFocus
              />
            </Field>
          )}
          {kind === "topic" && (
            <div>
              <div className="mb-1 text-[13px] text-bright">Материалы (необязательно)</div>
              <FilePicker files={uploads} onChange={setUploads} />
              <p className="mt-1.5 text-xs text-muted">
                {uploads.length
                  ? "Экскурс будет по этим файлам и в их терминах; «Учить это подробно» передаст их репетитору. Тему можно не писать."
                  : "Приложи лекции или главу учебника, и экскурс будет по ним, а не по общим знаниям модели."}
              </p>
            </div>
          )}

          {kind === "review" && (
            <div className="space-y-3">
              <Field label="Код">
                <textarea
                  className={cx(inputClass, "min-h-40 resize-y font-mono text-[13px]")}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Вставь функцию, класс или файл целиком. Можно и приложить файлы ниже."
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              </Field>
              <FilePicker files={uploads} onChange={setUploads} hint="Или приложи файлы с кодом" />
              <Field label="На что обратить внимание (необязательно)">
                <input className={inputClass} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Производительность, обработка ошибок, читаемость…" />
              </Field>
            </div>
          )}

          {kind === "url" && (
            <Field label="Ссылка на статью, документацию, PDF или видео YouTube">
              <input
                className={cx(inputClass, "font-mono text-[15px]")}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="https://…"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                inputMode="url"
              />
            </Field>
          )}

          {(kind === "repo" || kind === "changes") && (
            <Field label={kind === "changes" ? "Проект, изменения в котором разобрать: папка или ссылка на GitHub" : "Папка проекта на этом компьютере или ссылка на GitHub"}>
              <input
                className={cx(inputClass, "font-mono text-[15px]")}
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="C:\Users\...\my-project или https://github.com/owner/repo"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </Field>
          )}

          {kind === "files" && (
            <div className="space-y-3">
              <FilePicker files={uploads} onChange={setUploads} hint="Перетащи файлы сюда: код, текст, Markdown, PDF" />
              <Field label="Или пути к файлам на этом компьютере, по одному в строке">
                <textarea
                  className={cx(inputClass, "min-h-20 resize-y font-mono text-[13px]")}
                  value={paths}
                  onChange={(e) => setPaths(e.target.value)}
                  placeholder={"C:\\Users\\...\\project\\src\\main.py"}
                  spellCheck={false}
                />
              </Field>
            </div>
          )}

          <div>
            <div className="mb-1 text-[13px] text-bright">Глубина</div>
            <Segmented
              label="Глубина"
              value={depth}
              onChange={chooseDepth}
              options={
                [
                  [1, "1 минута"],
                  [5, "5 минут"],
                  [15, "15 минут"],
                ] as const
              }
            />
          </div>

          {kind !== "topic" && (
            <p className="text-xs text-muted">
              {kind === "review"
                ? "Разбор как у наставника: что хорошо, ошибки и риски со ссылками на строки, как улучшить, чему научиться. Из разбора можно сделать карточки или тему."
                : kind === "url"
                ? "Страница скачивается и превращается в текст; PDF по ссылке тоже читается. Для видео YouTube берутся субтитры, в экскурсе будут ссылки на моменты видео. Ссылки на локальную сеть не открываются."
                : kind === "changes"
                  ? "Берутся коммиты и изменения кода с прошлого экскурса по этому проекту (или за две недели). Нужен git; репозиторий GitHub скачивается в data/repos."
                  : "Файлы читаются только на чтение и отправляются выбранной модели. Секреты (.env, ключи) и бинарные файлы пропускаются. PDF читаются, если в них есть текстовый слой."}{" "}
              {kind === "repo" && "Из проекта читаются структура и самые важные файлы, их выбирает быстрая модель. Публичный репозиторий GitHub скачивается в data/repos."}
            </p>
          )}
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={submit} disabled={!ready}>
              <Icon name="compass" /> {busy ? "Составляю…" : "Сделать экскурс"}
            </Button>
            <span className="hidden text-xs text-muted sm:inline">
              <Kbd>Ctrl+Enter</Kbd>
            </span>
          </div>
        </Card>

        {(busy || text) && (
          <Card className="enter mt-4">
            {status && (
              <div className="mb-2 flex items-center gap-2.5 text-sm text-muted" aria-live="polite">
                <Dots /> {status}
              </div>
            )}
            {text && <Markdown text={text} className={cx("prose-lesson brief", busy && "streaming")} />}
          </Card>
        )}

        {history && history.length > 0 && (
          <section className="mt-8 overflow-hidden rounded-md border border-border bg-surface">
            <PanelTitle right={<span className="text-xs text-muted tabular-nums">{history.length}</span>}>Прошлые экскурсы</PanelTitle>
            <ul className="divide-y divide-border">
              {history.map((b, i) => (
                <li key={b.id} style={{ "--i": Math.min(i, 10) } as React.CSSProperties} className="enter">
                  <Link href={`/brief/${b.id}`} className="group flex items-center gap-3 px-3 py-2 hover:bg-surface-2/60">
                    <Icon name={b.kind === "repo" || b.kind === "changes" ? "repo" : b.kind === "review" ? "target" : b.kind === "files" || b.kind === "url" ? "file" : "compass"} className="text-accent" />
                    <span className="min-w-0 flex-1 truncate text-bright group-hover:text-accent">{b.title}</span>
                    <Badge>{BRIEF_KIND_LABEL[b.kind]}</Badge>
                    <span className="hidden shrink-0 text-xs text-muted sm:inline">{DEPTH_LABEL[b.depth]}</span>
                    {b.topicId && <Badge tone="ok">тема</Badge>}
                    <span className="shrink-0 text-xs text-muted">{formatDate(b.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </Page>
    </>
  );
}
