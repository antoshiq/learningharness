"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, cx, inputClass, Loading, Notice, Page, TopNav } from "@/components/ui";
import { AppearanceCard, DataCard, GoalCard, LimitCard, TheoryCard } from "@/components/SettingsExtras";
import { api } from "@/lib/api";
import type { AppConfig, ProviderId, RoleConfig } from "@/lib/types";

const PROVIDER_LABEL: Record<Exclude<ProviderId, "mock">, string> = {
  anthropic: "Claude (Anthropic)",
  openrouter: "OpenRouter",
  custom: "Свой сервер",
  "claude-code": "Подписка Claude",
  codex: "Подписка ChatGPT",
  antigravity: "Аккаунт Google (Antigravity)",
  copilot: "GitHub Copilot",
};
const SUGGEST: Record<string, string[]> = {
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"],
  openrouter: [],
  custom: [],
  "claude-code": ["opus", "sonnet", "haiku"],
  codex: ["default", "gpt-6.2-sol", "gpt-6.1-sol", "gpt-6-sol", "gpt-5.5"],
  antigravity: ["default"],
  copilot: [],
};
const PLACEHOLDER: Partial<Record<ProviderId, string>> = {
  openrouter: "например anthropic/claude-sonnet-5.5",
  "claude-code": "opus, sonnet или haiku",
  codex: "default — модель по умолчанию в Codex",
  antigravity: "default — модель, выбранная в agy",
  copilot: "загрузи список моделей кнопкой ниже",
};
const code = "rounded-sm bg-code px-1 py-px font-mono text-xs text-text";

function KeyField({ label, saved, hint, onSave }: { label: string; saved: boolean; hint: string; onSave: (v: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (v: string) => {
    setBusy(true);
    await onSave(v);
    setValue("");
    setBusy(false);
  };
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-sm">
        <span className="text-bright">{label}</span>
        {saved ? <Badge tone="ok">ключ сохранён</Badge> : <Badge>нет ключа</Badge>}
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          className={inputClass}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={saved ? "Вставь новый ключ, чтобы заменить" : hint}
          autoComplete="off"
          spellCheck={false}
        />
        <Button variant="primary" disabled={busy || !value.trim()} onClick={() => save(value)}>
          Сохранить
        </Button>
        {saved && (
          <Button variant="ghost" disabled={busy} onClick={() => save("")}>
            Удалить
          </Button>
        )}
      </div>
    </div>
  );
}

function RoleEditor({
  name,
  title,
  hint,
  role,
  onSave,
}: {
  name: "strong" | "cheap";
  title: string;
  hint: string;
  role: RoleConfig;
  onSave: (r: RoleConfig) => Promise<void>;
}) {
  const [provider, setProvider] = useState<ProviderId>(role.provider);
  const [model, setModel] = useState(role.model);
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const dirty = provider !== role.provider || model.trim() !== role.model;

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(null);
  };

  const options = [...new Set([...(SUGGEST[provider] ?? []), ...models])];

  return (
    <div className="space-y-2.5">
      <div>
        <div className="text-bright">{title}</div>
        <div className="text-sm text-muted">{hint}</div>
      </div>
      <div className="grid gap-2 sm:grid-cols-[200px_1fr]">
        <select
          className={inputClass}
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value as ProviderId);
            setModels([]);
          }}
          aria-label="Провайдер"
        >
          {(Object.keys(PROVIDER_LABEL) as (keyof typeof PROVIDER_LABEL)[]).map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABEL[p]}
            </option>
          ))}
        </select>
        <input
          className={cx(inputClass, "font-mono text-[15px]")}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          list={`models-${name}`}
          placeholder={PLACEHOLDER[provider] ?? "идентификатор модели"}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Модель"
        />
        <datalist id={`models-${name}`}>
          {options.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button small variant="primary" disabled={!dirty || !model.trim() || !!busy} onClick={() => act("save", () => onSave({ provider, model: model.trim() }))}>
          Сохранить
        </Button>
        <Button
          small
          disabled={!!busy}
          onClick={() =>
            act("list", async () => {
              const r = await api<{ models: string[] }>(`/api/models?provider=${provider}`);
              setModels(r.models);
              setMsg({ tone: "ok", text: `Загружено моделей: ${r.models.length}. Начни вводить название — появятся подсказки.` });
            })
          }
        >
          {busy === "list" ? "Загружаю…" : "Загрузить список моделей"}
        </Button>
        <Button
          small
          disabled={dirty || !!busy}
          title={dirty ? "Сначала сохрани" : ""}
          onClick={() =>
            act("test", async () => {
              const r = await api<{ reply: string }>("/api/settings/test", { body: { role: name } });
              setMsg({ tone: "ok", text: `Работает. Ответ модели: «${r.reply.trim()}»` });
            })
          }
        >
          {busy === "test" ? "Проверяю…" : "Проверить"}
        </Button>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}

/** Sign in to GitHub for Copilot: GitHub shows a code, the owner types it on github.com, the page waits. */
function CopilotLogin({ signedIn, onChange }: { signedIn: boolean; onChange: (c: AppConfig) => void }) {
  const [pending, setPending] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const poll = (interval: number) => {
    timer.current = setTimeout(async () => {
      try {
        const r = await api<{ status: string; config?: AppConfig }>("/api/settings/copilot", { body: { action: "poll" } });
        if (r.status === "done" && r.config) {
          setPending(null);
          setMsg({ tone: "ok", text: "Вход выполнен. Теперь в «Моделях» выбери «GitHub Copilot» и загрузи список моделей." });
          onChange(r.config);
          return;
        }
        poll(r.status === "slow_down" ? interval + 5 : interval);
      } catch (e) {
        setPending(null);
        setMsg({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
      }
    }, interval * 1000);
  };

  const start = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ userCode: string; verificationUri: string; interval: number }>("/api/settings/copilot", { body: { action: "start" } });
      setPending(r);
      try {
        await navigator.clipboard.writeText(r.userCode);
      } catch {
        /* copying is only a convenience */
      }
      window.open(r.verificationUri, "_blank", "noopener");
      poll(r.interval);
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  };

  const signOut = async () => {
    if (timer.current) clearTimeout(timer.current);
    setPending(null);
    setMsg(null);
    try {
      onChange(await api<AppConfig>("/api/settings/copilot", { method: "DELETE" }));
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {signedIn ? <Badge tone="ok">вход выполнен</Badge> : <Badge>нет входа</Badge>}
        <Button small variant={signedIn ? "ghost" : "primary"} disabled={busy || !!pending} onClick={start}>
          {signedIn ? "Войти заново" : "Войти через GitHub"}
        </Button>
        {signedIn && (
          <Button small variant="ghost" onClick={signOut}>
            Выйти
          </Button>
        )}
      </div>
      {pending && (
        <Notice tone="warn">
          Открой{" "}
          <a className="underline" href={pending.verificationUri} target="_blank" rel="noopener noreferrer">
            {pending.verificationUri}
          </a>{" "}
          и введи код <code className="rounded-sm bg-code px-1.5 py-0.5 font-mono text-sm text-bright">{pending.userCode}</code> (он уже скопирован). Жду
          подтверждения…
        </Notice>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}

export default function SettingsPage() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  const load = useCallback(async () => {
    try {
      const c = await api<AppConfig>("/api/settings");
      setCfg(c);
      setUrl(c.customBaseUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const put = async (body: unknown) => {
    setError(null);
    try {
      setCfg(await api<AppConfig>("/api/settings", { method: "PUT", body }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <TopNav tab="Настройки" icon="gear" crumbs={[{ label: "Настройки" }]} />
      <Page narrow>
        <h1 className="mb-6 text-[26px] leading-tight font-normal text-bright">Настройки</h1>
        {error && <Notice tone="bad">{error}</Notice>}
        {!cfg ? (
          <Loading />
        ) : (
          <div className="space-y-6">
            {cfg.mockEnabled && <Notice tone="warn">Включён тестовый режим (TUTOR_MOCK=1): вместо настоящей модели отвечает сценарий-заглушка.</Notice>}

            <Card className="space-y-5">
              <div>
                <h2 className="text-[15px] font-semibold text-bright">Ключи доступа</h2>
                <p className="mt-1 text-sm text-muted">
                  Ключи хранятся в файле <code className="rounded-sm bg-code px-1 py-px font-mono text-xs text-text">.tutor/secrets.json</code> в твоей домашней папке, вне проекта, и никогда не
                  показываются в браузере. Отправляются они только выбранному провайдеру.
                </p>
              </div>
              <KeyField label="Anthropic" saved={cfg.has.anthropic} hint="sk-ant-…" onSave={(v) => put({ keys: { anthropic: v } })} />
              <KeyField label="OpenRouter" saved={cfg.has.openrouter} hint="sk-or-…" onSave={(v) => put({ keys: { openrouter: v } })} />
            </Card>

            <Card className="space-y-4">
              <div>
                <h2 className="text-[15px] font-semibold text-bright">Свой сервер</h2>
                <p className="mt-1 text-sm text-muted">
                  Любой адрес, совместимый с OpenAI API: локальные Ollama и LM Studio или другой провайдер. Модель должна поддерживать вызов инструментов (tool
                  calling), иначе уроки работать не будут.
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  className={cx(inputClass, "font-mono text-[15px]")}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="http://localhost:11434/v1"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  aria-label="Адрес сервера"
                />
                <Button variant="primary" disabled={url.trim() === cfg.customBaseUrl} onClick={() => put({ customBaseUrl: url })}>
                  Сохранить
                </Button>
              </div>
              <KeyField label="Ключ для своего сервера (если нужен)" saved={cfg.has.customKey} hint="необязательно" onSave={(v) => put({ keys: { custom: v } })} />
            </Card>

            <Card className="space-y-3">
              <h2 className="text-[15px] font-semibold text-bright">Подписка Claude</h2>
              <p className="text-sm text-muted">
                Можно учиться на подписке Claude (Pro или Max) без API-ключа. Приложение запускает программу Claude Code, установленную на этом компьютере, под твоим
                входом. Ключ или пароль от аккаунта приложению не нужны и нигде в нём не хранятся.
              </p>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
                <li>
                  Открой терминал, запусти <code className="rounded-sm bg-code px-1 py-px font-mono text-xs text-text">claude</code> и войди командой <code className="rounded-sm bg-code px-1 py-px font-mono text-xs text-text">/login</code>, если ещё не
                  входил.
                </li>
                <li>Ниже, в «Моделях», выбери «Подписка Claude» и модель: opus, sonnet или haiku.</li>
                <li>Нажми «Сохранить», затем «Проверить».</li>
              </ol>
              <p className="text-sm text-muted">
                Лимиты общие с Claude Code и claude.ai: уроки расходуют ту же квоту. Стоимость в приложении для подписки не показывается, только токены. Этот способ
                рассчитан на личное использование: раздавать приложение другим с входом через подписку правила Anthropic не разрешают.
              </p>
            </Card>

            <Card className="space-y-3">
              <h2 className="text-[15px] font-semibold text-bright">Подписка ChatGPT и аккаунт Google</h2>
              <p className="text-sm text-muted">
                Так же, как с Claude, можно учиться без API-ключа: приложение запускает установленную на компьютере программу под твоим входом. Нужен Node.js 20 или
                новее.
              </p>
              <div className="text-sm text-muted">
                <div className="text-bright">ChatGPT (Plus, Pro, Business…) через Codex</div>
                <ol className="mt-1 list-decimal space-y-1 pl-5">
                  <li>
                    Установи: <code className={code}>npm install -g @openai/codex</code>
                  </li>
                  <li>
                    Войди: <code className={code}>codex login</code> → «Sign in with ChatGPT».
                  </li>
                  <li>В «Моделях» выбери «Подписка ChatGPT» и модель (default — модель Codex по умолчанию).</li>
                </ol>
              </div>
              <div className="text-sm text-muted">
                <div className="text-bright">Аккаунт Google через Antigravity</div>
                <ol className="mt-1 list-decimal space-y-1 pl-5">
                  <li>
                    Установи Antigravity CLI (<code className={code}>agy</code>) с{" "}
                    <a className="underline" href="https://antigravity.google" target="_blank" rel="noopener noreferrer">
                      antigravity.google
                    </a>
                    .
                  </li>
                  <li>
                    Запусти <code className={code}>agy</code> в терминале и войди через Google. Там же командой <code className={code}>/model</code> можно выбрать
                    модель по умолчанию.
                  </li>
                  <li>
                    В «Моделях» выбери «Аккаунт Google (Antigravity)». Модель default берёт ту, что выбрана в agy; «Загрузить список моделей» покажет остальные,
                    доступные в Antigravity.
                  </li>
                </ol>
              </div>
              <p className="text-sm text-muted">
                Лимиты общие с Codex, ChatGPT и Antigravity. Ответ приходит чуть медленнее, чем по API-ключу: на каждый шаг запускается программа. Стоимость не
                показывается, только токены. Используй это подключение только для себя.
              </p>
            </Card>

            <Card className="space-y-3">
              <h2 className="text-[15px] font-semibold text-bright">GitHub Copilot</h2>
              <p className="text-sm text-muted">
                Можно учиться на подписке Copilot (подойдёт и бесплатный план) без API-ключа: войди через GitHub один раз, дальше приложение обращается к Copilot
                напрямую. Доступны модели твоего плана. Инструменты урока и фото решений работают так же, как по API-ключу.
              </p>
              <CopilotLogin signedIn={cfg.has.copilot} onChange={setCfg} />
              <p className="text-sm text-muted">
                Расходуются запросы твоего плана Copilot (у сильных моделей это premium requests), стоимость в приложении не показывается. Вход хранится вместе с
                ключами в <code className={code}>.tutor/secrets.json</code>. Это тот же вход, что у плагинов Copilot для редакторов. GitHub не описывает его для
                сторонних программ, так что он может перестать работать. Используй его только для себя.
              </p>
            </Card>

            <Card className="space-y-6">
              <h2 className="text-[15px] font-semibold text-bright">Модели</h2>
              <RoleEditor
                key={`strong-${cfg.roles.strong.provider}-${cfg.roles.strong.model}`}
                name="strong"
                title="Основная"
                hint="Ведёт уроки, практику и повторение, анализирует репозиторий. От неё зависит качество обучения — бери самую сильную, какую готов оплачивать."
                role={cfg.roles.strong}
                onSave={(r) => put({ roles: { strong: r } })}
              />
              <RoleEditor
                key={`cheap-${cfg.roles.cheap.provider}-${cfg.roles.cheap.model}`}
                name="cheap"
                title="Быстрая"
                hint="Отвечает на боковые вопросы. Подойдёт недорогая модель."
                role={cfg.roles.cheap}
                onSave={(r) => put({ roles: { cheap: r } })}
              />
            </Card>

            <TheoryCard cfg={cfg} put={put} />
            <GoalCard key={`goal-${cfg.dailyGoal}`} cfg={cfg} put={put} />
            <LimitCard key={String(cfg.dailyLimit)} cfg={cfg} put={put} />
            <AppearanceCard />
            <DataCard />

            <Card className="space-y-2">
              <h2 className="text-[15px] font-semibold text-bright">Доступ с телефона</h2>
              <p className="text-sm text-muted">
                Запусти на компьютере <code className="rounded-sm bg-code px-1 py-px font-mono text-xs text-text">start-lan.sh</code> (или{" "}
                <code className="rounded-sm bg-code px-1 py-px font-mono text-xs text-text">start-lan.cmd</code> на Windows) вместо{" "}
                <code className="rounded-sm bg-code px-1 py-px font-mono text-xs text-text">start.sh</code> /{" "}
                <code className="rounded-sm bg-code px-1 py-px font-mono text-xs text-text">start.cmd</code>. В
                окне появится адрес вида <code className="rounded-sm bg-code px-1 py-px font-mono text-xs text-text">http://192.168.x.x:3000</code> и пароль. Телефон должен быть в той же сети Wi-Fi.
                Компьютер при этом должен оставаться включённым.
              </p>
            </Card>
          </div>
        )}
      </Page>
    </>
  );
}
