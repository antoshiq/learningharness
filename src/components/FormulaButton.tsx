"use client";

import { useEffect, useRef, useState } from "react";
import type { MathfieldElement } from "mathlive";
import { Button, Notice, Sheet } from "./ui";

/** Ready-made pieces: #0 is where the selection goes, #? an empty slot. */
const TEMPLATES: [string, string, string][] = [
  ["a/b", "\\frac{#0}{#?}", "Дробь"],
  ["√", "\\sqrt{#0}", "Корень"],
  ["ⁿ√", "\\sqrt[#?]{#0}", "Корень степени n"],
  ["xⁿ", "#0^{#?}", "Степень"],
  ["xₙ", "#0_{#?}", "Индекс"],
  ["|x|", "\\left|#0\\right|", "Модуль"],
  ["∫", "\\int_{#?}^{#?}#0\\,dx", "Интеграл"],
  ["Σ", "\\sum_{#?}^{#?}#0", "Сумма"],
  ["lim", "\\lim_{#?\\to#?}#0", "Предел"],
  ["d/dx", "\\frac{d}{dx}#0", "Производная"],
  ["∂", "\\frac{\\partial #0}{\\partial #?}", "Частная производная"],
  ["→v", "\\vec{#0}", "Вектор"],
  ["( )", "\\left(#0\\right)", "Скобки"],
  ["∞", "\\infty", "Бесконечность"],
  ["≤", "\\le", "Меньше или равно"],
  ["≥", "\\ge", "Больше или равно"],
  ["≠", "\\ne", "Не равно"],
  ["≈", "\\approx", "Приближённо"],
  ["→", "\\to", "Стремится"],
  ["⇒", "\\Rightarrow", "Следует"],
  ["∈", "\\in", "Принадлежит"],
  ["π", "\\pi", "Пи"],
  ["α", "\\alpha", "Альфа"],
  ["ε", "\\varepsilon", "Эпсилон"],
  ["δ", "\\delta", "Дельта"],
];

/**
 * "Формула": a visual formula editor (MathLive) in a sheet. The finished formula
 * goes into the answer as $…$ (or $$…$$ on its own line), where the text cursor was.
 */
export function FormulaButton({ onInsert }: { onInsert: (snippet: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button small variant="ghost" onClick={() => setOpen(true)} title="Набрать формулу в визуальном редакторе">
        <span className="font-serif italic">ƒ</span> Формула
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Формула">
        {open && (
          <FormulaEditor
            onDone={(s) => {
              setOpen(false);
              if (s) onInsert(s);
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function FormulaEditor({ onDone }: { onDone: (snippet: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<MathfieldElement | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [display, setDisplay] = useState(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { MathfieldElement } = await import("mathlive");
        if (!alive || !box.current) return;
        // The KaTeX fonts come with the app's own styles; no sounds.
        MathfieldElement.fontsDirectory = null;
        MathfieldElement.soundsDirectory = null;
        MathfieldElement.locale = "ru";
        const mf = new MathfieldElement();
        mf.smartFence = true;
        mf.mathVirtualKeyboardPolicy = "auto";
        mf.style.width = "100%";
        mf.style.fontSize = "22px";
        mf.style.padding = "8px";
        mf.style.borderRadius = "6px";
        mf.style.border = "1px solid var(--border-strong)";
        mf.style.background = "var(--input)";
        mf.style.color = "var(--bright)";
        mf.addEventListener("input", () => setEmpty(!mf.value.trim()));
        mf.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            finish();
          }
        });
        box.current.replaceChildren(mf);
        field.current = mf;
        mf.focus();
      } catch (e) {
        setFailed(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const put = (latex: string) => {
    const mf = field.current;
    if (!mf) return;
    mf.executeCommand(["insert", latex, { selectionMode: "placeholder", format: "latex" }]);
    mf.focus();
    setEmpty(!mf.value.trim());
  };

  function finish() {
    const latex = field.current?.getValue("latex-expanded").trim() ?? "";
    onDone(latex ? (display ? `\n$$\n${latex}\n$$\n` : `$${latex}$`) : null);
  }

  if (failed) return <Notice tone="bad">Редактор формул не загрузился: {failed}. Формулу можно написать прямо в ответе в виде $...$.</Notice>;

  return (
    <div className="space-y-3">
      <div ref={box} className="min-h-14" />
      <div className="flex flex-wrap gap-1">
        {TEMPLATES.map(([label, latex, title]) => (
          <button
            key={label}
            type="button"
            title={title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => put(latex)}
            className="min-w-9 rounded-sm border border-border bg-surface-2 px-2 py-1 font-serif text-sm text-bright hover:border-border-strong"
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">
        Можно печатать как текст: <code>sqrt</code>, <code>int</code>, <code>sum</code>, <code>lim</code>, <code>alpha</code>, <code>/</code> — дробь, <code>^</code> — степень,{" "}
        <code>_</code> — индекс, Tab — к следующему полю. На телефоне открывается математическая клавиатура.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={display} onChange={(e) => setDisplay(e.target.checked)} />
        Отдельной строкой
      </label>
      <div className="flex gap-2">
        <Button variant="primary" disabled={empty} onClick={finish}>
          Вставить в ответ
        </Button>
        <Button variant="ghost" onClick={() => onDone(null)}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

/** Put `snippet` into `value` at the textarea's cursor (or at the end). */
export function insertAtCursor(el: HTMLTextAreaElement | null, value: string, snippet: string): { value: string; caret: number } {
  // The textarea keeps its selection while the formula sheet is open.
  const at = Math.min(el?.selectionStart ?? value.length, value.length);
  const end = Math.min(el?.selectionEnd ?? at, value.length);
  const before = value.slice(0, at);
  const pad = before && !/\s$/.test(before) && !snippet.startsWith("\n") ? " " : "";
  const next = before + pad + snippet + value.slice(end);
  return { value: next, caret: (before + pad + snippet).length };
}
