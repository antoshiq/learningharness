// Quick overview ("экскурс") of a topic, files and documents, a link, a
// repository (local or on GitHub) or what changed in one. Works without tool
// calls, so every provider can write it (the Claude subscription included):
// the server gathers the material, the model only writes.
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { thesisKey } from "@/lib/brief";
import type { StreamEvent } from "@/lib/types";
import { briefSystem, EXPAND_SYSTEM, type BriefDepth, type BriefKind } from "./brief-prompts";
import { getDb, schema } from "./db";
import { fetchUrlText, isPdf, pdfText } from "./extract";
import { changesSince, headCommit, parseGithub, REPOS_DIR, resolveRepo } from "./git";
import { chatAs } from "./llm";
import { uploadText } from "./materials";
import { isSubtitleFile, youtubeId, youtubeTranscript } from "./youtube";
import { isText } from "./llm/types";
import { openScan, pickFiles, readChosen } from "./repo/pick";
import { isSecretName, MAX_FILE_BYTES } from "./repo/scan";

/** Characters of source material the model may see, by reading time. */
const BUDGET: Record<BriefDepth, number> = { 1: 24_000, 5: 60_000, 15: 120_000 };
const MAX_TOKENS: Record<BriefDepth, number> = { 1: 2_000, 5: 5_000, 15: 10_000 };
/** Files the model may add to the obvious ones when looking at a repository. */
const PICK: Record<BriefDepth, number> = { 1: 6, 5: 12, 15: 22 };
const MAX_UPLOAD_CHARS = 4_000_000;
const MAX_PDF_FILE = 30 * 1024 * 1024;
const DOC_EXT = /\.(pdf|md|markdown|txt|rst|adoc|html?|tex)$/i;

export interface BriefInput {
  kind: BriefKind;
  depth: BriefDepth;
  /** kind = topic */
  topic?: string;
  /** kind = repo | changes: a folder or a GitHub link */
  repoPath?: string;
  /** kind = url */
  url?: string;
  /** kind = files: absolute paths on this computer */
  paths?: string[];
  /** kind = files | topic | review: files picked in the browser; PDFs come as base64 */
  uploads?: { name: string; content: string; base64?: boolean }[];
  /** kind = review: code pasted into the page */
  code?: string;
}

interface Material {
  title: string;
  source: string;
  files: string[];
  text: string;
  /** Documents rather than code: written up as a document. */
  doc?: boolean;
  /** A topic written from the learner's own files rather than general knowledge. */
  grounded?: boolean;
  /** Files to keep with the overview; they become the topic's materials later. */
  materials?: { name: string; content: string }[];
  /** An extra instruction for this material, e.g. how to link to moments of a video. */
  extra?: string;
  commit?: string | null;
}

async function fileText(name: string, buf: Buffer): Promise<string> {
  if (isPdf(buf)) return (await pdfText(buf)).text;
  if (buf.subarray(0, 8000).includes(0)) throw new Error(`${name} не текстовый файл и не PDF.`);
  return buf.toString("utf8");
}

/** Reading files the learner named; refuse secrets, binaries and folders. */
async function readNamedFile(abs: string): Promise<{ name: string; content: string }> {
  const p = path.resolve(abs.trim().replace(/^"(.*)"$/, "$1"));
  const name = path.basename(p);
  if (!fs.existsSync(p)) throw new Error(`Файл не найден: ${p}`);
  const st = fs.statSync(p);
  if (st.isDirectory()) throw new Error(`${p} — это папка. Для папки проекта выбери «Репозиторий».`);
  if (isSecretName(name)) throw new Error(`${name} похож на файл с секретами и не отправляется модели.`);
  const limit = /\.pdf$/i.test(name) ? MAX_PDF_FILE : MAX_FILE_BYTES;
  if (st.size > limit) throw new Error(`${name} слишком большой (больше ${Math.round(limit / 1_000_000)} МБ).`);
  return { name, content: await fileText(name, fs.readFileSync(p)) };
}

/** Put texts into the prompt until the budget runs out; the rest is cut and marked. */
function pack(files: { name: string; content: string }[], budget: number): { text: string; used: string[] } {
  const out: string[] = [];
  const used: string[] = [];
  let left = budget;
  for (const f of files) {
    if (left < 400) break;
    const body = f.content.replace(/\r\n?/g, "\n");
    const cut = body.length > left ? body.slice(0, left) + `\n… (обрезано, всего ${body.length} символов)` : body;
    out.push(`<файл путь="${f.name}">\n${cut}\n</файл>`);
    used.push(f.name);
    left -= cut.length;
  }
  return { text: out.join("\n\n"), used };
}

async function fromFiles(input: BriefInput, emit: (e: StreamEvent) => void): Promise<Material> {
  const named = (input.paths ?? []).map((p) => p.trim()).filter(Boolean);
  if (!named.length && !input.uploads?.length) throw new Error("Добавь хотя бы один файл");
  if ([...named, ...(input.uploads ?? []).map((u) => u.name)].some((n) => /\.pdf$/i.test(n))) emit({ type: "status", text: "Извлекаю текст из PDF…" });
  const files: { name: string; content: string }[] = [];
  for (const p of named) files.push(await readNamedFile(p));
  for (const u of input.uploads ?? []) files.push(await uploadText(u));
  if (files.some((f) => f.content.includes("\u0000"))) throw new Error("Среди файлов есть не текстовый");
  if (files.reduce((n, f) => n + f.content.length, 0) > MAX_UPLOAD_CHARS) throw new Error("Слишком много текста: выбери меньше файлов");
  const { text, used } = pack(files, BUDGET[input.depth]);
  const title = files.length === 1 ? files[0].name : `${files[0].name} и ещё ${files.length - 1}`;
  return {
    title,
    source: files.map((f) => f.name).join(", "),
    files: used,
    text: `Файлы ученика:\n\n${text}`,
    doc: files.every((f) => DOC_EXT.test(f.name) || isSubtitleFile(f.name)),
    materials: files,
    extra: files.some((f) => isSubtitleFile(f.name)) ? SUBTITLES_RULE : undefined,
  };
}

async function fromUrl(input: BriefInput, emit: (e: StreamEvent) => void): Promise<Material> {
  const link = (input.url ?? "").trim();
  if (!link) throw new Error("Вставь ссылку");
  if (parseGithub(link) && !/\/blob\//.test(link)) {
    throw new Error("Это ссылка на репозиторий GitHub: выбери «Репозиторий», там можно вставить ссылку.");
  }
  const video = youtubeId(link);
  if (video) {
    emit({ type: "status", text: "Беру субтитры видео…" });
    const v = await youtubeTranscript(link);
    const { text } = pack([{ name: v.title, content: v.text }], BUDGET[input.depth]);
    const url = `https://youtu.be/${v.id}`;
    return {
      title: v.title,
      source: url,
      files: [url],
      doc: true,
      extra: `Материал — расшифровка видеолекции${v.auto ? " (автоматические субтитры, возможны ошибки распознавания: исправляй очевидные по смыслу)" : ""}. Каждая строка начинается с [м:сс|секунды]. Ссылайся на моменты видео ссылками вида [12:34](${url}?t=754), где после t= — секунды из строки; ставь такие ссылки у тезисов и шагов.`,
      text: `Видео «${v.title}» (${url}), расшифровка:\n\n${text}`,
    };
  }
  emit({ type: "status", text: "Открываю ссылку…" });
  const page = await fetchUrlText(link);
  const { text } = pack([{ name: page.url, content: page.text }], BUDGET[input.depth]);
  return { title: page.title || page.url, source: page.url, files: [page.url], text: `Документ по ссылке ${page.url}:\n\n${text}`, doc: true };
}

const repoTitle = (root: string, url: string | null) => {
  const gh = url ? parseGithub(url) : null;
  return gh ? `${gh.owner}/${gh.repo}` : path.basename(root);
};

async function fromRepo(input: BriefInput, emit: (e: StreamEvent) => void): Promise<Material> {
  const where = (input.repoPath ?? "").trim();
  if (!where) throw new Error("Укажи путь к папке проекта или ссылку на GitHub");
  const { root, url } = await resolveRepo(where, emit);
  const scan = openScan(root);
  const title = repoTitle(root, url);
  const { tree, chosen } = await pickFiles(scan, "составить обзор: что это за проект и как он устроен", PICK[input.depth], { emit });
  emit({ type: "status", text: `Читаю файлы проекта: ${chosen.length}…` });
  const { text, used } = readChosen(scan, chosen, BUDGET[input.depth] - Math.min(tree.length, 16_000));
  return {
    title,
    source: url ?? root,
    files: used,
    commit: await headCommit(root),
    text: `Проект «${title}», доступно для чтения ${scan.files.length} файлов.\n\nДерево:\n${tree.slice(0, 16_000)}\n\nПрочитанные файлы:\n\n${text}`,
  };
}

/** The commit the last overview of this project described: where "what changed" starts. */
function lastCommit(source: string): string | null {
  return (
    getDb()
      .select({ commit: schema.briefs.commit })
      .from(schema.briefs)
      .where(and(eq(schema.briefs.source, source), inArray(schema.briefs.kind, ["repo", "changes"]), isNotNull(schema.briefs.commit)))
      .orderBy(desc(schema.briefs.id))
      .get()?.commit ?? null
  );
}

async function fromChanges(input: BriefInput, emit: (e: StreamEvent) => void): Promise<Material> {
  const where = (input.repoPath ?? "").trim();
  if (!where) throw new Error("Укажи путь к папке проекта или ссылку на GitHub");
  const { root, url, before } = await resolveRepo(where, emit);
  const source = url ?? root;
  const since = lastCommit(source) ?? before;
  emit({ type: "status", text: since ? "Собираю изменения с прошлого экскурса…" : "Собираю изменения за последние две недели…" });
  const ch = await changesSince(root, since, BUDGET[input.depth]);
  if (!ch.commits && !ch.diff) throw new Error(since ? "С прошлого раза в проекте ничего не изменилось." : "За последние две недели в проекте нет изменений.");
  const title = `${repoTitle(root, url)}: что изменилось`;
  return {
    title,
    source,
    files: ch.stat.split("\n").map((l) => l.split("|")[0].trim()).filter((l) => l && !/files? changed/.test(l)).slice(0, 200),
    commit: ch.to,
    text:
      `Проект «${repoTitle(root, url)}». ${since ? `Изменения с коммита ${since.slice(0, 10)}` : "Изменения за последние две недели"}${ch.dirty ? ", включая незакоммиченные" : ""}.\n\n` +
      `Коммиты (${ch.commits}):\n${ch.log || "(нет новых коммитов)"}\n\nСводка по файлам:\n${ch.stat}\n\nИзменения:\n\`\`\`diff\n${ch.diff}\n\`\`\``,
  };
}

const SUBTITLES_RULE = "Среди материалов есть субтитры видео: их строки начинаются с [м:сс|секунды]. Ссылайся на моменты как [м:сс], чтобы ученик мог найти место в видео.";

/** Code with line numbers, so the review can point at lines. */
const numbered = (s: string) =>
  s
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l, i) => `${String(i + 1).padStart(4)}│ ${l}`)
    .join("\n");

/** A file name for pasted code, by what the code looks like; never clashes with attached files. */
export function pastedName(code: string, taken: string[]): string {
  const ext = /^\s*(def |class |import |from \S+ import|print\(|if __name__)/m.test(code)
    ? ".py"
    : /\b(function|const|let|=>|console\.log|require\(|export )/.test(code)
      ? ".js"
      : /#include|int main\s*\(/.test(code)
        ? ".cpp"
        : /\b(public class|System\.out)/.test(code)
          ? ".java"
          : ".txt";
  let name = `main${ext}`;
  for (let i = 2; taken.includes(name); i++) name = `main${i}${ext}`;
  return name;
}

async function fromReview(input: BriefInput, emit: (e: StreamEvent) => void): Promise<Material> {
  const files: { name: string; content: string }[] = [];
  if (input.uploads?.some((u) => u.base64)) emit({ type: "status", text: "Читаю файлы…" });
  for (const u of input.uploads ?? []) files.push(await uploadText(u));
  const pasted = (input.code ?? "").trim();
  if (pasted) files.unshift({ name: pastedName(pasted, files.map((f) => f.name)), content: pasted });
  if (!files.length) throw new Error("Вставь код или приложи файлы");
  if (files.reduce((n, f) => n + f.content.length, 0) > MAX_UPLOAD_CHARS) throw new Error("Слишком много кода для одного разбора: выбери главное");
  const { text, used } = pack(files.map((f) => ({ name: f.name, content: numbered(f.content) })), BUDGET[input.depth]);
  const focus = (input.topic ?? "").trim();
  const first = pasted ? "код" : files[0].name;
  return {
    title: `Разбор: ${focus || first}${files.length > 1 ? ` и ещё ${files.length - 1}` : ""}`.slice(0, 200),
    source: files.map((f) => f.name).join(", "),
    files: used,
    materials: files,
    text: (focus ? `Ученик просит обратить внимание: ${focus}\n\n` : "") + `Код ученика:\n\n${text}`,
  };
}

async function fromTopic(input: BriefInput, emit: (e: StreamEvent) => void): Promise<Material> {
  const t = (input.topic ?? "").trim();
  const uploads = input.uploads ?? [];
  if (!t && !uploads.length) throw new Error("Напиши тему или приложи файлы");
  if (!uploads.length) return { title: t.slice(0, 200), source: t.slice(0, 2000), files: [], text: `Тема экскурса: ${t.slice(0, 2000)}` };

  if (uploads.some((u) => u.base64)) emit({ type: "status", text: "Извлекаю текст из файлов…" });
  const files: { name: string; content: string }[] = [];
  for (const u of uploads) files.push(await uploadText(u));
  if (files.reduce((n, f) => n + f.content.length, 0) > MAX_UPLOAD_CHARS) throw new Error("Слишком много текста: выбери меньше файлов");
  const { text, used } = pack(files, BUDGET[input.depth]);
  const title = t || files[0].name.replace(/\.[^.]+$/, "");
  return {
    title: title.slice(0, 200),
    source: (t ? `${t} · ` : "") + files.map((f) => f.name).join(", "),
    files: used,
    grounded: true,
    materials: files,
    extra: uploads.some((u) => isSubtitleFile(u.name)) ? SUBTITLES_RULE : undefined,
    text: `Тема экскурса: ${t || "по материалам ниже"}\n\nМатериалы ученика:\n\n${text}`,
  };
}

const KINDS: BriefKind[] = ["topic", "files", "repo", "url", "changes", "review"];

export function checkInput(raw: Partial<BriefInput>): BriefInput {
  const kind = KINDS.includes(raw.kind as BriefKind) ? (raw.kind as BriefKind) : "topic";
  const depth = ([1, 5, 15] as const).find((d) => d === Number(raw.depth)) ?? 5;
  return { ...raw, kind, depth };
}

/** Gather the material, stream the overview, save it. Emits {type:"saved", id} at the end. */
export async function writeBrief(input: BriefInput, emit: (e: StreamEvent) => void): Promise<number> {
  const m =
    input.kind === "repo"
      ? await fromRepo(input, emit)
      : input.kind === "changes"
        ? await fromChanges(input, emit)
        : input.kind === "files"
          ? await fromFiles(input, emit)
          : input.kind === "url"
            ? await fromUrl(input, emit)
            : input.kind === "review"
              ? await fromReview(input, emit)
              : await fromTopic(input, emit);
  emit({ type: "status", text: "Пишу экскурс…" });
  const r = await chatAs("strong", "brief", null, {
    system: briefSystem(input.kind, input.depth, m.doc, m.grounded, m.extra),
    messages: [{ role: "user", content: [{ type: "text", text: `${m.text}\n\nСоставь экскурс.` }] }],
    maxTokens: MAX_TOKENS[input.depth],
    onText: (delta) => emit({ type: "text", delta }),
  });
  const text = r.content.filter(isText).map((b) => b.text).join("").trim();
  if (!text) throw new Error("Модель вернула пустой ответ");
  const row = getDb()
    .insert(schema.briefs)
    .values({
      kind: input.kind,
      title: m.title,
      source: m.source,
      depth: input.depth,
      text,
      expansions: {},
      files: m.files,
      materials: m.materials?.map((f) => ({ name: f.name, content: f.content.replace(/\r\n?/g, "\n") })) ?? null,
      commit: m.commit ?? null,
      createdAt: Date.now(),
    })
    .returning({ id: schema.briefs.id })
    .get();
  emit({ type: "saved", id: row.id });
  return row.id;
}

/** Explain one thesis in more depth; answers are cached on the overview. */
export async function expandThesis(id: number, thesis: string, emit: (e: StreamEvent) => void): Promise<void> {
  const db = getDb();
  const b = db.select().from(schema.briefs).where(eq(schema.briefs.id, id)).get();
  if (!b) throw new Error("Экскурс не найден");
  const key = thesisKey(thesis);
  if (!key) throw new Error("Пустой тезис");
  const cached = b.expansions[key];
  if (cached) {
    emit({ type: "text", delta: cached });
    return;
  }
  const r = await chatAs("cheap", "brief-expand", null, {
    system: EXPAND_SYSTEM,
    messages: [
      { role: "user", content: [{ type: "text", text: `Экскурс «${b.title}»:\n<экскурс>\n${b.text.slice(0, 20_000)}\n</экскурс>` }] },
      { role: "assistant", content: [{ type: "text", text: "Прочитал. Какой тезис раскрыть?" }] },
      { role: "user", content: [{ type: "text", text: key }] },
    ],
    maxTokens: 1500,
    onText: (delta) => emit({ type: "text", delta }),
  });
  const text = r.content.filter(isText).map((x) => x.text).join("").trim();
  if (!text) throw new Error("Модель вернула пустой ответ");
  // Re-read: another thesis may have been saved while this one was being written.
  const fresh = db.select({ e: schema.briefs.expansions }).from(schema.briefs).where(eq(schema.briefs.id, id)).get();
  db.update(schema.briefs)
    .set({ expansions: { ...(fresh?.e ?? {}), [key]: text } })
    .where(eq(schema.briefs.id, id))
    .run();
}

export function listBriefs() {
  return getDb()
    .select({ id: schema.briefs.id, kind: schema.briefs.kind, title: schema.briefs.title, source: schema.briefs.source, depth: schema.briefs.depth, topicId: schema.briefs.topicId, createdAt: schema.briefs.createdAt })
    .from(schema.briefs)
    .orderBy(desc(schema.briefs.id))
    .limit(100)
    .all();
}

export function getBrief(id: number) {
  return getDb().select().from(schema.briefs).where(eq(schema.briefs.id, id)).get() ?? null;
}

/** Where a repository overview's project lives on this computer (a GitHub one is in data/repos). */
export function localRepo(source: string): string | null {
  const gh = parseGithub(source);
  const dir = gh ? path.join(REPOS_DIR(), `${gh.owner}__${gh.repo}`) : source;
  return fs.existsSync(dir) ? dir : null;
}

/**
 * Continue from the overview into a full topic. For a repository the overview
 * becomes the project map, so the first lesson skips the analysis phase.
 */
export function briefToTopic(id: number): number {
  const db = getDb();
  const b = getBrief(id);
  if (!b) throw new Error("Экскурс не найден");
  if (b.topicId && db.select({ id: schema.topics.id }).from(schema.topics).where(eq(schema.topics.id, b.topicId)).get()) return b.topicId;
  const now = Date.now();
  const repoDir = b.kind === "repo" || b.kind === "changes" ? localRepo(b.source) : null;
  const goal =
    b.kind === "topic"
      ? "Разобраться подробно после краткого экскурса"
      : b.kind === "files"
        ? `Разобраться в файлах: ${b.source}`
        : b.kind === "url"
          ? `Разобраться в материале: ${b.source}`
          : b.kind === "review"
            ? `Подтянуть то, что показал разбор моего кода: ${b.source}`
          : b.kind === "changes"
            ? "Разобраться в последних изменениях проекта"
            : "Понять, как устроен проект";
  const topic = db
    .insert(schema.topics)
    .values({
      title: b.title,
      goal: goal.slice(0, 1000),
      kind: repoDir ? "repo" : "topic",
      repoPath: repoDir,
      repoMap: repoDir && b.kind === "repo" ? b.text : null,
      brief: b.text,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.topics.id })
    .get();
  if (b.materials?.length) {
    db.insert(schema.topicFiles)
      .values(b.materials.map((f) => ({ topicId: topic.id, name: f.name, content: f.content, createdAt: now })))
      .run();
  }
  db.update(schema.briefs).set({ topicId: topic.id }).where(eq(schema.briefs.id, id)).run();
  return topic.id;
}
