// Extraction of study documents beyond plain text & PDF:
//   - Word (.docx): headings, paragraphs, Markdown tables, OMML math text, embedded images
//   - PowerPoint (.pptx): slides in order, tables, speaker notes, slide images
//   - Jupyter notebooks (.ipynb): markdown cells, code blocks, concise text outputs
//   - Standalone images (.png, .jpg, .webp): vision model with local OCR fallback
//
// ZIP archives (.docx / .pptx) are read directly with node:zlib (no extra deps).
import { createHash } from "node:crypto";
import zlib from "node:zlib";
import { ocrImage } from "./ocr";
import { describeDocumentImages, photoType } from "./vision";

const MAX_ZIP_ENTRIES = 2000;
const MAX_ENTRY_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_UNZIP_BYTES = 100 * 1024 * 1024;
const MIN_EMBEDDED_IMAGE_BYTES = 8 * 1024;
const MAX_DOC_VISION_IMAGES = 20;

export const isZip = (buf: Uint8Array) => buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
export const isDocxName = (name: string) => /\.docx$/i.test(name);
export const isPptxName = (name: string) => /\.pptx$/i.test(name);
export const isIpynbName = (name: string) => /\.ipynb$/i.test(name);
export const isImageName = (name: string) => /\.(png|jpe?g|webp)$/i.test(name);

/** Minimal, safe ZIP reader supporting Stored (0) and Deflate (8) entries. */
export function readZipEntries(raw: Uint8Array): Map<string, Buffer> {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  if (buf.length < 22) throw new Error("Файл повреждён (некорректный ZIP-архив)");

  // Find End of Central Directory record (signature 0x06054b50), searching from the end.
  const searchFrom = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= searchFrom; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Не удалось прочитать архив документа (нет заголовка ZIP)");

  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (totalEntries > MAX_ZIP_ENTRIES || cdOffset + cdSize > buf.length) {
    throw new Error("Слишком большой или повреждённый архив документа");
  }

  const out = new Map<string, Buffer>();
  let pos = cdOffset;
  let unzippedTotal = 0;

  for (let i = 0; i < totalEntries && pos + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const uncompSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    pos += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/") || uncompSize > MAX_ENTRY_BYTES) continue;
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > buf.length) continue;

    const slice = buf.subarray(dataStart, dataStart + compSize);
    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(slice);
    } else if (method === 8) {
      data = zlib.inflateRawSync(slice, { maxOutputLength: MAX_ENTRY_BYTES });
    } else {
      continue;
    }
    unzippedTotal += data.length;
    if (unzippedTotal > MAX_TOTAL_UNZIP_BYTES) throw new Error("Распакованный документ слишком большой");
    out.set(name, data);
  }
  return out;
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return XML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

function stripTagsText(xml: string, textTagPattern: RegExp): string {
  const parts: string[] = [];
  for (const m of xml.matchAll(textTagPattern)) {
    if (m[1] !== undefined) parts.push(decodeXml(m[1]));
    else if (m[0].includes("br") || m[0].includes("cr")) parts.push("\n");
    else if (m[0].includes("tab")) parts.push("\t");
  }
  return parts.join("");
}

function toMarkdownTable(rows: string[][]): string {
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim()));
  if (!nonEmpty.length) return "";
  const cols = Math.max(...nonEmpty.map((r) => r.length));
  const norm = nonEmpty.map((r) => {
    const padded = Array.from({ length: cols }, (_, i) => (r[i] ?? "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim());
    return `| ${padded.join(" | ")} |`;
  });
  const sep = `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`;
  return [norm[0], sep, ...norm.slice(1)].join("\n");
}

function parseWordParagraph(pXml: string): string {
  const text = stripTagsText(pXml, /<(?:w|m):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:w|m):t>|<w:(?:br|cr|tab)(?:\s[^>]*)?\/>/g).trim();
  if (!text) return "";
  const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/i.exec(pXml)?.[1] ?? "";
  const heading = /^(?:Heading|Заголовок|Title)\s*(\d)?/i.exec(style);
  if (heading) {
    const level = Math.max(1, Math.min(6, Number(heading[1] || 1)));
    return `${"#".repeat(level)} ${text}`;
  }
  if (/<w:numPr\b/.test(pXml)) return `- ${text}`;
  return text;
}

function parseWordTable(tblXml: string): string {
  const rows: string[][] = [];
  for (const rm of tblXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
    const cells: string[] = [];
    for (const cm of rm[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)) {
      const paras = [...cm[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
        .map((pm) => stripTagsText(pm[0], /<(?:w|m):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:w|m):t>|<w:(?:br|cr|tab)(?:\s[^>]*)?\/>/g).trim())
        .filter(Boolean);
      cells.push(paras.join(" "));
    }
    if (cells.length) rows.push(cells);
  }
  return toMarkdownTable(rows);
}

/** Walk top-level children of <w:body> (paragraphs and tables in document order). */
function parseWordBody(xml: string): string {
  const body = /<w:body\b[^>]*>([\s\S]*?)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const blocks: string[] = [];
  let pos = 0;
  while (pos < body.length) {
    const nextP = body.indexOf("<w:p", pos);
    const nextTbl = body.indexOf("<w:tbl", pos);
    const pValid = nextP >= 0 && /[\s>]/.test(body[nextP + 4] ?? "");
    const tValid = nextTbl >= 0 && /[\s>]/.test(body[nextTbl + 6] ?? "");
    if (!pValid && !tValid) {
      // Skip unrelated tags like <w:pPr> or <w:tblPr> if matched
      const next = Math.min(nextP >= 0 ? nextP : Infinity, nextTbl >= 0 ? nextTbl : Infinity);
      if (!Number.isFinite(next)) break;
      pos = next + 4;
      continue;
    }
    if (tValid && (!pValid || nextTbl < nextP)) {
      // Find matching </w:tbl> accounting for nested tables
      let depth = 0;
      let i = nextTbl;
      let end = -1;
      const re = /<(\/?)w:tbl(?=[\s>])/g;
      re.lastIndex = nextTbl;
      let m;
      while ((m = re.exec(body))) {
        if (m[1] === "/") depth--;
        else depth++;
        if (depth === 0) {
          end = body.indexOf(">", m.index) + 1;
          break;
        }
        i = m.index;
      }
      if (end <= nextTbl) {
        pos = i + 6;
        continue;
      }
      const tbl = parseWordTable(body.slice(nextTbl, end));
      if (tbl) blocks.push(tbl);
      pos = end;
    } else {
      const close = body.indexOf("</w:p>", nextP);
      if (close < 0) break;
      const p = parseWordParagraph(body.slice(nextP, close + 6));
      if (p) blocks.push(p);
      pos = close + 6;
    }
  }
  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function collectMediaImages(entries: Map<string, Buffer>, prefix: string, limit = MAX_DOC_VISION_IMAGES): { name: string; buffer: Buffer }[] {
  const seen = new Set<string>();
  const out: { name: string; buffer: Buffer }[] = [];
  const keys = [...entries.keys()].filter((k) => k.startsWith(prefix)).sort();
  for (const k of keys) {
    if (out.length >= limit) break;
    const buf = entries.get(k)!;
    if (buf.length < MIN_EMBEDDED_IMAGE_BYTES || !photoType(buf)) continue;
    const hash = createHash("sha256").update(buf).digest("hex");
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push({ name: k.split("/").pop() ?? k, buffer: buf });
  }
  return out;
}

/** Extract text, tables, footnotes and vision-described diagrams from a Word .docx file. */
export async function extractDocx(
  buf: Buffer,
  opts: { useVision?: boolean; onProgress?: (text: string) => void } = {},
): Promise<string> {
  opts.onProgress?.("Читаю Word-документ…");
  const entries = readZipEntries(buf);
  const docXml = entries.get("word/document.xml")?.toString("utf8");
  if (!docXml) throw new Error("Не удалось прочитать .docx (нет word/document.xml)");

  const parts: string[] = [];
  const main = parseWordBody(docXml);
  if (main) parts.push(main);

  const footnotes = entries.get("word/footnotes.xml")?.toString("utf8");
  if (footnotes) {
    const notes = [...footnotes.matchAll(/<w:footnote\b[^>]*w:id="([1-9]\d*)"[^>]*>([\s\S]*?)<\/w:footnote>/g)]
      .map((m) => parseWordBody(m[2]))
      .filter(Boolean);
    if (notes.length) parts.push("## Сноски\n" + notes.map((n, i) => `${i + 1}. ${n}`).join("\n"));
  }

  const images = collectMediaImages(entries, "word/media/");
  if (images.length && opts.useVision !== false) {
    const described = await describeDocumentImages(
      images.map((im, idx) => ({ label: String(idx + 1), buffer: im.buffer })),
      main.length < 100 ? "scan" : "figure",
      { onProgress: (done, total) => opts.onProgress?.(`Расшифровываю иллюстрации в .docx (${done} из ${total})…`) },
    );
    const figLines: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const desc = described.get(String(i + 1));
      if (desc) figLines.push(`[Иллюстрация ${i + 1} (${images[i].name})]:\n${desc}`);
    }
    if (figLines.length) parts.push("## Иллюстрации и схемы из документа\n\n" + figLines.join("\n\n"));
  }

  const text = parts.join("\n\n").trim();
  if (text.length < 5) throw new Error("В .docx не удалось найти текст или читаемые изображения.");
  return text;
}

function parseDrawingText(xml: string): string {
  const blocks: string[] = [];
  // Tables inside slides (<a:tbl>)
  const withoutTables = xml.replace(/<a:tbl\b[\s\S]*?<\/a:tbl>/g, (tbl) => {
    const rows: string[][] = [];
    for (const rm of tbl.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)) {
      const cells: string[] = [];
      for (const cm of rm[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)) {
        const txt = stripTagsText(cm[0], /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br(?:\s[^>]*)?\/>/g).trim();
        cells.push(txt);
      }
      if (cells.length) rows.push(cells);
    }
    const md = toMarkdownTable(rows);
    if (md) blocks.push(md);
    return "";
  });

  const paras: string[] = [];
  for (const pm of withoutTables.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)) {
    const t = stripTagsText(pm[0], /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br(?:\s[^>]*)?\/>/g).trim();
    if (t) paras.push(t);
  }
  return [...paras, ...blocks].join("\n\n").trim();
}

function slideImageTargets(entries: Map<string, Buffer>, slideNum: number): string[] {
  const rels = entries.get(`ppt/slides/_rels/slide${slideNum}.xml.rels`)?.toString("utf8");
  if (!rels) return [];
  const targets: string[] = [];
  for (const m of rels.matchAll(/Target="\.\.\/(media\/[^"]+)"/g)) {
    targets.push(`ppt/${m[1]}`);
  }
  return targets;
}

/** Extract slides, tables, speaker notes and slide diagrams from a PowerPoint .pptx file. */
export async function extractPptx(
  buf: Buffer,
  opts: { useVision?: boolean; onProgress?: (text: string) => void } = {},
): Promise<string> {
  opts.onProgress?.("Читаю слайды презентации…");
  const entries = readZipEntries(buf);
  const slideNums = [...entries.keys()]
    .map((k) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(k))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);

  if (!slideNums.length) throw new Error("Не удалось прочитать .pptx (слайды не найдены)");

  const slideTexts = new Map<number, string>();
  const toDescribe: { label: string; slide: number; buffer: Buffer }[] = [];
  const seenHashes = new Set<string>();

  for (const n of slideNums) {
    const xml = entries.get(`ppt/slides/slide${n}.xml`)!.toString("utf8");
    const parts: string[] = [];
    const body = parseDrawingText(xml);
    if (body) parts.push(body);

    const notesXml = entries.get(`ppt/notesSlides/notesSlide${n}.xml`)?.toString("utf8");
    if (notesXml) {
      const notes = parseDrawingText(notesXml).replace(/^\d+$/, "").trim();
      if (notes) parts.push(`Заметки к слайду:\n${notes}`);
    }
    slideTexts.set(n, parts.join("\n\n"));

    if (opts.useVision !== false && toDescribe.length < MAX_DOC_VISION_IMAGES) {
      for (const target of slideImageTargets(entries, n)) {
        if (toDescribe.length >= MAX_DOC_VISION_IMAGES) break;
        const imgBuf = entries.get(target);
        if (!imgBuf || imgBuf.length < MIN_EMBEDDED_IMAGE_BYTES || !photoType(imgBuf)) continue;
        const hash = createHash("sha256").update(imgBuf).digest("hex");
        if (seenHashes.has(hash)) continue;
        seenHashes.add(hash);
        toDescribe.push({ label: `s${n}_${toDescribe.length}`, slide: n, buffer: imgBuf });
      }
    }
  }

  const bySlide = new Map<number, string[]>();
  if (toDescribe.length) {
    const described = await describeDocumentImages(
      toDescribe.map((x) => ({ label: x.label, buffer: x.buffer })),
      "figure",
      { onProgress: (done, total) => opts.onProgress?.(`Расшифровываю схемы на слайдах (${done} из ${total})…`) },
    );
    for (const item of toDescribe) {
      const desc = described.get(item.label);
      if (desc) {
        const list = bySlide.get(item.slide) ?? [];
        list.push(`[Иллюстрация/схема]:\n${desc}`);
        bySlide.set(item.slide, list);
      }
    }
  }

  const out: string[] = [];
  for (const n of slideNums) {
    const chunks = [slideTexts.get(n), ...(bySlide.get(n) ?? [])].filter(Boolean);
    if (chunks.length) out.push(`[Слайд ${n}]\n${chunks.join("\n\n")}`);
  }
  const text = out.join("\n\n").trim();
  if (text.length < 5) throw new Error("В .pptx не удалось найти текст или читаемые изображения.");
  return text;
}

/** Turn a Jupyter Notebook (.ipynb) JSON into clean Markdown with code blocks and outputs. */
export function extractIpynb(raw: string): string {
  let nb: {
    metadata?: { kernelspec?: { language?: string }; language_info?: { name?: string } };
    cells?: { cell_type?: string; source?: string | string[]; outputs?: Record<string, unknown>[] }[];
  };
  try {
    nb = JSON.parse(raw);
  } catch {
    throw new Error("Некорректный формат .ipynb (ошибка JSON)");
  }
  if (!Array.isArray(nb.cells)) throw new Error("В .ipynb нет списка ячеек (cells)");
  const lang = nb.metadata?.kernelspec?.language ?? nb.metadata?.language_info?.name ?? "python";
  const join = (v: unknown) => (Array.isArray(v) ? v.join("") : typeof v === "string" ? v : "");

  const parts: string[] = [];
  for (let i = 0; i < nb.cells.length; i++) {
    const c = nb.cells[i];
    const src = join(c.source).trim();
    if (!src) continue;
    if (c.cell_type === "markdown") {
      parts.push(src);
    } else if (c.cell_type === "code") {
      let block = `\`\`\`${lang}\n${src}\n\`\`\``;
      const outs: string[] = [];
      for (const o of c.outputs ?? []) {
        if (o.output_type === "stream") {
          const t = join(o.text).trim();
          if (t) outs.push(t.slice(0, 2000));
        } else if (o.output_type === "execute_result" || o.output_type === "display_data") {
          const data = o.data as Record<string, unknown> | undefined;
          const t = join(data?.["text/plain"]).trim();
          if (t) outs.push(t.slice(0, 2000));
        } else if (o.output_type === "error") {
          const msg = `${o.ename ?? "Error"}: ${o.evalue ?? ""}`.trim();
          if (msg) outs.push(msg);
        }
      }
      if (outs.length) block += `\nВывод:\n\`\`\`\n${outs.join("\n").slice(0, 3000)}\n\`\`\``;
      parts.push(block);
    } else {
      parts.push(src);
    }
  }
  const text = parts.join("\n\n").trim();
  if (!text) throw new Error("Ноутбук .ipynb пуст");
  return text;
}

/** Read a standalone image file (screenshot, whiteboard photo, diagram) via vision model with OCR fallback. */
export async function extractImageMaterial(
  buf: Buffer,
  name: string,
  opts: { useVision?: boolean; onProgress?: (text: string) => void } = {},
): Promise<string> {
  if (!photoType(buf)) throw new Error(`${name}: поддерживаются изображения PNG, JPEG и WebP`);
  if (opts.useVision !== false) {
    opts.onProgress?.("Распознаю изображение через модель…");
    const res = await describeDocumentImages([{ label: "1", buffer: buf }], "scan");
    const text = res.get("1");
    if (text) return text;
  }
  opts.onProgress?.("Распознаю изображение локальным OCR…");
  const ocr = await ocrImage(buf);
  if (!ocr) throw new Error(`${name}: не удалось распознать изображение. Проверь модель с поддержкой картинок в «Настройках».`);
  return ocr;
}
