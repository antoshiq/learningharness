import fs from "node:fs";
import path from "node:path";
import { getScan, normalizeRel } from "./scan";

const MAX_READ_LINES = 300;
const MAX_HITS = 40;

export function listDir(root: string, rel: string): string {
  const { scan } = getScan(root);
  const dir = normalizeRel(rel || ".");
  const prefix = dir ? dir + "/" : "";
  const subdirs = new Map<string, number>();
  const files: string[] = [];
  for (const f of scan.files) {
    if (!f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    const i = rest.indexOf("/");
    if (i < 0) files.push(`${rest} (${f.bytes} Б)`);
    else subdirs.set(rest.slice(0, i), (subdirs.get(rest.slice(0, i)) ?? 0) + 1);
  }
  if (!files.length && !subdirs.size) return `Папка "${dir || "."}" пуста или недоступна.`;
  return [
    ...[...subdirs.entries()].sort().map(([d, n]) => `${d}/ (${n} файлов)`),
    ...files.sort(),
  ].join("\n");
}

export function readFile(root: string, rel: string, start?: number, end?: number): string {
  const { scan, set } = getScan(root);
  const p = normalizeRel(rel);
  if (!set.has(p)) {
    throw new Error(`Файл "${p}" недоступен (нет в репозитории, исключён как зависимость/сборка/секрет или слишком большой).`);
  }
  const abs = path.join(scan.root, p);
  // Defence in depth: the resolved real path must stay inside the root.
  const real = fs.realpathSync(abs);
  const relReal = path.relative(scan.root, real);
  if (relReal.startsWith("..") || path.isAbsolute(relReal)) throw new Error("Путь выходит за пределы репозитория");

  const lines = fs.readFileSync(real, "utf8").replace(/\r\n?/g, "\n").split("\n");
  const from = Math.max(1, Math.floor(start ?? 1));
  const to = Math.min(lines.length, Math.floor(end ?? from + MAX_READ_LINES - 1), from + MAX_READ_LINES - 1);
  if (from > lines.length) return `В файле ${p} всего ${lines.length} строк.`;
  const body = lines
    .slice(from - 1, to)
    .map((l, i) => `${String(from + i).padStart(5)}│ ${l}`)
    .join("\n");
  const more = to < lines.length ? `\n… показаны строки ${from}–${to} из ${lines.length}; читай дальше с start_line=${to + 1}` : "";
  return `${p} (строк: ${lines.length})\n${body}${more}`;
}

function globToRegExp(glob: string): RegExp {
  const esc = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/?/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${esc}$`, "i");
}

export function searchCode(root: string, query: string, glob?: string, isRegex?: boolean): string {
  const { scan } = getScan(root);
  let re: RegExp;
  try {
    re = isRegex ? new RegExp(query, "i") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  } catch (e) {
    throw new Error(`Некорректное регулярное выражение: ${e instanceof Error ? e.message : ""}`);
  }
  const g = glob ? globToRegExp(glob.includes("/") ? glob : `**/${glob}`) : null;
  const hits: string[] = [];
  let total = 0;
  for (const f of scan.files) {
    if (g && !g.test(f.path)) continue;
    let text: string;
    try {
      text = fs.readFileSync(path.join(scan.root, f.path), "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      total++;
      if (hits.length < MAX_HITS) hits.push(`${f.path}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
    }
  }
  if (!total) return `Ничего не найдено по запросу "${query}".`;
  return hits.join("\n") + (total > hits.length ? `\n… ещё ${total - hits.length} совпадений; уточни запрос или glob` : "");
}
