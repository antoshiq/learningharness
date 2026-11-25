"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { lintGutter, linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vscodeDark, vscodeLight } from "@uiw/codemirror-theme-vscode";
import { useEditorPrefs } from "@/lib/editor-prefs";
import { useDark } from "@/lib/theme";
import type { Language } from "@/lib/types";
import { cx } from "./ui";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), {
  ssr: false,
  loading: () => <div className="h-24 rounded-sm border border-border bg-surface" />,
});

/** The line an error points at, marked in the gutter and underlined, with the message on hover. */
function errorMarker(line: number, message: string) {
  return [
    linter(
      (view): Diagnostic[] => {
        if (line < 1 || line > view.state.doc.lines) return [];
        const l = view.state.doc.line(line);
        // Point at the code, not the indentation.
        const from = l.from + (l.text.length - l.text.trimStart().length);
        return [{ from, to: Math.max(from + 1, l.to), severity: "error", message }];
      },
      { delay: 0 },
    ),
    lintGutter(),
  ];
}

export function CodeEditor({
  value,
  onChange,
  language,
  sqlSchema,
  readOnly,
  minHeight = "120px",
  fill,
  errorLine,
  errorMessage,
  className,
}: {
  value: string;
  onChange?: (v: string) => void;
  language?: Language;
  /** Table -> column names map for SQL autocompletion (PostgreSQL). */
  sqlSchema?: Record<string, string[]>;
  readOnly?: boolean;
  minHeight?: string;
  /** Take the full height of the parent (sandbox), instead of growing with the text. */
  fill?: boolean;
  /** 1-based line to mark as the place of an error. */
  errorLine?: number | null;
  errorMessage?: string | null;
  className?: string;
}) {
  const dark = useDark();
  const [prefs] = useEditorPrefs();
  const extensions = useMemo(() => {
    const ext: Extension[] = [
      language === "python"
        ? python()
        : language === "javascript"
          ? javascript()
          : language === "sql"
            ? sql({ dialect: PostgreSQL, ...(sqlSchema ? { schema: sqlSchema } : {}) })
            : [],
    ];
    ext.push(EditorView.theme({ "&": { fontSize: `${prefs.fontSize}px` }, ".cm-content": { fontSize: `${prefs.fontSize}px` } }));
    if (prefs.wrap) ext.push(EditorView.lineWrapping);
    if (errorLine) ext.push(errorMarker(errorLine, errorMessage || "Ошибка в этой строке"));
    return ext;
  }, [language, sqlSchema, prefs.fontSize, prefs.wrap, errorLine, errorMessage]);

  return (
    <div className={cx("overflow-hidden rounded-sm border border-border focus-within:border-accent", fill && "h-full", className)}>
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={dark ? vscodeDark : vscodeLight}
        readOnly={readOnly}
        editable={!readOnly}
        height={fill ? "100%" : undefined}
        className={fill ? "h-full" : undefined}
        minHeight={readOnly || fill ? undefined : minHeight}
        maxHeight={fill ? undefined : "60dvh"}
        basicSetup={{
          lineNumbers: true,
          foldGutter: !readOnly,
          highlightActiveLine: !readOnly,
          highlightActiveLineGutter: !readOnly,
          autocompletion: !readOnly,
          closeBrackets: !readOnly,
          bracketMatching: true,
          highlightSelectionMatches: !readOnly,
          searchKeymap: true,
          tabSize: 4,
        }}
      />
    </div>
  );
}
