"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { StartSession } from "@/components/StartSession";
import { Badge, Button, Card, cx, inputClass, LinkButton, Notice, Page, Sheet, TopNav } from "@/components/ui";
import { api, formatCost, formatTokens, plural } from "@/lib/api";
import type { TopicCard } from "@/server/sessions";

interface Scan {
  root: string;
  files: number;
  estTokens: number;
  byExt: { ext: string; files: number }[];
  skippedSecrets: number;
  skippedLarge: number;
  truncated: boolean;
  model: string;
  fullReadCost: number | null;
}

function NewTopic({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<"topic" | "repo">("topic");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [scan, setScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    guard(async () => {
      const { id } = await api<{ id: number }>("/api/topics", { body: { kind, title, goal, repoPath } });
      router.push(`/topics/${id}`);
    });

  return (
    <Sheet open={open} onClose={onClose} title="Что будем изучать?">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["topic", "Тема"],
              ["repo", "Мой репозиторий"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={cx("min-h-11 rounded-lg border text-sm", kind === k ? "border-accent bg-accent-soft font-medium text-accent" : "border-border text-muted")}
            >
              {label}
            </button>
          ))}
        </div>

        {kind === "topic" ? (
          <>
            <div>
              <div className="mb-1.5 text-sm text-muted">Тема</div>
              <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: рекурсия в Python, производные, SQL JOIN" />
            </div>
            <div>
              <div className="mb-1.5 text-sm text-muted">Чего хочешь достичь</div>
              <textarea
                className={cx(inputClass, "min-h-24 resize-y")}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Что ты хочешь уметь в итоге и что уже знаешь. Чем конкретнее, тем точнее план."
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="mb-1.5 text-sm text-muted">Путь к папке проекта на этом компьютере</div>
              <input
                className={cx(inputClass, "font-mono text-[15px]")}
                value={repoPath}
                onChange={(e) => {
                  setRepoPath(e.target.value);
                  setScan(null);
                }}
                placeholder="C:\Users\...\my-project"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </div>
            <div>
              <div className="mb-1.5 text-sm text-muted">Что хочешь понять</div>
              <textarea
                className={cx(inputClass, "min-h-20 resize-y")}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Например: понять, как устроен проект целиком, чтобы вносить изменения самому"
              />
            </div>
            <p className="text-sm text-muted">
              Папка читается только на чтение. Зависимости, сборки, бинарные файлы и файлы с секретами (.env, ключи) пропускаются и модели не отправляются.
            </p>
            {scan && (
              <div className="space-y-1.5 rounded-lg bg-surface-2 px-3.5 py-3 text-sm">
                <div>
                  Доступно для чтения: <b>{scan.files}</b> файлов, около <b>{formatTokens(scan.estTokens)}</b> токенов.
                </div>
                <div className="text-muted">
                  {scan.byExt.map((e) => `.${e.ext} — ${e.files}`).join(", ")}
                  {scan.skippedSecrets ? ` · пропущено секретов: ${scan.skippedSecrets}` : ""}
                  {scan.skippedLarge ? ` · слишком больших: ${scan.skippedLarge}` : ""}
                </div>
                <div>
                  {scan.fullReadCost !== null
                    ? `Если бы модель ${scan.model} прочла всё один раз — около ${formatCost(scan.fullReadCost, true)} на вход. Обычно она читает малую часть, но прочитанное остаётся в контексте урока и оплачивается повторно на каждом шаге (со скидкой за кэш).`
                    : `Цена для модели ${scan.model} неизвестна; ориентируйся на число токенов.`}
                </div>
                {scan.truncated && <div className="text-warn">Файлов очень много: учтены первые 6000.</div>}
              </div>
            )}
          </>
        )}

        {error && <Notice tone="bad">{error}</Notice>}
        <div className="flex gap-2">
          {kind === "repo" && !scan && (
            <Button
              className="flex-1"
              variant="primary"
              disabled={busy || !repoPath.trim()}
              onClick={() => guard(async () => setScan(await api<Scan>("/api/repo/scan", { body: { path: repoPath } })))}
            >
              {busy ? "Сканирую…" : "Оценить объём"}
            </Button>
          )}
          {(kind === "topic" || scan) && (
            <Button className="flex-1" variant="primary" disabled={busy || (kind === "topic" && !title.trim())} onClick={create}>
              Создать
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

export default function Home() {
  const [topics, setTopics] = useState<TopicCard[] | null>(null);
  const [modelProblem, setModelProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [start, setStart] = useState<{ topicId: number; kind: "lesson" | "review" } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ topics: TopicCard[]; modelProblem: string | null }>("/api/topics");
      setTopics(d.topics);
      setModelProblem(d.modelProblem);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const due = (topics ?? []).filter((t) => t.due > 0);
  const dueTotal = due.reduce((s, t) => s + t.due, 0);

  return (
    <>
      <TopNav
        right={
          <Link href="/settings" className="flex min-h-10 items-center rounded-lg px-2.5 text-sm text-muted hover:bg-surface-2 hover:text-text">
            Настройки
          </Link>
        }
      />
      <Page>
        {error && <Notice tone="bad">{error}</Notice>}
        {modelProblem && (
          <Notice tone="warn">
            {modelProblem}. Без этого уроки не запустятся.{" "}
            <Link href="/settings" className="font-medium underline">
              Открыть настройки
            </Link>
          </Notice>
        )}

        {dueTotal > 0 && (
          <section className="mt-4">
            <h2 className="mb-2 text-sm font-medium text-muted">Сначала повторение</h2>
            <Card className="space-y-3">
              <p>
                Пора повторить <b>{dueTotal}</b> {plural(dueTotal, "идею", "идеи", "идей")}. Это занимает несколько минут и удерживает пройденное в памяти.
              </p>
              <div className="flex flex-wrap gap-2">
                {due.map((t) => (
                  <Button key={t.id} variant="primary" onClick={() => setStart({ topicId: t.id, kind: "review" })}>
                    {t.title} · {t.due}
                  </Button>
                ))}
              </div>
            </Card>
          </section>
        )}

        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted">Темы</h2>
            <Button small variant="primary" onClick={() => setCreating(true)}>
              + Новая
            </Button>
          </div>
          {topics === null ? (
            <div className="text-sm text-muted">Загрузка…</div>
          ) : topics.length === 0 ? (
            <Card className="text-center">
              <p className="mb-1 font-medium">Пока ничего нет</p>
              <p className="mb-4 text-sm text-muted">
                Назови тему или укажи свой репозиторий. Репетитор сначала выяснит, что ты уже знаешь, потом построит план и поведёт по нему.
              </p>
              <Button variant="primary" onClick={() => setCreating(true)}>
                Начать первую тему
              </Button>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {topics.map((t) => {
                const pct = t.total ? Math.round((t.mastered / t.total) * 100) : 0;
                return (
                  <Card key={t.id} className="flex flex-col gap-3">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/topics/${t.id}`} className="font-medium hover:underline">
                          {t.title}
                        </Link>
                        {t.kind === "repo" && <Badge>репозиторий</Badge>}
                      </div>
                      {t.goal && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{t.goal}</p>}
                    </div>
                    <div>
                      <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                        <div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {t.total ? `Освоено ${t.mastered} из ${t.total}` : "План появится на первом уроке"}
                        {t.learning ? ` · в процессе ${t.learning}` : ""}
                      </div>
                    </div>
                    <div className="mt-auto flex gap-2">
                      {t.openSessionId ? (
                        <LinkButton href={`/session/${t.openSessionId}`} variant="primary" className="flex-1">
                          Продолжить урок
                        </LinkButton>
                      ) : (
                        <Button variant="primary" className="flex-1" onClick={() => setStart({ topicId: t.id, kind: "lesson" })}>
                          {t.total ? "Новый урок" : "Начать"}
                        </Button>
                      )}
                      <LinkButton href={`/topics/${t.id}`}>Обзор</LinkButton>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </Page>
      <NewTopic open={creating} onClose={() => setCreating(false)} />
      <StartSession topicId={start?.topicId ?? 0} kind={start?.kind ?? null} onClose={() => setStart(null)} />
    </>
  );
}
