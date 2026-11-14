"use client";

import dagre from "@dagrejs/dagre";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { useMemo, useState } from "react";
import { formatDue } from "@/lib/api";
import type { PlanNodeView } from "@/lib/types";
import { Badge, cx } from "./ui";

const W = 190;
const H = 54;

function colors(n: PlanNodeView) {
  if (n.status === "mastered") return { bg: "var(--ok-soft)", border: "var(--ok)", fg: "var(--text)" };
  if (n.status === "learning") return { bg: "var(--warn-soft)", border: "var(--warn)", fg: "var(--text)" };
  if (n.available) return { bg: "var(--accent-soft)", border: "var(--accent)", fg: "var(--text)" };
  return { bg: "var(--surface-2)", border: "var(--border)", fg: "var(--muted)" };
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
    g.setGraph({ rankdir: "TB", nodesep: 24, ranksep: 46, marginx: 8, marginy: 8 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of plan) g.setNode(n.key, { width: W, height: H });
    const edges: Edge[] = [];
    for (const n of plan) {
      for (const d of n.deps) {
        g.setEdge(d, n.key);
        edges.push({ id: `${d}->${n.key}`, source: d, target: n.key });
      }
    }
    dagre.layout(g);
    const nodes: Node[] = plan.map((n) => {
      const p = g.node(n.key);
      const c = colors(n);
      return {
        id: n.key,
        position: { x: p.x - W / 2, y: p.y - H / 2 },
        data: { label: n.title },
        draggable: false,
        connectable: false,
        style: {
          width: W,
          height: H,
          background: c.bg,
          border: `1.5px solid ${c.border}`,
          color: c.fg,
          fontSize: 12.5,
          lineHeight: 1.25,
          padding: "4px 8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          boxShadow: selected === n.key ? `0 0 0 2px ${c.border}` : "none",
        },
      };
    });
    return { nodes, edges };
  }, [plan, selected]);

  const sel = plan.find((n) => n.key === selected);

  if (!plan.length) {
    return <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">План появится после диагностики на первом уроке.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge tone="ok">освоен</Badge>
        <Badge tone="warn">в процессе</Badge>
        <Badge tone="accent">доступен</Badge>
        <Badge>закрыт: не освоены предпосылки</Badge>
      </div>
      <div className="h-[52dvh] min-h-72 overflow-hidden rounded-xl border border-border bg-surface">
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
          <Background gap={20} color="var(--border)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {sel && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{sel.title}</span>
            <Badge tone={statusLabel(sel).tone}>{statusLabel(sel).text}</Badge>
            {sel.status !== "new" && sel.dueAt && <Badge>{formatDue(sel.dueAt)}</Badge>}
          </div>
          {sel.summary && <p className="mt-1 text-sm text-muted">{sel.summary}</p>}
          <p className="mt-2 text-xs text-muted">
            Верных ответов: {sel.correctCount} · неверных: {sel.wrongCount}
            {sel.deps.length ? ` · нужны: ${sel.deps.map((d) => plan.find((p) => p.key === d)?.title ?? d).join(", ")}` : ""}
          </p>
        </div>
      )}
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {plan.map((n) => (
          <li key={n.key}>
            <button onClick={() => setSelected(n.key)} className={cx("flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm", selected === n.key && "bg-surface-2")}>
              <span className="min-w-0 flex-1 truncate">{n.title}</span>
              <Badge tone={statusLabel(n).tone}>{statusLabel(n).text}</Badge>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
