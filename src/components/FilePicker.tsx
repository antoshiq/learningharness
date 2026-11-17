"use client";

import { useRef, useState } from "react";
import { Button, cx, Icon } from "./ui";

/** A file read in the browser; PDFs travel as base64 and are read on the server. */
export interface PickedFile {
  name: string;
  content: string;
  base64?: boolean;
  size: number;
}

const MAX_TEXT = 300_000;
const MAX_PDF = 30 * 1024 * 1024;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const fileSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

/** Read files picked or dropped by the learner; returns what was read and what was skipped and why. */
export async function readFiles(list: FileList | File[]): Promise<{ files: PickedFile[]; skipped: string[] }> {
  const files: PickedFile[] = [];
  const skipped: string[] = [];
  for (const f of Array.from(list)) {
    if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") {
      if (f.size > MAX_PDF) skipped.push(`${f.name} (больше 30 МБ)`);
      else files.push({ name: f.name, content: toBase64(await f.arrayBuffer()), base64: true, size: f.size });
      continue;
    }
    if (f.size > MAX_TEXT) {
      skipped.push(`${f.name} (больше 300 КБ)`);
      continue;
    }
    const content = await f.text();
    if (content.includes("\u0000")) skipped.push(`${f.name} (не текст и не PDF)`);
    else files.push({ name: f.name, content, size: f.size });
  }
  return { files, skipped };
}

/** Drop zone with a "choose files" button and the list of chosen files. */
export function FilePicker({ files, onChange, hint }: { files: PickedFile[]; onChange: (files: PickedFile[]) => void; hint?: string }) {
  const [dragging, setDragging] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const add = async (list: FileList | File[]) => {
    const r = await readFiles(list);
    onChange([...files.filter((x) => !r.files.some((n) => n.name === x.name)), ...r.files]);
    setSkipped(r.skipped);
  };

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(e.dataTransfer.files);
        }}
        className={cx("flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-md border border-dashed px-3 py-3.5 text-center text-sm transition-colors", dragging ? "border-accent bg-accent-soft" : "border-border-strong")}
      >
        <Icon name="upload" size={18} className="text-muted" />
        <span className="text-muted">{hint ?? "Перетащи файлы сюда: конспекты, главы учебника, код, PDF"}</span>
        <Button small onClick={() => input.current?.click()}>
          Выбрать файлы
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((f) => (
            <li key={f.name} className="enter inline-flex max-w-full items-center gap-1 rounded-sm border border-border-strong bg-surface-2 py-0.5 pr-0.5 pl-2 text-xs">
              <Icon name="file" size={12} className="shrink-0 text-accent" />
              <span className="truncate font-mono">{f.name}</span>
              <span className="shrink-0 text-muted">{fileSize(f.size)}</span>
              <button onClick={() => onChange(files.filter((x) => x.name !== f.name))} aria-label={`Убрать ${f.name}`} className="grid size-5 shrink-0 place-items-center rounded-sm text-muted hover:text-bad">
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {skipped.length > 0 && <p className="text-xs text-warn">Пропущены: {skipped.join(", ")}</p>}
    </div>
  );
}
