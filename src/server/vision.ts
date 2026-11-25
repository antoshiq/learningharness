// Photos of handwritten (or printed) solutions turned into text the learner
// checks and fixes before it is graded. The model that runs the lessons reads
// the photo when it can see pictures (Claude, GPT and Gemini all can); when it
// cannot, or the call fails, the photo is read by the local OCR instead, which
// handles neat print well and handwriting poorly — the learner is told so.
import { mockEnabled } from "./config";
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

const DOC_SCAN_SYSTEM = `Ты переводишь страницы учебных материалов (методичек, конспектов, слайдов, фото доски) в аккуратный Markdown для последующего обучения.
- Передай весь текст точно, сохраняя заголовки, нумерацию, списки и определения.
- Все формулы записывай в LaTeX: $...$ в строке, $$...$$ отдельной строкой.
- Таблицы оформляй как Markdown-таблицы (| ... | ... |).
- Код оформляй в блоках \`\`\` с указанием языка.
- Схемы, диаграммы (ER, блок-схемы, графы, UML, электрические схемы) и графики опиши структурно и точно: все узлы, подписи, стрелки/связи, оси и ключевые значения (если удобно — в виде краткого списка или Mermaid).
- Без вступлений и мета-комментариев: только содержание.`;

const DOC_FIGURE_SYSTEM = `Ты расшифровываешь иллюстрации, схемы, диаграммы, графики, формулы и таблицы-картинки из учебного документа (методички, презентации, лабы), чтобы репетитор мог полноценно опираться на них в уроке.
- Если на картинке таблица — перепиши её целиком как Markdown-таблицу.
- Если формулы или выкладки — перепиши в LaTeX ($...$ / $$...$$).
- Если схема, ER-диаграмма, блок-схема, граф, архитектура или график — опиши все элементы, подписи, связи/стрелки, кардинальности, оси и ключевые точки.
- Если фрагмент кода или скриншот консоли — перепиши точно в блок \`\`\`.
- Если изображение чисто декоративное (логотип вуза, рамка, фоновый узор без учебной информации) — напиши ровно: [декоративное изображение].
- Пиши по-русски, кратко и точно, без лишней воды.`;

const DECORATIVE_RE = /\[декоративное изображение\]/i;

/**
 * Ask the configured vision-capable lesson model to transcribe scanned pages or
 * describe embedded figures/diagrams/tables. Returns a map `label -> text`.
 * Silently returns an empty map in mock mode or when the model cannot read images.
 */
export async function describeDocumentImages(
  items: { label: string; buffer: Buffer }[],
  mode: "scan" | "figure",
  opts: { allowMock?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!items.length || (!opts.allowMock && mockEnabled())) return out;

  const valid: { label: string; image: ImageBlock }[] = [];
  for (const it of items) {
    if (it.buffer.length > MAX_PHOTO_BYTES) continue;
    const type = photoType(it.buffer);
    if (!type) continue;
    valid.push({ label: it.label, image: { type: "image", source: { type: "base64", media_type: type, data: it.buffer.toString("base64") } } });
  }
  if (!valid.length) return out;

  const system = mode === "scan" ? DOC_SCAN_SYSTEM : DOC_FIGURE_SYSTEM;
  for (let i = 0; i < valid.length; i += MAX_PHOTOS) {
    const batch = valid.slice(i, i + MAX_PHOTOS);
    opts.onProgress?.(i, valid.length);
    const instruction =
      batch.length === 1
        ? mode === "scan"
          ? "Расшифруй эту страницу учебного материала полностью (текст, формулы в LaTeX, таблицы, схемы)."
          : "Расшифруй эту иллюстрацию/схему/таблицу из учебного документа."
        : `Даны ${batch.length} изображений по порядку. Для каждого выведи заголовок вида === IMG <номер> === (от 1 до ${batch.length}) и под ним расшифровку соответствующего изображения.`;

    try {
      const r = await chatAs("strong", "document-vision", null, {
        system,
        messages: [{ role: "user", content: [...batch.map((b) => b.image), { type: "text", text: instruction }] }],
        maxTokens: 8000,
      });
      const text = r.content.filter(isText).map((b) => b.text).join("").trim();
      if (!text || CANNOT_SEE.test(text.slice(0, 300))) continue;

      if (batch.length === 1) {
        if (!DECORATIVE_RE.test(text)) out.set(batch[0].label, text);
        continue;
      }

      const re = /===\s*IMG\s+(\d+)\s*===/gi;
      const matches = [...text.matchAll(re)];
      if (!matches.length) {
        if (!DECORATIVE_RE.test(text)) out.set(batch[0].label, text);
        continue;
      }
      for (let m = 0; m < matches.length; m++) {
        const idx = Number(matches[m][1]) - 1;
        if (idx < 0 || idx >= batch.length) continue;
        const start = (matches[m].index ?? 0) + matches[m][0].length;
        const end = m + 1 < matches.length ? (matches[m + 1].index ?? text.length) : text.length;
        const body = text.slice(start, end).trim();
        if (body && !DECORATIVE_RE.test(body)) out.set(batch[idx].label, body);
      }
    } catch {
      // Fall back gracefully: caller uses OCR for scans or keeps the text layer as-is.
    }
    opts.onProgress?.(Math.min(i + batch.length, valid.length), valid.length);
  }
  return out;
}
