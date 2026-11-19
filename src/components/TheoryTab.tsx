"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { Badge, Button, cx, Icon, Loading, Notice } from "./ui";
import { api, formatDate } from "@/lib/api";

interface Entry {
  id: number;
  text: string;
  createdAt: number;
  sessionId: number | null;
}
interface TheoryNode {
  key: string;
  title: string;
  status: string;
  entries: Entry[];
}

const STATUS: Record<string, { text: string; tone?: "ok" | "warn" }> = {
  mastered: { text: "освоено", tone: "ok" },
  learning: { text: "изучается", tone: "warn" },
  new: { text: "не начато" },
};

/** Theory from lessons, idea by idea: the topic's own textbook. */
export function TheoryTab({ topicId, focus }: { topicId: number; focus: string | null }) {
  const [nodes, setNodes] = useState<TheoryNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(focus ? [focus] : []));
  const focused = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ nodes: TheoryNode[] }>(`/api/topics/${topicId}/theory`);
      setNodes(r.nodes);
      // With nothing chosen, the first idea is open so the page is not a bare list.
      setOpen((o) => (o.size || !r.nodes.length ? o : new Set([r.nodes[0].key])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [topicId]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (nodes && focus) focused.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [nodes, focus]);

  const remove = async (id: number) => {
    if (!confirm("Удалить это объяснение из теории темы?")) return;
    try {
      setNodes((await api<{ nodes: TheoryNode[] }>(`/api/topics/${topicId}/theory?entry=${id}`, { method: "DELETE" })).nodes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!nodes) return <Loading />;
  if (!nodes.length) {
    return (
      <p className="text-sm text-muted">
        Здесь соберётся теория из уроков: объяснения репетитора по каждой идее плана, включая «Объясни подробнее» и разборы ошибок. Она появляется, когда ты отвечаешь
        на вопрос по идее.
      </p>
    );
  }

  const toggle = (key: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>Объяснения репетитора по идеям плана, в порядке изучения. Конспект строится и по ним.</span>
        <Button small variant="ghost" className="ml-auto" onClick={() => setOpen(new Set(open.size === nodes.length ? [] : nodes.map((n) => n.key)))}>
          {open.size === nodes.length ? "Свернуть всё" : "Развернуть всё"}
        </Button>
      </div>
      {nodes.map((n) => {
        const isOpen = open.has(n.key);
        const st = STATUS[n.status] ?? STATUS.new;
        return (
          <section
            key={n.key}
            ref={n.key === focus ? (el) => void (focused.current = el) : undefined}
            className={cx("scroll-mt-20 rounded-md border bg-surface", n.key === focus ? "border-accent" : "border-border")}
          >
            <button onClick={() => toggle(n.key)} className="flex min-h-11 w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-surface-2" aria-expanded={isOpen}>
              <Icon name="chevron" size={14} className={cx("shrink-0 transition-transform duration-150", isOpen && "rotate-90")} />
              <span className="min-w-0 flex-1 text-[15px] font-medium text-bright">{n.title}</span>
              <Badge tone={st.tone}>{st.text}</Badge>
              <span className="shrink-0 text-xs text-muted tabular-nums">{n.entries.length}</span>
            </button>
            {isOpen && (
              <div className="space-y-5 border-t border-border px-4 py-4 sm:px-5">
                {n.entries.map((e, i) => (
                  <article key={e.id} className={cx(i > 0 && "border-t border-dashed border-border pt-5")}>
                    <Markdown text={e.text} className="prose-lesson" />
                    <div className="mt-2 flex items-center gap-3 text-xs text-muted">
                      <span>{formatDate(e.createdAt)}</span>
                      {e.sessionId && (
                        <a className="hover:text-bright hover:underline" href={`/session/${e.sessionId}`}>
                          из урока
                        </a>
                      )}
                      <button className="ml-auto hover:text-bad" onClick={() => remove(e.id)} title="Удалить объяснение">
                        удалить
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
