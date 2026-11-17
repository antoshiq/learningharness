"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CodeEditor } from "@/components/CodeEditor";
import { EditorPrefsButtons, toolButton } from "@/components/EditorTools";
import { Markdown } from "@/components/Markdown";
import { Button, cx, Dots, Icon, inputClass, isSubmitKey, Kbd, KeyHandler, Page, Segmented, Sheet, StatusItem, TopNav } from "@/components/ui";
import { formatDate, streamPost } from "@/lib/api";
import { runSandbox, stopSandbox, type RunOutcome } from "@/lib/runner";
import { SANDBOX_INCOMING } from "@/lib/sandbox";
import type { Language } from "@/lib/types";

interface File {
  name: string;
  content: string;
}
interface Workspace {
  files: File[];
  active: string;
  main: string;
  stdin: string;
}
interface Saved extends Workspace {
  title: string;
  language: Language;
  savedAt: number;
}

const EXT: Record<Language, string> = { python: ".py", javascript: ".js" };
const STARTER: Record<Language, Workspace> = {
  python: {
    files: [
      { name: "main.py", content: 'from helpers import greet\n\nname = input("Как тебя зовут? ")\nprint(greet(name or "мир"))\n' },
      { name: "helpers.py", content: 'def greet(name):\n    return f"Привет, {name}!"\n' },
    ],
    active: "main.py",
    main: "main.py",
    stdin: "Аня",
  },
  javascript: {
    files: [
      { name: "main.js", content: 'const { greet } = require("./helpers");\n\nconst name = input("Как тебя зовут? ");\nconsole.log(greet(name ?? "мир"));\n' },
      { name: "helpers.js", content: "function greet(name) {\n  return `Привет, ${name}!`;\n}\n\nmodule.exports = { greet };\n" },
    ],
    active: "main.js",
    main: "main.js",
    stdin: "Аня",
  },
};
const WS_KEY = (l: Language) => `tutor.sandbox.ws.${l}`;
const SAVED_KEY = "tutor.sandbox.saved";
const LANG_KEY = "tutor.sandbox.lang";

function loadWs(l: Language): Workspace {
  try {
    const v = JSON.parse(localStorage.getItem(WS_KEY(l)) ?? "null") as Workspace | null;
    if (v?.files?.length) return v;
    // Drafts from the first sandbox version: one file per language.
    const old = localStorage.getItem(`tutor.sandbox.${l}`);
    if (old) return { files: [{ name: `main${EXT[l]}`, content: old }], active: `main${EXT[l]}`, main: `main${EXT[l]}`, stdin: "" };
  } catch {}
  return structuredClone(STARTER[l]);
}

function loadSaved(): Saved[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]") as Saved[];
  } catch {
    return [];
  }
}

const QUICK = ["Почему ошибка?", "Объясни, как работает этот код", "Как сделать лучше?"];

/** A small editor for experiments: several files, input, plots, and the tutor at hand. */
export default function SandboxPage() {
  const [language, setLanguage] = useState<Language>("python");
  const [ws, setWs] = useState<Workspace>(STARTER.python);
  const [loaded, setLoaded] = useState(false);
  const [result, setResult] = useState<RunOutcome | null>(null);
  const [live, setLive] = useState("");
  const [running, setRunning] = useState(false);
  const [ranFiles, setRanFiles] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [panel, setPanel] = useState<"out" | "in" | "ask">("out");
  const [naming, setNaming] = useState<string | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [saveTitle, setSaveTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const opener = useRef<HTMLInputElement>(null);
  const outBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let lang: Language = "python";
    let ws0: Workspace | null = null;
    try {
      const raw = new URLSearchParams(window.location.search).has("incoming") ? localStorage.getItem(SANDBOX_INCOMING) : null;
      if (raw) {
        const v = JSON.parse(raw) as { language: Language; code: string };
        lang = v.language === "javascript" ? "javascript" : "python";
        const name = `main${EXT[lang]}`;
        ws0 = { files: [{ name, content: v.code }], active: name, main: name, stdin: "" };
        localStorage.removeItem(SANDBOX_INCOMING);
        window.history.replaceState(null, "", "/sandbox");
      } else if (localStorage.getItem(LANG_KEY) === "javascript") lang = "javascript";
    } catch {}
    setLanguage(lang);
    setWs(ws0 ?? loadWs(lang));
    setSaved(loadSaved());
    setLoaded(true);
  }, []);

  // Every change is the draft: kept per language in this browser.
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(WS_KEY(language), JSON.stringify(ws));
    } catch {}
  }, [ws, language, loaded]);

  useEffect(() => {
    outBox.current?.scrollTo({ top: outBox.current.scrollHeight });
  }, [live]);

  const file = ws.files.find((f) => f.name === ws.active) ?? ws.files[0];
  const update = (patch: Partial<Workspace>) => setWs((w) => ({ ...w, ...patch }));
  const edit = (content: string) => setWs((w) => ({ ...w, files: w.files.map((f) => (f.name === w.active ? { ...f, content } : f)) }));

  const switchTo = (l: Language) => {
    if (l === language) return;
    setLanguage(l);
    setWs(loadWs(l));
    setResult(null);
    setLive("");
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {}
  };

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setResult(null);
    setLive("");
    setPanel("out");
    const snapshot = JSON.stringify(ws.files);
    const t = performance.now();
    const r = await runSandbox({ language, files: ws.files, main: ws.main, stdin: ws.stdin, onOutput: (s) => setLive((x) => x + s) });
    setMs(Math.round(performance.now() - t));
    setResult(r);
    setRanFiles(snapshot);
    setRunning(false);
  }, [running, ws, language]);

  const addFile = (raw: string) => {
    let name = raw.trim().replace(/[\\/:*?"<>|\s]+/g, "_");
    if (!name) return setNaming(null);
    if (!/\.\w+$/.test(name)) name += EXT[language];
    if (ws.files.some((f) => f.name === name)) return setNaming(null);
    setWs((w) => ({ ...w, files: [...w.files, { name, content: "" }], active: name }));
    setNaming(null);
  };
  const removeFile = (name: string) => {
    if (ws.files.length < 2) return;
    setWs((w) => {
      const files = w.files.filter((f) => f.name !== name);
      return { ...w, files, active: w.active === name ? files[0].name : w.active, main: w.main === name ? files[0].name : w.main };
    });
  };

  const save = () => {
    const title = saveTitle.trim() || file.name;
    const next = [{ ...ws, title, language, savedAt: Date.now() }, ...saved.filter((s) => s.title !== title || s.language !== language)].slice(0, 50);
    setSaved(next);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    } catch {}
    setSaveTitle("");
  };
  const open = (s: Saved) => {
    setLanguage(s.language);
    setWs({ files: s.files, active: s.active, main: s.main, stdin: s.stdin });
    setSavedOpen(false);
    setResult(null);
    setLive("");
  };
  const forget = (s: Saved) => {
    const next = saved.filter((x) => x !== s);
    setSaved(next);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    } catch {}
  };

  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([file.content], { type: "text/plain;charset=utf-8" }));
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const openFiles = async (list: FileList) => {
    const add: File[] = [];
    for (const f of Array.from(list)) if (f.size < 300_000) add.push({ name: f.name.replace(/\s+/g, "_"), content: await f.text() });
    if (!add.length) return;
    setWs((w) => ({ ...w, files: [...w.files.filter((x) => !add.some((a) => a.name === x.name)), ...add], active: add[0].name }));
  };

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || asking) return;
    setQuestion("");
    setAskError(null);
    setAsking(true);
    setPanel("ask");
    const history = chat;
    setChat([...history, { role: "user", text }, { role: "assistant", text: "" }]);
    try {
      await streamPost(
        "/api/sandbox/ask",
        { language, files: ws.files, active: ws.active, output: result?.stdout ?? live, error: result?.error ?? null, question: text, history },
        (e) => {
          if (e.type === "text") setChat((c) => [...c.slice(0, -1), { role: "assistant", text: c.at(-1)!.text + e.delta }]);
          if (e.type === "error") setAskError(e.message);
        },
      );
    } catch (e) {
      setAskError(e instanceof Error ? e.message : String(e));
    }
    setAsking(false);
  };

  const errorHere = result?.errorAt && result.errorAt.file === file.name && ranFiles === JSON.stringify(ws.files) ? result.errorAt.line : null;
  const output = result ? result.stdout : live;

  return (
    <>
      <TopNav
        tab="Песочница"
        icon="play"
        crumbs={[{ label: "Песочница" }, { label: file.name }]}
        busy={running}
        status={
          <>
            <StatusItem>{language === "python" ? "Python (Pyodide)" : "JavaScript"}</StatusItem>
            <StatusItem>
              {ws.files.length} {ws.files.length === 1 ? "файл" : ws.files.length < 5 ? "файла" : "файлов"}
            </StatusItem>
            {ms !== null && <StatusItem icon="clock">{ms} мс</StatusItem>}
          </>
        }
      />
      <Page>
        <KeyHandler
          onKey={(e) => {
            if (isSubmitKey(e)) {
              e.preventDefault();
              run();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              setSavedOpen(true);
            }
          }}
        />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h1 className="mr-2 text-[22px] leading-tight font-normal text-bright">Песочница</h1>
          <div className="w-52">
            <Segmented
              label="Язык"
              value={language}
              onChange={switchTo}
              options={
                [
                  ["python", "Python"],
                  ["javascript", "JavaScript"],
                ] as const
              }
            />
          </div>
          <span className="flex-1" />
          {running ? (
            <Button variant="danger" onClick={stopSandbox}>
              ■ Остановить
            </Button>
          ) : (
            <Button variant="primary" onClick={run}>
              <Icon name="play" /> Запустить
            </Button>
          )}
          <Button variant="ghost" onClick={() => setSavedOpen(true)} title="Сохранить или открыть программу (Ctrl+S)">
            <Icon name="files" /> Мои программы
          </Button>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col">
            {/* File tabs, like the editor's own. */}
            <div className="flex items-end gap-0.5 overflow-x-auto border-b border-border" role="tablist" aria-label="Файлы">
              {ws.files.map((f) => (
                <div
                  key={f.name}
                  className={cx(
                    "group -mb-px flex h-8 shrink-0 items-center gap-1 rounded-t-sm border border-b-0 px-2 text-[13px]",
                    f.name === ws.active ? "border-border bg-bg text-bright" : "border-transparent text-muted hover:text-bright",
                  )}
                >
                  <button role="tab" aria-selected={f.name === ws.active} onClick={() => update({ active: f.name })} className="flex items-center gap-1.5 font-mono">
                    {f.name === ws.main && <Icon name="play" size={11} className="text-ok" />}
                    {f.name}
                  </button>
                  {ws.files.length > 1 && (
                    <button onClick={() => removeFile(f.name)} aria-label={`Закрыть ${f.name}`} className="grid size-4 place-items-center rounded-sm opacity-0 group-hover:opacity-100 hover:bg-surface-2 max-sm:opacity-60">
                      <Icon name="close" size={10} />
                    </button>
                  )}
                </div>
              ))}
              {naming !== null ? (
                <input
                  autoFocus
                  className={cx(inputClass, "mb-1 h-7 w-36 py-0 font-mono text-[13px]")}
                  value={naming}
                  onChange={(e) => setNaming(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addFile(naming);
                    if (e.key === "Escape") setNaming(null);
                  }}
                  onBlur={() => addFile(naming)}
                  placeholder={`utils${EXT[language]}`}
                  aria-label="Имя нового файла"
                />
              ) : (
                <button onClick={() => setNaming("")} className="mb-1 grid size-7 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-bright" title="Новый файл" aria-label="Новый файл">
                  <Icon name="plus" size={14} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 text-xs text-muted">
              {ws.files.length > 1 && (
                <label className="flex items-center gap-1">
                  Запускать
                  <select className="rounded-sm border border-border-strong bg-input px-1 py-0.5 font-mono text-[12px]" value={ws.main} onChange={(e) => update({ main: e.target.value })}>
                    {ws.files.map((f) => (
                      <option key={f.name}>{f.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <span className="flex-1" />
              <button className={toolButton} onClick={() => opener.current?.click()} title="Открыть файлы с компьютера">
                Открыть
              </button>
              <button className={toolButton} onClick={download} title="Скачать этот файл">
                Скачать
              </button>
              <button className={toolButton} onClick={() => setWs(structuredClone(STARTER[language]))} title="Начать с примера">
                Пример
              </button>
              <EditorPrefsButtons />
              <input ref={opener} type="file" multiple className="hidden" onChange={(e) => e.target.files && openFiles(e.target.files).finally(() => (e.target.value = ""))} />
            </div>
            <div className="h-[56dvh] min-h-72">
              <CodeEditor
                key={`${language}:${file.name}`}
                value={file.content}
                onChange={edit}
                language={language}
                fill
                errorLine={errorHere}
                errorMessage={result?.error?.split("\n").filter(Boolean).at(-1)}
              />
            </div>
            <p className="mt-1.5 hidden text-xs text-muted sm:block">
              <Kbd>Ctrl+Enter</Kbd> запустить · <Kbd>Ctrl+S</Kbd> сохранить · <Kbd>Ctrl+F</Kbd> поиск · <Kbd>Ctrl+/</Kbd> комментарий ·{" "}
              {language === "python" ? "import других файлов, numpy и matplotlib подгружаются сами" : 'require("./файл") для других файлов'}
            </p>
          </div>

          <div className="flex min-w-0 flex-col">
            <div className="flex gap-4 border-b border-border" role="tablist">
              {(
                [
                  ["out", "Вывод"],
                  ["in", "Ввод"],
                  ["ask", "Спросить репетитора"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={panel === k}
                  onClick={() => setPanel(k)}
                  className={cx("-mb-px flex h-8 items-center gap-1.5 border-b text-[13px]", panel === k ? "border-accent text-bright" : "border-transparent text-muted hover:text-bright")}
                >
                  {label}
                  {k === "out" && result?.error && <span className="size-1.5 rounded-full bg-bad" />}
                  {k === "in" && ws.stdin.trim() && <span className="text-xs text-muted">{ws.stdin.split("\n").length}</span>}
                </button>
              ))}
            </div>

            {panel === "out" && (
              <div ref={outBox} className="mt-2 h-[56dvh] min-h-72 overflow-auto rounded-sm border border-border bg-surface px-3 py-2" aria-live="polite">
                {!running && !result && !live ? (
                  <p className="text-sm text-muted">Нажми «Запустить». Вывод появляется по мере выполнения.</p>
                ) : (
                  <>
                    <pre className="font-mono text-[13px] whitespace-pre-wrap">{output}</pre>
                    {running && (
                      <span className="mt-1 flex items-center gap-2 text-sm text-muted">
                        <Dots /> {language === "python" && !output ? "Запускаю (первый запуск Python — несколько секунд)…" : "Выполняется…"}
                      </span>
                    )}
                    {result?.images?.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={`data:image/png;base64,${src}`} alt={`График ${i + 1}`} className="appear my-2 max-w-full rounded-sm border border-border bg-white" />
                    ))}
                    {result?.error && (
                      <div className="mt-1 rounded-sm border border-bad/50 bg-bad-soft px-2 py-1.5">
                        {result.errorAt && (
                          <button onClick={() => update({ active: result.errorAt!.file })} className="mb-1 text-xs font-medium text-bad underline">
                            {result.errorAt.file}, строка {result.errorAt.line}
                          </button>
                        )}
                        <pre className="font-mono text-[12px] whitespace-pre-wrap text-bad">{result.error}</pre>
                        {!result.stopped && (
                          <button onClick={() => ask("Почему ошибка?")} className="mt-1 text-xs text-accent hover:underline">
                            Спросить репетитора, почему ошибка
                          </button>
                        )}
                      </div>
                    )}
                    {result && !result.error && !result.stdout && !result.images?.length && <p className="text-sm text-muted">Выполнено без вывода.</p>}
                  </>
                )}
              </div>
            )}

            {panel === "in" && (
              <div className="mt-2 flex h-[56dvh] min-h-72 flex-col gap-1.5">
                <textarea
                  className={cx(inputClass, "flex-1 resize-none font-mono text-[13px]")}
                  value={ws.stdin}
                  onChange={(e) => update({ stdin: e.target.value })}
                  placeholder={"Каждая строка — ответ на один вызов input().\nНапример:\n5\n3 4"}
                  aria-label="Ввод программы"
                  spellCheck={false}
                />
                <p className="text-xs text-muted">Строки отдаются программе по очереди. Когда они кончаются, input() получает конец ввода.</p>
              </div>
            )}

            {panel === "ask" && (
              <div className="mt-2 flex h-[56dvh] min-h-72 flex-col gap-2">
                <div className="min-h-0 flex-1 space-y-3 overflow-auto rounded-sm border border-border bg-surface px-3 py-2">
                  {chat.length === 0 ? (
                    <p className="text-sm text-muted">Репетитор видит все файлы, вывод и ошибку последнего запуска. Спроси, почему не работает, как это устроено или как улучшить.</p>
                  ) : (
                    chat.map((m, i) =>
                      m.role === "user" ? (
                        <div key={i} className="ml-auto w-fit max-w-[90%] rounded-md bg-accent-soft px-3 py-1.5 text-sm whitespace-pre-wrap text-bright">
                          {m.text}
                        </div>
                      ) : m.text ? (
                        <Markdown key={i} text={m.text} className={cx("text-[14px]", asking && i === chat.length - 1 && "streaming")} />
                      ) : (
                        <span key={i} className="flex items-center gap-2 text-sm text-muted">
                          <Dots /> Смотрю код…
                        </span>
                      ),
                    )
                  )}
                  {askError && <p className="text-sm text-bad">{askError}</p>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK.map((q) => (
                    <button key={q} onClick={() => ask(q)} disabled={asking} className="rounded-sm border border-border-strong px-2 py-0.5 text-xs text-muted hover:text-bright disabled:opacity-50">
                      {q}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    className={inputClass}
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && ask(question)}
                    placeholder="Свой вопрос о программе"
                    aria-label="Вопрос репетитору"
                  />
                  <Button variant="primary" onClick={() => ask(question)} disabled={asking || !question.trim()}>
                    Спросить
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Page>

      <Sheet open={savedOpen} onClose={() => setSavedOpen(false)} title="Мои программы">
        <div className="space-y-4">
          <div className="flex gap-2">
            <input className={inputClass} value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder={`Название, например «${file.name}»`} aria-label="Название программы" autoFocus />
            <Button variant="primary" onClick={save}>
              Сохранить
            </Button>
          </div>
          {saved.length === 0 ? (
            <p className="text-sm text-muted">Сохранённых программ пока нет. Они хранятся в этом браузере.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {saved.map((s, i) => (
                <li key={i} className="group flex items-center gap-2 px-3 py-1.5 text-[13px]">
                  <button onClick={() => open(s)} className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-accent">
                    <span className="truncate text-bright">{s.title}</span>
                    <span className="shrink-0 text-xs text-muted">
                      {s.language === "python" ? "Python" : "JavaScript"} · {s.files.length} ф. · {formatDate(s.savedAt)}
                    </span>
                  </button>
                  <button onClick={() => forget(s)} aria-label={`Удалить ${s.title}`} className="grid size-6 place-items-center rounded-sm text-muted opacity-60 group-hover:opacity-100 hover:text-bad">
                    <Icon name="trash" size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>
    </>
  );
}
