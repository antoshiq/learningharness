"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button, Dots, Icon, Notice } from "./ui";

const MAX_SIDE = 2000;
const MAX_PHOTOS = 4;

/**
 * A photo made smaller in the browser before it is sent: a phone picture of
 * 4000 px and 5 MB becomes about 2000 px and a few hundred KB, which is plenty
 * to read handwriting and spares the network and a modest server.
 */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(async () => {
    // Older browsers: through an <img>.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  });
  const w = "width" in bitmap ? bitmap.width : 0;
  const h = "height" in bitmap ? bitmap.height : 0;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}

/**
 * "Photo of the solution": the photo is read into text that lands in the
 * answer field, where the learner checks and fixes it before sending.
 */
export function PhotoButton({ context, onText, small = true }: { context?: string; onText: (text: string) => void; small?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "warn" | "bad" | "ok"; text: string } | null>(null);

  const read = async (files: FileList) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (!list.length) return;
    if (list.length > MAX_PHOTOS) {
      setNote({ tone: "bad", text: `Не больше ${MAX_PHOTOS} фото за раз.` });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const photos = await Promise.all(list.map(shrink));
      const r = await api<{ text: string; via: "model" | "ocr"; note: string | null }>("/api/transcribe", { body: { photos, context } });
      onText(r.text);
      setNote(r.note ? { tone: "warn", text: r.note } : { tone: "ok", text: "Текст с фото вставлен в ответ. Проверь его: модель могла ошибиться в символах." });
    } catch (e) {
      setNote({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  };

  return (
    <div className="space-y-2">
      <Button small={small} variant="ghost" disabled={busy} onClick={() => input.current?.click()} title="Сфотографируй решение на бумаге: текст появится в поле ответа">
        {busy ? (
          <>
            <Dots /> Читаю фото…
          </>
        ) : (
          <>
            <Icon name="upload" size={14} /> Фото решения
          </>
        )}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) read(e.target.files);
          e.target.value = "";
        }}
      />
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
    </div>
  );
}
