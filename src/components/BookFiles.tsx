"use client";

import { useRef, useState } from "react";
import { ROLES } from "@/lib/semester";
import type { BookRole } from "@/server/db/schema";
import { fileSize } from "./FilePicker";
import { Button, cx, fieldClass, Icon } from "./ui";

export interface BookFile {
  file: File;
  role: BookRole;
}

const MAX = 100 * 1024 * 1024;

/** A role guessed from the file name; the first file without a clue is the main textbook. */
export function guessRole(name: string, hasMain: boolean): BookRole {
  if (/задач|упражн|problem|exercise|практикум/i.test(name)) return "problems";
  if (/лекци|конспект|lecture|notes|слайд|slides/i.test(name)) return "lectures";
  return hasMain ? "extra" : "main";
}

/** Upload one book to a semester as the raw body. */
export async function uploadBook(semesterId: number, f: BookFile): Promise<void> {
  const res = await fetch(`/api/semesters/${semesterId}/books?name=${encodeURIComponent(f.file.name)}&role=${f.role}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: f.file,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Ошибка ${res.status}`);
  }
}

/** Books for a semester: big files are fine (up to 100 MB), each with its role. */
export function BookFiles({ files, onChange }: { files: BookFile[]; onChange: (f: BookFile[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const add = (list: FileList | File[]) => {
    const next = [...files];
    const skip: string[] = [];
    for (const f of Array.from(list)) {
      if (f.size > MAX) skip.push(`${f.name} (больше 100 МБ)`);
      else if (!next.some((x) => x.file.name === f.name)) next.push({ file: f, role: guessRole(f.name, next.some((x) => x.role === "main")) });
    }
    onChange(next);
    setSkipped(skip);
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
        <span className="text-muted">Учебники, задачники, конспекты лекций: PDF с текстом, .md или .txt, до 100 МБ</span>
        <Button small onClick={() => input.current?.click()}>
          Выбрать файлы
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept=".pdf,.md,.txt,.markdown,.tex,application/pdf,text/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {files.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {files.map((f, i) => (
            <li key={f.file.name} className="enter flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-sm">
              <Icon name="book" className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{f.file.name}</span>
              <span className="shrink-0 text-xs text-muted">{fileSize(f.file.size)}</span>
              <select
                className={cx(fieldClass, "py-1 text-[13px] sm:py-0.5")}
                value={f.role}
                aria-label={`Роль файла ${f.file.name}`}
                onChange={(e) => onChange(files.map((x, k) => (k === i ? { ...x, role: e.target.value as BookRole } : x)))}
              >
                {(Object.keys(ROLES) as BookRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLES[r]}
                  </option>
                ))}
              </select>
              <button onClick={() => onChange(files.filter((_, k) => k !== i))} aria-label={`Убрать ${f.file.name}`} className="grid size-7 shrink-0 place-items-center rounded-sm text-muted hover:text-bad">
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {skipped.length > 0 && <p className="text-xs text-warn">Пропущены: {skipped.join(", ")}</p>}
    </div>
  );
}
