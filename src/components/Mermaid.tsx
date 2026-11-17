"use client";

import { useEffect, useId, useState } from "react";
import { useDark } from "@/lib/theme";

/**
 * A Mermaid diagram from a ```mermaid block. While the text is still being
 * written (or if it is invalid) the source is shown instead, so nothing jumps.
 */
export function Mermaid({ code }: { code: string }) {
  const dark = useDark();
  const id = "mm" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    // Streaming text changes many times a second; render once it settles.
    const t = setTimeout(async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "default",
          fontFamily: "Segoe UI, system-ui, sans-serif",
          flowchart: { htmlLabels: false },
        });
        await mermaid.parse(code);
        const r = await mermaid.render(`${id}-${Date.now()}`, code);
        if (alive) {
          setSvg(r.svg);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [code, dark, id]);

  if (svg && !failed) {
    return <div className="mermaid-diagram appear my-3 overflow-x-auto rounded-md border border-border bg-surface p-3" role="img" aria-label="Схема" dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  return (
    <pre className="relative">
      <code>{code}</code>
      {failed && <span className="absolute top-1 right-2 text-[11px] text-muted">схема не распознана</span>}
    </pre>
  );
}
