// Photos of handwritten (or printed) solutions turned into text the learner
// checks and fixes before it is graded. The model that runs the lessons reads
// the photo when it can see pictures (Claude, GPT and Gemini all can); when it
// cannot, or the call fails, the photo is read by the local OCR instead, which
// handles neat print well and handwriting poorly — the learner is told so.
import { chatAs } from "./llm";
import { isText, LlmError, type ImageBlock } from "./llm/types";
import { ocrImage } from "./ocr";

export const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

export const TRANSCRIBE_SYSTEM = `Ты переписываешь решение ученика с фотографии в текст. Это нужно, чтобы потом проверить решение, поэтому точность важнее всего.
- Перепиши ровно то, что написано: те же шаги, в том же порядке, каждый шаг с новой строки. Ничего не исправляй, не дописывай и не решай за ученика — даже если видишь ошибку.
- Формулы — в LaTeX: $...$ в строке, $$...$$ отдельной строкой. Дроби, степени, индексы, корни, интегралы, матрицы — как в оригинале.
- Код — в блоке \`\`\` с языком. Рисунки и графики опиши одной строкой в квадратных скобках: [график параболы с вершиной в (0, −4)].
- Неразборчивое место отметь как [неразборчиво], не угадывай.
- Если фото несколько, это страницы одного решения по порядку.
Ответ — только сам текст решения, без вступлений и комментариев.`;

const CANNOT_SEE = /не (вижу|могу (увидеть|просмотреть|прочитать|открыть)) (изображени|фото|картин)|нет (изображени|фото|картин)|cannot (see|view|read) (the )?(image|photo|picture)|no image (was )?(provided|attached)|unable to (see|view) (the )?image/i;

/** The kind of picture by its first bytes; null for anything else. */
export function photoType(buf: Buffer): ImageBlock["source"]["media_type"] | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export interface Transcription {
  text: string;
  /** model: read by the lesson model; ocr: by local text recognition. */
  via: "model" | "ocr";
  /** Why OCR was used, for the learner. */
  note: string | null;
}

/** Turn photos into text. `context` is the task, which helps to read unclear symbols. */
export async function transcribePhotos(photos: Buffer[], context = "", opts: { forceOcr?: boolean } = {}): Promise<Transcription> {
  if (!photos.length) throw new Error("Нет фотографий");
  if (photos.length > MAX_PHOTOS) throw new Error(`Не больше ${MAX_PHOTOS} фото за раз`);
  const images: ImageBlock[] = photos.map((buf, i) => {
    if (buf.length > MAX_PHOTO_BYTES) throw new Error(`Фото ${i + 1} больше 6 МБ`);
    const type = photoType(buf);
    if (!type) throw new Error(`Фото ${i + 1}: нужен JPEG, PNG или WebP`);
    return { type: "image", source: { type: "base64", media_type: type, data: buf.toString("base64") } };
  });

  let reason: string | null = null;
  if (!opts.forceOcr) {
    try {
      const r = await chatAs("strong", "photo", null, {
        system: TRANSCRIBE_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              ...images,
              { type: "text", text: `${context ? `Задача, которую решал ученик (для понимания обозначений, не решай её):\n${context.slice(0, 2000)}\n\n` : ""}Перепиши решение с ${images.length > 1 ? "этих фото" : "этого фото"}.` },
            ],
          },
        ],
        maxTokens: 6000,
      });
      const text = r.content.filter(isText).map((b) => b.text).join("").trim();
      if (text && !CANNOT_SEE.test(text.slice(0, 300))) return { text, via: "model", note: null };
      reason = "Основная модель не умеет читать фотографии.";
    } catch (e) {
      reason = e instanceof LlmError ? `Модель не прочитала фото (${e.message}).` : `Модель не прочитала фото.`;
    }
  }

  const parts: string[] = [];
  for (const p of photos) parts.push(await ocrImage(p));
  const text = parts.filter(Boolean).join("\n\n");
  if (!text) throw new Error(`${reason ?? ""} Локальное распознавание тоже ничего не нашло: сфотографируй крупнее и при хорошем свете.`.trim());
  return {
    text,
    via: "ocr",
    note: `${reason ? `${reason} ` : ""}Текст распознан на сервере без модели: печатное он читает хорошо, рукопись и формулы — плохо. Проверь и поправь, особенно формулы. Для рукописных решений выбери в «Настройках» модель, которая видит изображения (Claude, GPT, Gemini).`,
  };
}
