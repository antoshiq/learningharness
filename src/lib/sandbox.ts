// Hand-off of code into the sandbox page, which opens in a new tab so the
// lesson stays where it was.
import type { Language } from "./types";

export const SANDBOX_INCOMING = "tutor.sandbox.incoming";

export function sandboxLanguage(lang: string | undefined): Language | null {
  if (!lang) return null;
  const l = lang.toLowerCase();
  if (l === "python" || l === "py" || l === "python3") return "python";
  if (l === "javascript" || l === "js" || l === "node" || l === "mjs") return "javascript";
  if (l === "sql" || l === "postgresql" || l === "postgres" || l === "psql" || l === "pgsql" || l === "plpgsql") return "sql";
  return null;
}

export function openInSandbox(language: Language, code: string) {
  try {
    localStorage.setItem(SANDBOX_INCOMING, JSON.stringify({ language, code, at: Date.now() }));
  } catch {}
  window.open("/sandbox?incoming=1", "_blank", "noopener");
}
