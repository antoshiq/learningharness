// OCR without a model: scanned PDF pages and pictures, read by Tesseract (WebAssembly).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";

process.env.TUTOR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-ocr-"));
let cleanOcr: typeof import("@/server/ocr").cleanOcr;
let encodeGrayPng: typeof import("@/server/ocr").encodeGrayPng;
let looksScanned: typeof import("@/server/ocr").looksScanned;
let ocrPdfPage: typeof import("@/server/ocr").ocrPdfPage;
let toGray: typeof import("@/server/ocr").toGray;

beforeAll(async () => {
  ({ cleanOcr, encodeGrayPng, looksScanned, ocrPdfPage, toGray } = await import("@/server/ocr"));
});

describe("pixels", () => {
  it("encodes a valid greyscale PNG", () => {
    const gray = new Uint8Array([0, 128, 255, 64, 32, 16]);
    const png = encodeGrayPng(gray, 3, 2);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    const idat = png.indexOf("IDAT");
    const len = png.readUInt32BE(idat - 4);
    expect([...zlib.inflateSync(png.subarray(idat + 4, idat + 4 + len))]).toEqual([0, 0, 128, 255, 0, 64, 32, 16]);
  });

  it("turns RGBA grey, scales big pictures down and small ones up", () => {
    const rgba = new Uint8Array(4 * 4000 * 10).fill(255);
    rgba[0] = rgba[1] = rgba[2] = 0;
    const big = toGray({ data: rgba, width: 4000, height: 10, channels: 4 });
    expect(big.width).toBe(2600);
    const small = toGray({ data: new Uint8Array(500 * 300).fill(200), width: 500, height: 300, channels: 1 });
    expect(small.width).toBe(1400);
    expect(small.gray[0]).toBe(200);
  });

  it("cleans OCR text", () => {
    expect(cleanOcr("приме-\nнение   формулы \n\n\n\nдалее")).toBe("применение формулы\n\nдалее");
    expect(looksScanned("  \n 12 ")).toBe(true);
    expect(looksScanned("Глава 1. Множества и операции над ними")).toBe(false);
  });
});

describe("scanned PDF", () => {
  it("reads Russian text from page pictures", { timeout: 120_000 }, async () => {
    const { getDocumentProxy, extractText } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", "scan.pdf"))));
    const layer = (await extractText(doc, { mergePages: false })).text as string[];
    expect(layer.every(looksScanned)).toBe(true);
    const text = await ocrPdfPage(doc, 2);
    expect(text).toMatch(/Глава 2\. Пределы/);
    expect(text).toMatch(/последовательности/);
    expect(text).toMatch(/Производной функции/);
  });
});
