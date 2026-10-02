import * as React from "react";
import { cn } from "@/lib/utils";

// Adapted from Componentry's Circuit Board (componentry.dev/r/circuit-board). Drawn as one SVG
// in its own coordinate space, so it scales with its container; nodes are deck-screen tiles,
// traces take each connection's colour, and a single pulse runs along the traces in order
// and then rests (WCAG 2.2.2), instead of looping. It renders on the server and needs no script.

export interface CircuitNode {
  id: string;
  x: number;
  y: number;
  /** Text inside the tile, set in seven-segment digits. */
  value: string;
  /** Caption under the tile. */
  label?: string;
}

export interface CircuitConnection {
  from: string;
  to: string;
  /** Trace colour, any CSS colour. */
  color: string;
  /** For tiles stacked in one column: loop out to this side instead of crossing their captions. */
  side?: "left" | "right";
}

/**
 * Right-angled route between two tile edges, horizontal first when the tiles sit side by side.
 * Stacked tiles with a `side` get a bracket out to that side, clear of the captions below.
 */
function route(from: CircuitNode, to: CircuitNode, half: number, side?: "left" | "right"): string {
  if (side && from.x === to.x) {
    const dir = side === "right" ? 1 : -1;
    const edge = from.x + dir * half;
    return `M ${edge} ${from.y} H ${edge + dir * 16} V ${to.y} H ${edge}`;
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sx = from.x + Math.sign(dx) * half;
    const ex = to.x - Math.sign(dx) * half;
    const mx = (sx + ex) / 2;
    return `M ${sx} ${from.y} H ${mx} V ${to.y} H ${ex}`;
  }
  const sy = from.y + Math.sign(dy) * half;
  const ey = to.y - Math.sign(dy) * half;
  const my = (sy + ey) / 2;
  return `M ${from.x} ${sy} V ${my} H ${to.x} V ${ey}`;
}

export function CircuitBoard({
  nodes,
  connections,
  width,
  height,
  tile = 40,
  hop = 0.28,
  label,
  className,
}: {
  nodes: CircuitNode[];
  connections: CircuitConnection[];
  width: number;
  height: number;
  /** Tile size in board units. */
  tile?: number;
  /** Seconds between one trace's pulse starting and the next. */
  hop?: number;
  /** Accessible summary of what the board shows. */
  label: string;
  className?: string;
}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const half = tile / 2;
  const gridId = React.useId().replace(/:/g, "");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className={cn("block h-auto w-full", className)}>
      <defs>
        <pattern id={`grid-${gridId}`} width={16} height={16} patternUnits="userSpaceOnUse">
          <circle cx={8} cy={8} r={0.8} className="fill-muted" opacity={0.35} />
        </pattern>
      </defs>
      <rect width={width} height={height} fill={`url(#grid-${gridId})`} />

      {connections.map((c, i) => {
        const from = byId.get(c.from);
        const to = byId.get(c.to);
        if (!from || !to) return null;
        const d = route(from, to, half + 3, c.side);
        return (
          <g key={`${c.from}-${c.to}-${i}`}>
            <path d={d} fill="none" stroke={c.color} strokeOpacity={0.55} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <path
              d={d}
              pathLength={100}
              fill="none"
              stroke={c.color}
              strokeWidth={4}
              strokeLinejoin="round"
              strokeDasharray="12 200"
              strokeDashoffset={12}
              className="trace-pulse"
              style={{ "--pulse-delay": `${0.3 + i * hop}s`, "--pulse-duration": `${hop * 1.8}s`, filter: `drop-shadow(0 0 3px ${c.color})` } as React.CSSProperties}
            />
          </g>
        );
      })}

      {nodes.map((n) => (
        <g key={n.id}>
          <rect x={n.x - half} y={n.y - half} width={tile} height={tile} rx={7} fill="var(--screen)" stroke="var(--led-orange)" strokeOpacity={0.7} strokeWidth={1.5} />
          <text x={n.x} y={n.y + 6} textAnchor="middle" className="fill-[#eef1f5] font-segment text-[16px]">
            {n.value}
          </text>
          {n.label ? (
            <text x={n.x} y={n.y + half + 15} textAnchor="middle" className="fill-body font-mono text-[10.5px]">
              {n.label}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}
