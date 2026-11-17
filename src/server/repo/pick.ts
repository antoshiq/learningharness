// Choosing which files of a project to read, without tool calls: obvious
// entry points, files that mention the words of a question, and what the fast
// model picks from the tree. Shared by the project overview and project Q&A.
import fs from "node:fs";
import path from "node:path";
import type { StreamEvent } from "@/lib/types";
import { chatAs } from "../llm";
import { isText } from "../llm/types";
import { getScan, renderTree, type ScanResult } from "./scan";
import { searchCode } from "./tools";

const PICK_SYSTEM = `Ты помогаешь разобраться в проекте. По дереву файлов выбери файлы, которые нужно прочитать для задачи ниже. Предпочитай точки входа, конфигурацию, ключевые модули и места, прямо связанные с задачей; не выбирай тесты, сгенерированные файлы и ассеты, если есть более важные.
Ответь только JSON-массивом путей из дерева, без пояснений, например: ["src/main.ts", "src/server/db.ts"]`;

/** Obvious entry points and manifests. */
const SEEDS = [
  /^readme(\.\w+)?$/i,
  /^(package\.json|pyproject\.toml|requirements\.txt|setup\.py|cargo\.toml|go\.mod|pom\.xml|build\.gradle(\.kts)?|composer\.json|gemfile|makefile|dockerfile|docker-compose\.ya?ml)$/i,
  /^(agents|claude|contributing)\.md$/i,
];
const ENTRY = /^(src\/)?(main|index|app|server|cli|manage)\.(ts|tsx|js|mjs|py|go|rs|java|rb|php)$|^src\/app\/(layout|page)\.tsx$|^cmd\/[^/]+\/main\.go$|^src\/main\.rs$/i;
const CODE = /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|kt|rb|php|cs|cpp|c|h|swift|vue|svelte)$/i;

export function openScan(root: string): ScanResult {
  let scan;
  try {
    scan = getScan(root).scan;
  } catch (e) {
    throw new Error(`Не удалось прочитать папку: ${e instanceof Error ? e.message : e}`);
  }
  if (!scan.files.length) throw new Error("В папке нет файлов, которые можно прочитать");
  return scan;
}

function parsePaths(text: string): string[] {
  const m = /\[[\s\S]*\]/.exec(text);
  if (!m) return [];
  try {
    const v = JSON.parse(m[0]) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Identifiers and distinctive words of a question, to search the code for. */
function keywords(q: string): string[] {
  const words = q.match(/[A-Za-z_][\w.$-]{3,}|[А-Яа-яЁё]{6,}/g) ?? [];
  const stop = new Set(["this", "that", "what", "where", "which", "with", "from", "have", "does", "file", "code", "function"]);
  return [...new Set(words.filter((w) => !stop.has(w.toLowerCase())))].slice(0, 6);
}

/** Files whose text mentions the question's words, most hits first. */
function searchHits(root: string, q: string): string[] {
  const score = new Map<string, number>();
  for (const w of keywords(q)) {
    let out: string;
    try {
      out = searchCode(root, w);
    } catch {
      continue;
    }
    for (const line of out.split("\n")) {
      const file = /^([^:\n]+):\d+:/.exec(line)?.[1];
      if (file) score.set(file, (score.get(file) ?? 0) + 1);
    }
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
}

/**
 * Pick up to `count` files to read for `task` (an overview, or a question).
 * Model errors that mean "stop" (daily cap, missing key) are passed on; any
 * other failure falls back to the obvious files and search hits.
 */
export async function pickFiles(scan: ScanResult, task: string, count: number, opts: { question?: string; known?: string[]; emit?: (e: StreamEvent) => void } = {}): Promise<{ tree: string; chosen: string[] }> {
  const all = new Set(scan.files.map((f) => f.path));
  const tree = renderTree(scan, 400);
  const seeds = opts.question
    ? searchHits(scan.root, opts.question).slice(0, 6)
    : scan.files.map((f) => f.path).filter((p) => (!p.includes("/") && SEEDS.some((r) => r.test(p))) || ENTRY.test(p)).slice(0, 8);

  opts.emit?.({ type: "status", text: opts.question ? "Ищу нужные файлы…" : "Смотрю структуру проекта…" });
  let picked: string[] = [];
  try {
    const r = await chatAs("cheap", "repo-pick", null, {
      system: PICK_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `Задача: ${task}\n\nДерево файлов проекта «${path.basename(scan.root)}»:\n${tree}\n\n` +
                (seeds.length ? `Уже выбраны: ${JSON.stringify(seeds)}\n` : "") +
                (opts.known?.length ? `Уже прочитаны раньше: ${JSON.stringify(opts.known.slice(0, 30))}\n` : "") +
                `Выбери ещё до ${count} файлов.`,
            },
          ],
        },
      ],
      maxTokens: 1000,
    });
    picked = parsePaths(r.content.filter(isText).map((b) => b.text).join("")).filter((p) => all.has(p));
  } catch (e) {
    if (e instanceof Error && /лимит|ключ|адрес|Настройки/i.test(e.message)) throw e;
  }
  const chosen = [...new Set([...seeds, ...picked])].slice(0, count + seeds.length);
  if (chosen.length < 3) {
    for (const f of [...scan.files].sort((a, b) => b.bytes - a.bytes)) {
      if (chosen.length >= 6) break;
      if (!chosen.includes(f.path) && CODE.test(f.path)) chosen.push(f.path);
    }
  }
  return { tree, chosen };
}

/** Read chosen files (all inside the scanned project), numbered when asked, within a character budget. */
export function readChosen(scan: ScanResult, chosen: string[], budget: number, numbered = false): { text: string; used: string[] } {
  const out: string[] = [];
  const used: string[] = [];
  let left = budget;
  for (const p of chosen) {
    if (left < 400) break;
    let body = fs.readFileSync(path.join(scan.root, p), "utf8").replace(/\r\n?/g, "\n");
    if (numbered) body = body.split("\n").map((l, i) => `${String(i + 1).padStart(4)}│ ${l}`).join("\n");
    const cut = body.length > left ? body.slice(0, left) + `\n… (файл обрезан)` : body;
    out.push(`<файл путь="${p}">\n${cut}\n</файл>`);
    used.push(p);
    left -= cut.length;
  }
  return { text: out.join("\n\n"), used };
}
