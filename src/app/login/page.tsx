"use client";

import { useState } from "react";
import { Button, Card, inputClass, Logo, Notice } from "@/components/ui";
import { api } from "@/lib/api";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/login", { body: { password } });
      // Full reload on purpose: the new cookie must apply to every request.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <Card className="sm:p-7">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Logo size={32} />
            <h1 className="mt-3 text-[22px] leading-tight font-normal text-bright">Репетитор</h1>
            <p className="mt-1.5 text-sm text-muted">
              Пароль показан в окне запуска на компьютере, там, где открыт <code className="rounded-sm bg-code px-1 py-px font-mono text-xs">start-lan.sh</code> /{" "}
              <code className="rounded-sm bg-code px-1 py-px font-mono text-xs">start-lan.cmd</code>.
            </p>
          </div>
          <input
            type="password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
            autoFocus
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Пароль"
          />
          {error && <Notice tone="bad">{error}</Notice>}
          <button type="submit" className="hidden" />
          <Button variant="primary" className="w-full" disabled={busy || !password} onClick={(e) => submit(e)}>
            {busy ? "Вхожу…" : "Войти"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
