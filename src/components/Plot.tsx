"use client";

import { useMemo, useState } from "react";
import { autoY, parsePlot, ticks, type PlotSpec } from "@/lib/plot";

const W = 600;
const H = 360;
const PAD = { l: 44, r: 14, t: 14, b: 28 };
const COLORS = ["var(--accent)", "var(--bad)", "var(--ok)", "var(--warn)", "var(--bright)"];
const SAMPLES = 700;

const fmt = (v: number) => {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return String(Number(v.toFixed(3)));
};

/** Path pieces of one curve: broken where it is undefined or jumps across an asymptote. */
function curvePaths(fn: (x: number) => number, spec: PlotSpec, y: [number, number], sx: (v: number) => number, sy: (v: number) => number): string[] {
  const [a, b] = spec.x;
  const span = y[1] - y[0];
  const paths: string[] = [];
  let cur = "";
  let prev: number | null = null;
  for (let i = 0; i <= SAMPLES; i++) {
    const x = a + ((b - a) * i) / SAMPLES;
    const v = fn(x);
    const ok = Number.isFinite(v);
    const jump = ok && prev !== null && Math.abs(v - prev) > span * 1.5;
    if (!ok || jump) {
      if (cur) paths.push(cur);
      cur = "";
    }
    if (ok) {
      // Clamp far-off values so the line runs off the edge instead of drawing at a huge coordinate.
      const cy = Math.max(y[0] - span, Math.min(y[1] + span, v));
      cur += `${cur ? "L" : "M"}${sx(x).toFixed(1)},${sy(cy).toFixed(1)}`;
    }
    prev = ok ? v : null;
  }
  if (cur) paths.push(cur);
  return paths;
}

/** A function plot from a ```plot block; while it is being written or if it is wrong, the source shows. */
export function Plot({ code }: { code: string }) {
  const parsed = useMemo(() => {
    try {
      return { spec: parsePlot(code) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [code]);
  const [hover, setHover] = useState<number | null>(null);

  if (!("spec" in parsed) || !parsed.spec) {
    return (
      <div>
        <pre>
          <code>{code}</code>
        </pre>
        <p className="-mt-2 text-xs text-muted">График не построен: {parsed.error}</p>
      </div>
    );
  }
  const spec = parsed.spec;
  const y = spec.y ?? autoY(spec);
  const sx = (v: number) => PAD.l + ((v - spec.x[0]) / (spec.x[1] - spec.x[0])) * (W - PAD.l - PAD.r);
  const sy = (v: number) => H - PAD.b - ((v - y[0]) / (y[1] - y[0])) * (H - PAD.t - PAD.b);
  const invX = (px: number) => spec.x[0] + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (spec.x[1] - spec.x[0]);
  const xt = ticks(spec.x[0], spec.x[1]);
  const yt = ticks(y[0], y[1], 6);
  const inX = (v: number) => v >= spec.x[0] && v <= spec.x[1];
  const inY = (v: number) => v >= y[0] && v <= y[1];
  const axisY = inX(0) ? sx(0) : null;
  const axisX = inY(0) ? sy(0) : null;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    setHover(px >= PAD.l && px <= W - PAD.r ? invX(px) : null);
  };

  return (
    <figure className="not-prose my-3 rounded-md border border-border bg-surface p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full select-none" role="img" aria-label={spec.curves.map((c) => c.label).join(", ") || "график"}>
        <defs>
          <clipPath id="plot-area">
            <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} />
          </clipPath>
        </defs>
        {xt.map((v) => (
          <g key={`x${v}`}>
            <line x1={sx(v)} x2={sx(v)} y1={PAD.t} y2={H - PAD.b} stroke="var(--border)" strokeWidth={1} />
            <text x={sx(v)} y={H - PAD.b + 16} textAnchor="middle" fontSize={11} fill="var(--muted)">
              {fmt(v)}
            </text>
          </g>
        ))}
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.l - 6} y={sy(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
              {fmt(v)}
            </text>
          </g>
        ))}
        {axisY !== null && <line x1={axisY} x2={axisY} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeWidth={1.2} />}
        {axisX !== null && <line x1={PAD.l} x2={W - PAD.r} y1={axisX} y2={axisX} stroke="var(--muted)" strokeWidth={1.2} />}

        <g clipPath="url(#plot-area)">
          {spec.vlines.filter((l) => inX(l.x)).map((l, i) => (
            <line key={`v${i}`} x1={sx(l.x)} x2={sx(l.x)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeWidth={1.2} strokeDasharray="5 4" />
          ))}
          {spec.curves.map((c, i) =>
            curvePaths(c.fn, spec, y, sx, sy).map((d, j) => <path key={`${i}-${j}`} d={d} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={2} strokeLinejoin="round" />),
          )}
          {spec.points.map((p, i) => (
            <g key={`p${i}`}>
              <circle cx={sx(p.x)} cy={sy(p.y)} r={4} fill="var(--bright)" />
              {p.label && (
                <text x={sx(p.x) + 7} y={sy(p.y) - 7} fontSize={12} fill="var(--bright)">
                  {p.label}
                </text>
              )}
            </g>
          ))}
          {hover !== null && (
            <g>
              <line x1={sx(hover)} x2={sx(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--border-strong)" strokeWidth={1} />
              {spec.curves.map((c, i) => {
                const v = c.fn(hover);
                return Number.isFinite(v) && inY(v) ? <circle key={i} cx={sx(hover)} cy={sy(v)} r={3.5} fill={COLORS[i % COLORS.length]} /> : null;
              })}
            </g>
          )}
        </g>
        <rect x={0} y={0} width={W} height={H} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-1 text-xs text-muted">
        {spec.curves.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="font-mono">{c.label}</span>
            {hover !== null && <span className="tabular-nums text-bright">= {fmt(c.fn(hover))}</span>}
          </span>
        ))}
        {spec.vlines.map((l, i) => (
          <span key={`v${i}`} className="font-mono">
            ┊ {l.label}
          </span>
        ))}
        {hover !== null && <span className="ml-auto tabular-nums">x = {fmt(hover)}</span>}
      </figcaption>
    </figure>
  );
}
