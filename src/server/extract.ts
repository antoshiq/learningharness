// Text out of PDFs and web pages, for overviews of documents and links.
import { createHash } from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { mockEnabled } from "./config";

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_PAGE_BYTES = 5 * 1024 * 1024;

export const isPdf = (buf: Uint8Array) => buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF

/** Scanned pages recognized on the spot (a request, not a background job), at most this many. */
const MAX_OCR_PAGES = 60;
/** Max embedded figures/diagrams described via vision in one uploaded PDF. */
const MAX_PDF_FIGURES = 20;

export async function pdfText(
  buf: Uint8Array,
  opts: { useVision?: boolean; onProgress?: (text: string) => void } = {},
): Promise<{ text: string; pages: number }> {
  if (buf.length > MAX_PDF_BYTES) throw new Error("PDF больше 50 МБ");
  opts.onProgress?.("Читаю текст PDF…");
  const { getDocumentProxy, extractText, extractImages } = await import("unpdf");
  let doc;
  try {
    doc = await getDocumentProxy(new Uint8Array(buf));
  } catch (e) {
    throw new Error(`Не удалось открыть PDF: ${e instanceof Error ? e.message : e}`);
  }
  const r = await extractText(doc, { mergePages: false });
  const raw = (r.text as string[]).map((t) => t.replace(/[ \t]+\n/g, "\n").trim());
  const { encodeRawImagePng, looksScanned, ocrPdfPage } = await import("./ocr");
  const { describeDocumentImages } = await import("./vision");
  const allowVision = opts.useVision !== false && !mockEnabled();

  const scanned = raw.map((t, i) => (looksScanned(t) ? i : -1)).filter((i) => i >= 0);
  if (scanned.length > MAX_OCR_PAGES) {
    throw new Error(`В PDF ${scanned.length} страниц-сканов: здесь распознаются до ${MAX_OCR_PAGES}. Длинный скан загрузи в «Семестр» — там книга распознаётся в фоне целиком.`);
  }

  // 1) Scanned pages: prefer the vision model (reads formulas, tables, diagrams); fall back to local OCR.
  if (scanned.length) {
    const scanImgs: { label: string; pageIdx: number; buffer: Buffer }[] = [];
    if (allowVision) {
      opts.onProgress?.(`Извлекаю страницы-сканы (${scanned.length})…`);
      for (const i of scanned) {
        try {
          const imgs = (await extractImages(doc, i + 1)).filter((im) => im.width >= 200 && im.height >= 100);
          // Pick the largest image on the scanned page (usually the full page scan).
          imgs.sort((a, b) => b.width * b.height - a.width * a.height);
          if (imgs[0]) {
            scanImgs.push({ label: `p${i}`, pageIdx: i, buffer: encodeRawImagePng(imgs[0], 2000) });
          }
        } catch {
          /* fall back to OCR below */
        }
      }
    }
    const visionText = scanImgs.length
      ? await describeDocumentImages(
          scanImgs.map((x) => ({ label: x.label, buffer: x.buffer })),
          "scan",
          { onProgress: (done, total) => opts.onProgress?.(`Распознаю сканы через модель (${done} из ${total})…`) },
        )
      : new Map<string, string>();
    let ocrIdx = 0;
    const needOcr = scanned.filter((i) => !visionText.get(`p${i}`));
    for (const i of scanned) {
      const fromModel = visionText.get(`p${i}`);
      if (fromModel) {
        raw[i] = fromModel;
      } else {
        ocrIdx++;
        opts.onProgress?.(`Локальный OCR страницы-скана (${ocrIdx} из ${needOcr.length})…`);
        raw[i] = await ocrPdfPage(doc, i + 1).catch(() => "");
      }
    }
  }

  // 2) Embedded diagrams, schemas, charts and tables-as-images on regular text pages.
  if (allowVision) {
    const scannedSet = new Set(scanned);
    const seenHashes = new Set<string>();
    const figs: { label: string; pageIdx: number; buffer: Buffer }[] = [];
    for (let i = 0; i < raw.length && figs.length < MAX_PDF_FIGURES; i++) {
      if (scannedSet.has(i)) continue;
      try {
        const imgs = (await extractImages(doc, i + 1)).filter((im) => im.width >= 240 && im.height >= 160);
        for (const im of imgs) {
          if (figs.length >= MAX_PDF_FIGURES) break;
          // Deduplicate repeated headers, footers and university logos across pages.
          const hash = createHash("sha256").update(im.data.subarray(0, Math.min(im.data.length, 65_536))).update(`${im.width}x${im.height}x${im.channels}`).digest("hex");
          if (seenHashes.has(hash)) continue;
          seenHashes.add(hash);
          figs.push({ label: `f${i}_${figs.length}`, pageIdx: i, buffer: encodeRawImagePng(im, 1600) });
        }
      } catch {
        /* ignore pages whose images unpdf cannot decode */
      }
    }
    if (figs.length) {
      const described = await describeDocumentImages(
        figs.map((x) => ({ label: x.label, buffer: x.buffer })),
        "figure",
        { onProgress: (done, total) => opts.onProgress?.(`Расшифровываю схемы и таблицы (${done} из ${total})…`) },
      );
      for (const f of figs) {
        const desc = described.get(f.label);
        if (desc) raw[f.pageIdx] = [raw[f.pageIdx], `[Иллюстрация/схема на стр. ${f.pageIdx + 1}]:\n${desc}`].filter(Boolean).join("\n\n");
      }
    }
  }

  const text = raw.map((t, i) => `[стр. ${i + 1}]\n${t}`).join("\n\n").trim();
  if (text.replace(/\[стр\. \d+\]/g, "").trim().length < 20) throw new Error("В PDF не удалось найти текст: ни текстового слоя, ни читаемых сканов.");
  return { text, pages: r.totalPages };
}

/** Loopback, private, link-local and other addresses a link from the internet must not point to. */
function privateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

async function assertPublic(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Нужна ссылка http:// или https://");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new Error(`Сайт ${host} не найден`);
  if (addrs.some(privateAddress)) throw new Error("Ссылки на локальную сеть и этот компьютер не открываются");
}

/** A GitHub file page shows the file inside an app; its raw form is the file itself. */
function rawGithub(url: URL): URL {
  const m = /^\/([\w.-]+)\/([\w.-]+)\/blob\/(.+)$/.exec(url.pathname);
  return url.hostname === "github.com" && m ? new URL(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`) : url;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", laquo: "«", raquo: "»", hellip: "…" };

/** Readable text of an HTML page: headings, paragraphs, lists and code, without menus and scripts. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  let body = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? html;
  body = body
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c: string) => `\n\`\`\`\n${c.replace(/<[^>]+>/g, "")}\n\`\`\`\n`)
    .replace(/<h([1-6])[^>]*>/gi, (_, n: string) => `\n\n${"#".repeat(Number(n))} `)
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section|\/blockquote)[^>]*>/gi, "\n")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: htmlToTitle(title), text: body };
}

const htmlToTitle = (t: string) => t.replace(/\s+/g, " ").replace(/&amp;/g, "&").slice(0, 200);

/** Fetch a link and return its text: HTML pages, plain text and Markdown, PDFs. */
export async function fetchUrlText(input: string): Promise<{ title: string; text: string; url: string }> {
  let url: URL;
  try {
    url = rawGithub(new URL(input.trim()));
  } catch {
    throw new Error("Некорректная ссылка");
  }
  // Follow redirects by hand so every hop is checked against private addresses.
  let res: Response | null = null;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(url);
    res = await fetch(url, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (tutor app)", accept: "text/html,text/plain,application/pdf,*/*" }, signal: AbortSignal.timeout(30_000) });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!loc) break;
    url = new URL(loc, url);
  }
  if (!res || !res.ok) throw new Error(`Страница не открылась: ${res?.status ?? "нет ответа"}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_PDF_BYTES) throw new Error("Файл по ссылке слишком большой");
  const buf = new Uint8Array(await res.arrayBuffer());
  const type = res.headers.get("content-type") ?? "";
  const name = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? url.hostname);
  if (type.includes("pdf") || isPdf(buf)) {
    const { text } = await pdfText(buf);
    return { title: name, text, url: url.toString() };
  }
  if (buf.length > MAX_PAGE_BYTES) throw new Error("Страница слишком большая");
  const raw = new TextDecoder("utf-8").decode(buf);
  if (type.includes("html") || /^\s*<(!doctype|html)/i.test(raw)) {
    const { title, text } = htmlToText(raw);
    if (text.length < 50) throw new Error("На странице почти нет текста: возможно, она собирается скриптами. Попробуй другую ссылку или файл.");
    return { title: title || url.hostname, text, url: url.toString() };
  }
  return { title: name, text: raw, url: url.toString() };
}
