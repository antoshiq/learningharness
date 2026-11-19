"use client";

import { isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { openInSandbox, sandboxLanguage } from "@/lib/sandbox";
import { Mermaid } from "./Mermaid";
import { Plot } from "./Plot";

/**
 * Models often write \( ... \) and \[ ... \]; the math plugin only knows
 * dollar delimiters. Convert outside of code spans and fenced blocks.
 */
export function normalizeMath(src: string): string {
  const parts = src.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  return parts
    .map((p, i) =>
      i % 2 === 1
        ? p
        : p
            .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m.trim()}$`),
    )
    .join("");
}

const textOf = (n: ReactNode): string =>
  typeof n === "string" ? n : Array.isArray(n) ? n.map(textOf).join("") : isValidElement<{ children?: ReactNode }>(n) ? textOf(n.props.children) : "";

/** Code blocks: Mermaid becomes a diagram, plot a function graph; Python and JavaScript get a "run in sandbox" button. */
function Pre({ children, ...rest }: React.HTMLAttributes<HTMLPreElement> & { node?: unknown }) {
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : null;
  const lang = /language-([\w-]+)/.exec(code?.props.className ?? "")?.[1];
  const source = code ? textOf(code.props.children).replace(/\n$/, "") : "";
  if (lang === "mermaid") return <Mermaid code={source} />;
  if (lang === "plot") return <Plot code={source} />;
  const run = sandboxLanguage(lang);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { node, ...attrs } = rest;
  return (
    <div className="group/code relative">
      <pre {...attrs}>{children}</pre>
      {run && source.trim() && (
        <button
          type="button"
          onClick={() => openInSandbox(run, source)}
          title="Открыть этот код в песочнице и запустить"
          className="absolute top-1.5 right-1.5 rounded-sm border border-border-strong bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted opacity-0 transition-opacity group-hover/code:opacity-100 hover:text-bright focus:opacity-100 max-sm:opacity-100"
        >
          ▶ В песочницу
        </button>
      )}
    </div>
  );
}

const BASE: Components = { pre: Pre };

function MarkdownImpl({ text, className, components }: { text: string; className?: string; components?: Components }) {
  return (
    <div className={`md ${className ?? ""}`}>
      <ReactMarkdown components={components ? { ...BASE, ...components } : BASE} remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}>
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
