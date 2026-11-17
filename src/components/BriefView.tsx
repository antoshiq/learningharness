"use client";

import { Children, createContext, isValidElement, useContext, useMemo, useState, type ReactNode } from "react";
import type { Components, ExtraProps } from "react-markdown";
import { thesisKey } from "@/lib/brief";
import { streamPost } from "@/lib/api";
import { Markdown } from "./Markdown";
import { cx, Dots, Icon } from "./ui";

interface Thesis {
  open: boolean;
  text: string;
  loading: boolean;
  error: string | null;
}

interface Ctx {
  get: (key: string) => Thesis | undefined;
  toggle: (key: string) => void;
}
const ThesisContext = createContext<Ctx | null>(null);

type HastNode = { type: string; value?: string; tagName?: string; children?: HastNode[] };

/** Visible text of a list item, without its nested lists. */
function ownText(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  if (node.tagName === "ul" || node.tagName === "ol") return "";
  return (node.children ?? []).map(ownText).join("");
}

/** A list item of the overview: click to open the thesis in more depth, right where it is. */
function ThesisItem({ node, children, ...rest }: React.LiHTMLAttributes<HTMLLIElement> & ExtraProps) {
  const ctx = useContext(ThesisContext);
  const key = thesisKey(ownText(node as HastNode));
  if (!ctx || key.length < 3) return <li {...rest}>{children}</li>;
  // Nested lists go below the explanation, so it stays next to its own thesis.
  const own: ReactNode[] = [];
  const nested: ReactNode[] = [];
  Children.forEach(children, (c) => (isValidElement(c) && (c.type === "ul" || c.type === "ol") ? nested : own).push(c));
  const t = ctx.get(key);
  return (
    <li {...rest}>
      <span className="group/thesis">
        {own}
        <button
          type="button"
          onClick={() => ctx.toggle(key)}
          aria-expanded={!!t?.open}
          title={t?.open ? "Свернуть" : "Подробнее об этом пункте"}
          className={cx(
            "ml-1.5 inline-flex translate-y-[2px] items-center gap-0.5 rounded-sm px-1 align-baseline text-xs leading-5 transition-colors",
            t?.open ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-accent sm:opacity-60 sm:group-hover/thesis:opacity-100",
          )}
        >
          <Icon name="chevron" size={12} className={cx("transition-transform duration-150", t?.open && "rotate-90")} />
          {t?.open ? "свернуть" : "подробнее"}
        </button>
      </span>
      {t?.open && (
        <div className="appear my-2 rounded-sm border-l-2 border-accent bg-surface px-3 py-2 text-[14px]">
          {t.error ? (
            <span className="text-bad">{t.error}</span>
          ) : t.text ? (
            <Markdown text={t.text} className={t.loading ? "streaming" : undefined} />
          ) : (
            <span className="flex items-center gap-2 text-muted">
              <Dots /> Раскрываю…
            </span>
          )}
        </div>
      )}
      {nested}
    </li>
  );
}

const COMPONENTS: Components = { li: ThesisItem };

/**
 * The overview text with expandable theses. Explanations already written are
 * shown from `expansions` without a new model call.
 */
export function BriefView({ id, text, expansions, className }: { id: number; text: string; expansions: Record<string, string>; className?: string }) {
  const [theses, setTheses] = useState<Record<string, Thesis>>({});

  const ctx = useMemo<Ctx>(() => {
    const load = async (key: string) => {
      const patch = (p: Partial<Thesis>) => setTheses((s) => ({ ...s, [key]: { ...s[key], ...p } }));
      try {
        await streamPost(`/api/briefs/${id}/expand`, { thesis: key }, (e) => {
          if (e.type === "text") setTheses((s) => ({ ...s, [key]: { ...s[key], text: s[key].text + e.delta } }));
          if (e.type === "error") patch({ error: e.message });
        });
      } catch (e) {
        patch({ error: e instanceof Error ? e.message : String(e) });
      }
      patch({ loading: false });
    };
    return {
      get: (key) => theses[key],
      toggle: (key) => {
        const cur = theses[key];
        if (cur) {
          setTheses((s) => ({ ...s, [key]: { ...cur, open: !cur.open } }));
          // A failed try is retried when the thesis is opened again.
          if (!cur.open && cur.error) {
            setTheses((s) => ({ ...s, [key]: { open: true, text: "", loading: true, error: null } }));
            load(key);
          }
          return;
        }
        const saved = expansions[key];
        setTheses((s) => ({ ...s, [key]: { open: true, text: saved ?? "", loading: !saved, error: null } }));
        if (!saved) load(key);
      },
    };
  }, [theses, expansions, id]);

  return (
    <ThesisContext.Provider value={ctx}>
      <Markdown text={text} className={cx("prose-lesson brief", className)} components={COMPONENTS} />
    </ThesisContext.Provider>
  );
}
