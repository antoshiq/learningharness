// Text out of PDFs and web pages, for overviews of documents and links.
import dns from "node:dns/promises";
import net from "node:net";

const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_PAGE_BYTES = 5 * 1024 * 1024;

export const isPdf = (buf: Uint8Array) => buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF

/** Scanned pages recognized on the spot (a request, not a background job), at most this many. */
const MAX_OCR_PAGES = 60;

export async function pdfText(buf: Uint8Array): Promise<{ text: string; pages: number }> {
  if (buf.length > MAX_PDF_BYTES) throw new Error("PDF больше 30 МБ");
  const { getDocumentProxy, extractText } = await import("unpdf");
  let doc;
  try {
    doc = await getDocumentProxy(new Uint8Array(buf));
  } catch (e) {
    throw new Error(`Не удалось открыть PDF: ${e instanceof Error ? e.message : e}`);
  }
  const r = await extractText(doc, { mergePages: false });
  const raw = (r.text as string[]).map((t) => t.replace(/[ \t]+\n/g, "\n").trim());
  // Scanned pages (no text layer) are read by OCR, which needs no model.
  const { looksScanned, ocrPdfPage } = await import("./ocr");
  const scanned = raw.map((t, i) => (looksScanned(t) ? i : -1)).filter((i) => i >= 0);
  if (scanned.length > MAX_OCR_PAGES) {
    throw new Error(`В PDF ${scanned.length} страниц-сканов: здесь распознаются до ${MAX_OCR_PAGES}. Длинный скан загрузи в «Семестр» — там книга распознаётся в фоне целиком.`);
  }
  for (const i of scanned) raw[i] = await ocrPdfPage(doc, i + 1).catch(() => "");
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
