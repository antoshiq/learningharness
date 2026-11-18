// Text from pictures without any model: scanned book pages and photos.
//
// Tesseract runs as WebAssembly (tesseract.js), so it needs no native build,
// no GPU and no internet: the Russian and English data ship with the app
// (the small "best_int" LSTM models). On a modest server one worker is used
// and closed after a minute of idleness, so it holds no memory between jobs.
// Scanned PDF pages are taken as the images they are made of (no canvas
// rendering), turned grey and scaled to the size Tesseract reads best.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { DATA_DIR, ROOT } from "./paths";

type Worker = import("tesseract.js").Worker;

const IDLE_MS = 60_000;
/** Pixels on the longer side Tesseract gets: about 300 dpi for a book page. */
const TARGET_MAX = 2600;
const MIN_MAX = 1400;

// ---------------------------------------------------------------------------
// Pixels
// ---------------------------------------------------------------------------

export interface RawImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  /** 1 (grey), 3 (RGB) or 4 (RGBA) */
  channels: number;
}

/** Grey pixels, scaled so the longer side lands between MIN_MAX and TARGET_MAX. */
export function toGray(img: RawImage): { gray: Uint8Array; width: number; height: number } {
  const { width: w, height: h, channels: ch, data } = img;
  const longer = Math.max(w, h);
  const scale = longer > TARGET_MAX ? TARGET_MAX / longer : longer < MIN_MAX ? Math.min(3, MIN_MAX / longer) : 1;
  const W = Math.max(1, Math.round(w * scale));
  const H = Math.max(1, Math.round(h * scale));
  const lum = (i: number) => {
    const o = i * ch;
    if (ch < 3) return data[o];
    const v = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    // Transparent pixels are paper.
    return ch === 4 ? 255 - ((255 - v) * data[o + 3]) / 255 : v;
  };
  const gray = new Uint8Array(W * H);
  if (scale === 1) {
    for (let i = 0; i < W * H; i++) gray[i] = lum(i);
  } else if (scale < 1) {
    // Box average: every source pixel counts, thin strokes survive.
    for (let y = 0; y < H; y++) {
      const y0 = Math.floor(y / scale);
      const y1 = Math.max(y0 + 1, Math.min(h, Math.floor((y + 1) / scale)));
      for (let x = 0; x < W; x++) {
        const x0 = Math.floor(x / scale);
        const x1 = Math.max(x0 + 1, Math.min(w, Math.floor((x + 1) / scale)));
        let sum = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += lum(yy * w + xx);
        gray[y * W + x] = sum / ((y1 - y0) * (x1 - x0));
      }
    }
  } else {
    // Bilinear enlargement of a small image.
    for (let y = 0; y < H; y++) {
      const fy = Math.min(h - 1, y / scale);
      const y0 = Math.floor(fy);
      const y1 = Math.min(h - 1, y0 + 1);
      const ty = fy - y0;
      for (let x = 0; x < W; x++) {
        const fx = Math.min(w - 1, x / scale);
        const x0 = Math.floor(fx);
        const x1 = Math.min(w - 1, x0 + 1);
        const tx = fx - x0;
        const top = lum(y0 * w + x0) * (1 - tx) + lum(y0 * w + x1) * tx;
        const bottom = lum(y1 * w + x0) * (1 - tx) + lum(y1 * w + x1) * tx;
        gray[y * W + x] = top * (1 - ty) + bottom * ty;
      }
    }
  }
  return { gray, width: W, height: H };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** An 8-bit greyscale PNG, written with zlib only. */
export function encodeGrayPng(gray: Uint8Array, width: number, height: number): Buffer {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // no filter
    raw.set(gray.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", new Uint8Array())]);
}

// ---------------------------------------------------------------------------
// Tesseract
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { __tutorOcr?: { worker: Promise<Worker> | null; timer: NodeJS.Timeout | null; queue: Promise<unknown> } };
const state = (g.__tutorOcr ??= { worker: null, timer: null, queue: Promise.resolve() });

const LANGS = ["rus", "eng"] as const;

/**
 * One folder with the language models shipped in their packages (best_int:
 * the small, fast LSTM ones, gzip). Tesseract reads them from disk: nothing
 * is downloaded, so it works offline.
 */
function langDir(): string {
  const dir = path.join(DATA_DIR, "ocr-lang");
  for (const code of LANGS) {
    const target = path.join(dir, `${code}.traineddata.gz`);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(dir, { recursive: true });
    // From the project's node_modules: the bundler rewrites require.resolve paths on the server.
    const src = path.join(ROOT, "node_modules", "@tesseract.js-data", code, "4.0.0_best_int", `${code}.traineddata.gz`);
    if (!fs.existsSync(src)) throw new Error(`Нет данных распознавания (${code}). Переустанови зависимости: install.cmd.`);
    fs.copyFileSync(src, target);
  }
  return dir;
}

async function worker(): Promise<Worker> {
  if (!state.worker) {
    state.worker = (async () => {
      const { createWorker, OEM, PSM } = await import("tesseract.js");
      const w = await createWorker([...LANGS], OEM.LSTM_ONLY, { langPath: langDir(), gzip: true, cacheMethod: "none" });
      await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: "1" });
      return w;
    })();
    state.worker.catch(() => {
      state.worker = null;
    });
  }
  return state.worker;
}

function scheduleIdleClose() {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(async () => {
    const w = state.worker;
    state.worker = null;
    state.timer = null;
    try {
      await (await w)?.terminate();
    } catch {}
  }, IDLE_MS);
  state.timer.unref?.();
}

/** OCR text cleaned for reading: hyphenated line breaks joined, stray spaces removed. */
export function cleanOcr(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/([а-яёa-z])-\n([а-яёa-z])/gi, "$1$2")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Recognize the text of one picture (PNG/JPEG file contents or raw pixels). One page at a time. */
export function ocrImage(img: Buffer | RawImage): Promise<string> {
  const run = state.queue.then(async () => {
    const png = Buffer.isBuffer(img) ? img : (() => {
      const gimg = toGray(img);
      return encodeGrayPng(gimg.gray, gimg.width, gimg.height);
    })();
    const w = await worker();
    try {
      const r = await w.recognize(png);
      return cleanOcr(r.data.text ?? "");
    } finally {
      scheduleIdleClose();
    }
  });
  state.queue = run.catch(() => {});
  return run;
}

/** Text of a scanned PDF page: the page's pictures, read top to bottom. */
type PdfDoc = Awaited<ReturnType<typeof import("unpdf").getDocumentProxy>>;

export async function ocrPdfPage(doc: PdfDoc, pageNumber: number): Promise<string> {
  const { extractImages } = await import("unpdf");
  const images = (await extractImages(doc, pageNumber)).filter((i) => i.width >= 200 && i.height >= 100);
  const parts: string[] = [];
  for (const im of images) parts.push(await ocrImage({ data: im.data, width: im.width, height: im.height, channels: im.channels }));
  return parts.filter(Boolean).join("\n\n");
}

/** A page counts as scanned when its text layer has almost nothing on it. */
export const looksScanned = (text: string) => text.replace(/\s/g, "").length < 25;
