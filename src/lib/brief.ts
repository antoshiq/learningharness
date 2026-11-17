// Shared by the server and the browser: a thesis is stored and looked up by this key.

/** The text a thesis is stored under: its words, without Markdown noise. */
export function thesisKey(s: string): string {
  return s.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().slice(0, 400);
}

export const BRIEF_KIND_LABEL = { topic: "Тема", files: "Файлы", repo: "Репозиторий", url: "Ссылка", changes: "Изменения", review: "Разбор кода" } as const;
export const DEPTH_LABEL: Record<number, string> = { 1: "1 минута", 5: "5 минут", 15: "15 минут" };
