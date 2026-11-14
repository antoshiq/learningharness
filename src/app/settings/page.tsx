"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, cx, inputClass, Notice, Page, TopNav } from "@/components/ui";
import { api } from "@/lib/api";
import type { AppConfig, ProviderId, RoleConfig } from "@/lib/types";

const PROVIDER_LABEL: Record<Exclude<ProviderId, "mock">, string> = {
  anthropic: "Claude (Anthropic)",
  openrouter: "OpenRouter",
  custom: "Свой сервер",
};
const SUGGEST: Record<string, string[]> = {
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"],
  openrouter: [],
  custom: [],
};

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
        <span className="font-medium">{label}</span>
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
        <div className="font-medium">{title}</div>
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
          placeholder={provider === "openrouter" ? "например anthropic/claude-sonnet-5.5" : "идентификатор модели"}
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
      <TopNav back={{ href: "/", label: "Темы" }} title="Настройки" />
      <Page narrow>
        {error && <Notice tone="bad">{error}</Notice>}
        {!cfg ? (
          <div className="text-sm text-muted">Загрузка…</div>
        ) : (
          <div className="space-y-5">
            {cfg.mockEnabled && <Notice tone="warn">Включён тестовый режим (TUTOR_MOCK=1): вместо настоящей модели отвечает сценарий-заглушка.</Notice>}

            <Card className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold">Ключи доступа</h2>
                <p className="mt-1 text-sm text-muted">
                  Ключи хранятся в файле <code className="font-mono text-[13px]">.tutor/secrets.json</code> в твоей домашней папке, вне проекта, и никогда не
                  показываются в браузере. Отправляются они только выбранному провайдеру.
                </p>
              </div>
              <KeyField label="Anthropic" saved={cfg.has.anthropic} hint="sk-ant-…" onSave={(v) => put({ keys: { anthropic: v } })} />
              <KeyField label="OpenRouter" saved={cfg.has.openrouter} hint="sk-or-…" onSave={(v) => put({ keys: { openrouter: v } })} />
            </Card>

            <Card className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Свой сервер</h2>
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

            <Card className="space-y-6">
              <h2 className="text-lg font-semibold">Модели</h2>
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

            <Card className="space-y-2">
              <h2 className="text-lg font-semibold">Доступ с телефона</h2>
              <p className="text-sm text-muted">
                Запусти на компьютере <code className="font-mono text-[13px]">start-lan.cmd</code> вместо <code className="font-mono text-[13px]">start.cmd</code>. В
                окне появится адрес вида <code className="font-mono text-[13px]">http://192.168.x.x:3000</code> и пароль. Телефон должен быть в той же сети Wi-Fi.
                Компьютер при этом должен оставаться включённым.
              </p>
            </Card>
          </div>
        )}
      </Page>
    </>
  );
}
