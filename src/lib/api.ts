import type { StreamEvent } from "./types";

/** JSON request helper for the browser. Throws Error with the server's message. */
export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Ошибка ${res.status}`);
  return data as T;
}

/** POST and read a server-sent event stream. Resolves when the stream ends. */
export async function streamPost(url: string, body: unknown, onEvent: (e: StreamEvent) => void): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body || !res.headers.get("content-type")?.includes("text/event-stream")) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Ошибка ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (chunk.startsWith("data: ")) {
        try {
          onEvent(JSON.parse(chunk.slice(6)) as StreamEvent);
        } catch {}
      }
    }
  }
}

export function formatCost(cost: number | null, known: boolean): string {
  if (cost === null) return "—";
  const s = cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2);
  return `${known ? "" : "≥ "}$${s}`;
}

/** Russian plural: plural(3, 'идею', 'идеи', 'идей') */
export function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + " млн";
  if (n >= 1000) return Math.round(n / 1000) + " тыс.";
  return String(n);
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "через 3 дня" / "сегодня" for review dates. */
export function formatDue(ms: number | null, now = Date.now()): string {
  if (ms === null) return "";
  const days = Math.round((ms - now) / 86_400_000);
  if (ms <= now) return "пора повторить";
  if (days <= 0) return "сегодня";
  if (days === 1) return "завтра";
  return `через ${days} дн.`;
}
