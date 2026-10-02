import { CircuitBoard, type CircuitConnection, type CircuitNode } from "@/components/ui/circuit-board";
import type { EvaluatedPlan } from "@/lib/planner";

// Cost bands match the transition cards' bars.
const BANDS = [
  { max: 0.25, color: "var(--led-green)", label: "Cost under 0.25" },
  { max: 0.5, color: "var(--led-amber)", label: "0.25 to 0.5" },
  { max: Infinity, color: "var(--led-red)", label: "0.5 and over" },
] as const;

const band = (cost: number) => BANDS.find((b) => cost < b.max) ?? BANDS[2];
const CELL_W = 118;
const CELL_H = 92;

function short(title: string, max = 13): string {
  return title.length > max ? `${title.slice(0, max - 1).trimEnd()}…` : title;
}

/** Lays the set out row by row, turning back at each row's end, so each hop stays short. */
function layout(plan: EvaluatedPlan, cols: number) {
  const rows = Math.ceil(plan.items.length / cols);
  const nodes: CircuitNode[] = plan.items.map((item, i) => {
    const row = Math.floor(i / cols);
    const col = row % 2 === 0 ? i % cols : cols - 1 - (i % cols);
    return { id: `${i}`, x: CELL_W / 2 + col * CELL_W, y: 34 + row * CELL_H, value: String(i + 1), label: short(item.title) };
  });
  // A hop that changes row turns at that row's end: the right on even rows, the left on odd ones.
  const connections: CircuitConnection[] = plan.transitions.map((t, i) => ({
    from: `${i}`,
    to: `${i + 1}`,
    color: band(t.cost).color,
    side: Math.floor(i / cols) % 2 === 0 ? "right" : "left",
  }));
  return { nodes, connections, width: Math.min(cols, plan.items.length) * CELL_W, height: rows * CELL_H };
}

/**
 * The set as a circuit: each track a tile numbered in play order, each transition a trace lit
 * by its cost, and one pulse running through the set from the first track to the last. A
 * summary of the costs is read out; the list below carries every detail.
 */
export function SignalFlow({ plan }: { plan: EvaluatedPlan }) {
  if (plan.items.length < 2) return null;
  const counts = BANDS.map((b) => plan.transitions.filter((t) => band(t.cost) === b).length);
  const summary = `Signal flow through ${plan.items.length} tracks: ${counts[0]} transitions with cost under 0.25, ${counts[1]} from 0.25 to 0.5, and ${counts[2]} at 0.5 or over. The set order below lists every transition.`;
  const wide = layout(plan, 6);
  const narrow = layout(plan, 3);
  return (
    <section aria-labelledby="signal-flow-heading" className="deck-screen m-1 p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="signal-flow-heading" className="inline-flex items-center gap-2 text-eyebrow text-muted">
          <span aria-hidden className="size-1.5 rounded-full bg-[var(--led-blue)] shadow-[0_0_6px_var(--led-blue)]" />
          Signal flow
        </h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted">
          {BANDS.map((b, i) => (
            <li key={b.label} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-[3px] w-4 rounded-full" style={{ background: b.color, boxShadow: `0 0 5px ${b.color}` }} />
              {b.label} <span className="font-segment text-[12px] text-ink">{counts[i]}</span>
            </li>
          ))}
        </ul>
      </div>
      {/* Six tiles a row on wider screens, three on phones, so labels stay readable. */}
      <CircuitBoard {...wide} label={summary} className="mx-auto mt-4 hidden max-w-[760px] sm:block" />
      <CircuitBoard {...narrow} label={summary} className="mt-4 sm:hidden" />
    </section>
  );
}
