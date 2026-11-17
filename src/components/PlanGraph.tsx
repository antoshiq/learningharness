"use client";

import dagre from "@dagrejs/dagre";
import { Background, BackgroundVariant, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { useMemo, useState } from "react";
import { formatDue } from "@/lib/api";
import type { PlanNodeView } from "@/lib/types";
import { Badge, cx } from "./ui";

const W = 196;
const H = 58;

type Status = "mastered" | "learning" | "available" | "locked";
const statusOf = (n: PlanNodeView): Status => (n.status === "mastered" ? "mastered" : n.status === "learning" ? "learning" : n.available ? "available" : "locked");

const INK: Record<Status, string> = {
  mastered: "var(--ok)",
  learning: "var(--warn)",
  available: "var(--accent)",
  locked: "var(--border-strong)",
};
const LEGEND: [Status, string][] = [
  ["mastered", "освоен"],
  ["learning", "в процессе"],
  ["available", "доступен"],
  ["locked", "закрыт, пока не освоены предпосылки"],
];

/** The same cell that draws progress elsewhere: inked, hatched or empty. */
function Cell({ status }: { status: Status }) {
  return (
    <span
      className={cx(
        "inline-block size-2.5 shrink-0 rounded-[1px] border",
        status === "mastered" && "border-ok bg-ok",
        status === "learning" && "cell-learning border-warn",
        status === "available" && "border-accent bg-accent-soft",
        status === "locked" && "border-border-strong bg-surface-2",
      )}
      aria-hidden
    />
  );
}

export function statusLabel(n: PlanNodeView): { text: string; tone: "ok" | "warn" | "accent" | "neutral" } {
  if (n.status === "mastered") return { text: "освоен", tone: "ok" };
  if (n.status === "learning") return { text: "в процессе", tone: "warn" };
  if (n.available) return { text: "доступен", tone: "accent" };
  return { text: "закрыт", tone: "neutral" };
}

export function PlanGraph({ plan }: { plan: PlanNodeView[] }) {
  const [selected, setSelected] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "TB", nodesep: 24, ranksep: 48, marginx: 8, marginy: 8 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of plan) g.setNode(n.key, { width: W, height: H });
    const byKey = new Map(plan.map((n) => [n.key, n]));
    const edges: Edge[] = [];
    for (const n of plan) {
      for (const d of n.deps) {
        g.setEdge(d, n.key);
        // A path that is already walked is drawn in ink; the rest stays in pencil.
        const walked = byKey.get(d)?.status === "mastered";
        edges.push({
          id: `${d}->${n.key}`,
          source: d,
          target: n.key,
          style: walked ? { stroke: "var(--ok)", strokeWidth: 1.75 } : { strokeDasharray: "4 4" },
        });
      }
    }
    dagre.layout(g);
    const nodes: Node[] = plan.map((n) => {
      const p = g.node(n.key);
      const st = statusOf(n);
      const on = selected === n.key;
      return {
        id: n.key,
        position: { x: p.x - W / 2, y: p.y - H / 2 },
        data: { label: n.title },
        draggable: false,
        connectable: false,
        style: {
          width: W,
          height: H,
          background: st === "locked" ? "var(--surface-2)" : "var(--surface)",
          border: `1px solid ${on ? INK[st] : "var(--border-strong)"}`,
          borderLeft: `3px solid ${INK[st]}`,
          color: st === "locked" ? "var(--muted)" : "var(--text)",
          fontSize: 12.5,
          fontWeight: 400,
          lineHeight: 1.25,
          padding: "4px 10px",
          display: "flex",
          alignItems: "center",
          textAlign: "left",
          boxShadow: on ? `0 0 0 3px color-mix(in srgb, ${INK[st]} 28%, transparent)` : "none",
        },
      };
    });
    return { nodes, edges };
  }, [plan, selected]);

  const sel = plan.find((n) => n.key === selected);

  if (!plan.length) {
    return (
      <div className="rounded-md border border-dashed border-border-strong bg-surface/60 px-6 py-10 text-center text-muted">
        План появится после диагностики на первом уроке.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted">
        {LEGEND.map(([st, text]) => (
          <li key={st} className="flex items-center gap-2">
            <Cell status={st} />
            {text}
          </li>
        ))}
      </ul>
      <div className="h-[52dvh] min-h-72 overflow-hidden rounded-md border border-border-strong bg-surface">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
          minZoom={0.2}
          nodesConnectable={false}
          nodesDraggable={false}
          elementsSelectable
          onNodeClick={(_, n) => setSelected(n.id)}
          onPaneClick={() => setSelected(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--border-strong)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {sel && (
        <div className="rounded-md border border-border bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <Cell status={statusOf(sel)} />
            <span className="text-[15px] font-semibold text-bright">{sel.title}</span>
            <Badge tone={statusLabel(sel).tone}>{statusLabel(sel).text}</Badge>
            {sel.status !== "new" && sel.dueAt && <Badge>{formatDue(sel.dueAt)}</Badge>}
          </div>
          {sel.summary && <p className="mt-1.5 max-w-[68ch] text-[15px] text-muted">{sel.summary}</p>}
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div className="flex gap-1.5">
              <dt className="text-muted">Верных ответов</dt>
              <dd className="font-medium text-ok tabular-nums">{sel.correctCount}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted">Неверных</dt>
              <dd className="font-medium text-bad tabular-nums">{sel.wrongCount}</dd>
            </div>
            {sel.deps.length > 0 && (
              <div className="flex gap-1.5">
                <dt className="text-muted">Сначала нужны</dt>
                <dd>{sel.deps.map((d) => plan.find((p) => p.key === d)?.title ?? d).join(", ")}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
      <ul className="divide-y divide-border rounded-md border border-border bg-surface">
        {plan.map((n) => (
          <li key={n.key}>
            <button
              onClick={() => setSelected(n.key)}
              className={cx("flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-[15px] hover:bg-surface-2", selected === n.key && "bg-surface-2")}
            >
              <Cell status={statusOf(n)} />
              <span className={cx("min-w-0 flex-1 truncate", statusOf(n) === "locked" && "text-muted")}>{n.title}</span>
              <span className="shrink-0 text-sm text-muted">{statusLabel(n).text}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
