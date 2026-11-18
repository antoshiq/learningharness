// Photos of solutions: read by the model, or by local OCR when the model cannot see.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-vision-"));
process.env.TUTOR_DATA_DIR = dir;
process.env.TUTOR_SECRETS_FILE = path.join(dir, "secrets.json");
process.env.TUTOR_MOCK = "1";

let vision: typeof import("@/server/vision");
let ocr: typeof import("@/server/ocr");

beforeAll(async () => {
  vision = await import("@/server/vision");
  ocr = await import("@/server/ocr");
});

/** A "photo" of printed text: the scanned fixture's second page as PNG. */
async function printedPhoto(): Promise<Buffer> {
  const { getDocumentProxy, extractImages } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", "scan.pdf"))));
  const [img] = await extractImages(doc, 2);
  const g = ocr.toGray({ data: img.data, width: img.width, height: img.height, channels: img.channels });
  return ocr.encodeGrayPng(g.gray, g.width, g.height);
}

describe("photos", () => {
  it("knows JPEG, PNG and WebP by their bytes", () => {
    expect(vision.photoType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(vision.photoType(ocr.encodeGrayPng(new Uint8Array([1]), 1, 1))).toBe("image/png");
    expect(vision.photoType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))).toBe("image/webp");
    expect(vision.photoType(Buffer.from("GIF89a"))).toBeNull();
  });

  it("are read by the model when it can see", async () => {
    const r = await vision.transcribePhotos([await printedPhoto()], "Реши уравнение");
    expect(r).toMatchObject({ via: "model", note: null });
    expect(r.text).toContain("x^2 - 4 = 0");
  });

  it("fall back to local OCR when the model cannot see pictures", { timeout: 60_000 }, async () => {
    const r = await vision.transcribePhotos([await printedPhoto()], "(слепая модель)");
    expect(r.via).toBe("ocr");
    expect(r.note).toMatch(/не умеет читать фотографии/);
    expect(r.text).toMatch(/Производной функции/);
  });

  it("refuse what is not a picture and too many photos", async () => {
    await expect(vision.transcribePhotos([Buffer.from("hello")])).rejects.toThrow(/JPEG, PNG или WebP/);
    const one = ocr.encodeGrayPng(new Uint8Array([1]), 1, 1);
    await expect(vision.transcribePhotos([one, one, one, one, one])).rejects.toThrow(/Не больше 4/);
  });
});

describe("pictures in connections", () => {
  const img = { type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data: "iVBORw0KGgo=" } };

  it("go to OpenAI-compatible APIs as data URLs before the text", async () => {
    const { toOpenAiMessages } = await import("@/server/llm/openai");
    const out = toOpenAiMessages("sys", [{ role: "user", content: [img, { type: "text", text: "Перепиши" }] }]);
    expect(out[1]).toEqual({
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
        { type: "text", text: "Перепиши" },
      ],
    });
  });

  it("are written as files for the command-line programs and removed after", async () => {
    const { imageFiles } = await import("@/server/llm/cli");
    const r = imageFiles({ model: "m", system: "", messages: [{ role: "user", content: [img, img] }] }, "test-images");
    expect(r.files).toHaveLength(2);
    expect(r.files.every((f) => f.endsWith(".png") && fs.existsSync(f))).toBe(true);
    r.remove();
    expect(r.files.some((f) => fs.existsSync(f))).toBe(false);
  });
});
