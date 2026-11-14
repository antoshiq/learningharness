"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import type { Language } from "@/lib/types";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), {
  ssr: false,
  loading: () => <div className="h-24 rounded-lg border border-border bg-code" />,
});

function useDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return dark;
}

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly,
  minHeight = "120px",
}: {
  value: string;
  onChange?: (v: string) => void;
  language?: Language;
  readOnly?: boolean;
  minHeight?: string;
}) {
  const dark = useDark();
  const extensions = useMemo(() => (language === "python" ? [python()] : language === "javascript" ? [javascript()] : []), [language]);
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={dark ? "dark" : "light"}
        readOnly={readOnly}
        editable={!readOnly}
        minHeight={readOnly ? undefined : minHeight}
        maxHeight="60dvh"
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: !readOnly,
          highlightActiveLineGutter: !readOnly,
          autocompletion: false,
          tabSize: 4,
        }}
      />
    </div>
  );
}
