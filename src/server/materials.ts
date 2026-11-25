// A topic's materials: files the learner attached (lecture notes, a textbook
// chapter, code). Stored as text; the tutor teaches from them in every lesson.
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { extractDocx, extractImageMaterial, extractIpynb, extractPptx, isDocxName, isImageName, isIpynbName, isPptxName, isZip } from "./documents";
import { isPdf, pdfText } from "./extract";
import { isSecretName } from "./repo/scan";
import { photoType } from "./vision";
import { isSubtitleFile, subtitlesToText } from "./youtube";

/** A file picked in the browser; PDFs, Office files and images come as base64. */
export interface Upload {
  name: string;
  content: string;
  base64?: boolean;
}

const MAX_TEXT = 2_000_000;
const MAX_BINARY = 50 * 1024 * 1024;
/** All materials of one topic together, in characters. */
const MAX_TOPIC_CHARS = 5_000_000;
/** How much of the materials a lesson sees; the rest is listed by name. */
export const LESSON_BUDGET = 250_000;

export interface UploadOptions {
  /** Skip vision model calls for embedded figures/scans (faster, text/OCR only). */
  skipVision?: boolean;
  onProgress?: (text: string) => void;
}

/** Text of an uploaded file; refuses secrets, unsupported binaries and oversized files. */
export async function uploadText(u: Upload, opts: UploadOptions = {}): Promise<{ name: string; content: string }> {
  const name = u.name.replace(/[\\/]/g, "_").slice(0, 200) || "файл";
  if (isSecretName(name)) throw new Error(`${name} похож на файл с секретами и не отправляется модели.`);
  const docOpts = { useVision: !opts.skipVision, onProgress: opts.onProgress };
  if (!u.base64) {
    if (u.content.length > MAX_TEXT) throw new Error(`${name} слишком большой (больше 2 МБ текста).`);
    if (u.content.includes("\u0000")) throw new Error(`${name} не текстовый файл.`);
    if (isIpynbName(name)) return { name, content: extractIpynb(u.content) };
    // Subtitles of a lecture: keep the words and their times, drop the numbering and markup.
    if (isSubtitleFile(name)) {
      const text = subtitlesToText(u.content);
      if (!text) throw new Error(`${name}: не удалось разобрать субтитры`);
      return { name, content: text };
    }
    return { name, content: u.content };
  }
  const buf = Buffer.from(u.content, "base64");
  if (buf.length > MAX_BINARY) throw new Error(`${name} больше 50 МБ.`);
  if (isPdf(buf)) return { name, content: (await pdfText(buf, docOpts)).text };
  if (isDocxName(name) && isZip(buf)) return { name, content: await extractDocx(buf, docOpts) };
  if (isPptxName(name) && isZip(buf)) return { name, content: await extractPptx(buf, docOpts) };
  if (isImageName(name) || photoType(buf)) return { name, content: await extractImageMaterial(buf, name, docOpts) };
  if (buf.length > MAX_TEXT || buf.subarray(0, 8000).includes(0)) {
    throw new Error(`${name}: поддерживаются текст/код, PDF, Word (.docx), PowerPoint (.pptx), Jupyter (.ipynb) и изображения (PNG/JPG/WebP).`);
  }
  const text = buf.toString("utf8");
  if (isIpynbName(name)) return { name, content: extractIpynb(text) };
  return { name, content: text };
}

export function listMaterials(topicId: number) {
  return getDb()
    .select({ id: schema.topicFiles.id, name: schema.topicFiles.name, content: schema.topicFiles.content, createdAt: schema.topicFiles.createdAt })
    .from(schema.topicFiles)
    .where(eq(schema.topicFiles.topicId, topicId))
    .orderBy(asc(schema.topicFiles.id))
    .all()
    .map(({ content, ...f }) => ({ ...f, chars: content.length }));
}

export async function addMaterials(topicId: number, uploads: Upload[], opts: UploadOptions = {}) {
  if (!uploads.length) throw new Error("Нет файлов");
  const files = [];
  for (let i = 0; i < uploads.length; i++) {
    const u = uploads[i];
    const prefix = uploads.length > 1 ? `[${i + 1}/${uploads.length}] ${u.name}: ` : `${u.name}: `;
    opts.onProgress?.(`${prefix}обрабатываю…`);
    files.push(await uploadText(u, { skipVision: opts.skipVision, onProgress: (msg) => opts.onProgress?.(`${prefix}${msg}`) }));
  }
  const db = getDb();
  const have = listMaterials(topicId).reduce((n, f) => n + f.chars, 0);
  if (have + files.reduce((n, f) => n + f.content.length, 0) > MAX_TOPIC_CHARS) throw new Error("Материалов слишком много для одной темы (больше 5 млн символов)");
  const now = Date.now();
  db.insert(schema.topicFiles)
    .values(files.map((f) => ({ topicId, name: f.name, content: f.content.replace(/\r\n?/g, "\n"), createdAt: now })))
    .run();
  db.update(schema.topics).set({ updatedAt: now }).where(eq(schema.topics.id, topicId)).run();
  return listMaterials(topicId);
}

export function deleteMaterial(topicId: number, id: number) {
  getDb()
    .delete(schema.topicFiles)
    .where(and(eq(schema.topicFiles.topicId, topicId), eq(schema.topicFiles.id, id)))
    .run();
}

/**
 * The materials as prompt text, within `budget` characters. Files that do not
 * fit are cut and the cut is said out loud, so the model knows it is partial.
 */
export function materialsText(topicId: number, budget = LESSON_BUDGET): string {
  const rows = getDb().select().from(schema.topicFiles).where(eq(schema.topicFiles.topicId, topicId)).orderBy(asc(schema.topicFiles.id)).all();
  if (!rows.length) return "";
  const out: string[] = [];
  let left = budget;
  const skipped: string[] = [];
  for (const f of rows) {
    if (left < 500) {
      skipped.push(f.name);
      continue;
    }
    const cut = f.content.length > left ? f.content.slice(0, left) + `\n… (файл обрезан: показано ${left} из ${f.content.length} символов)` : f.content;
    out.push(`<материал файл="${f.name}">\n${cut}\n</материал>`);
    left -= cut.length;
  }
  if (skipped.length) out.push(`Не поместились в контекст: ${skipped.join(", ")}.`);
  return out.join("\n\n");
}
