import { formatTime } from "@/lib/domain/format";
import type { ArcPoint } from "@/lib/planner";

export interface ArcChartItem {
  label: string;
  startSeconds: number;
  /** Time this item advances the set (its non-overlapping share). */
  spanSeconds: number;
  energy: number | null;
  targetEnergy: number | null;
}

const W = 960;
const H = 300;
const PAD = { left: 44, right: 16, top: 16, bottom: 36 };

/**
 * Target arc and planned track energy over elapsed playback time. Energy uses
 * the energy data color as a solid line with dots; the target is a dashed
 * neutral line. A data table carries the same values for non-visual reading.
 */
export function EnergyArcChart({
  arc,
  items = [],
  totalSeconds,
  title = "Energy arc",
  caption,
}: {
  arc: ArcPoint[] | null;
  items?: ArcChartItem[];
  totalSeconds: number | null;
  title?: string;
  caption?: string;
}) {
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (u: number) => PAD.left + u * plotW;
  const y = (e: number) => PAD.top + ((10 - e) / 9) * plotH;
  const total = totalSeconds && totalSeconds > 0 ? totalSeconds : null;

  const arcPath = arc
    ? arc.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.energy).toFixed(1)}`).join(" ")
    : null;

  const steps: string[] = [];
  const dots: { cx: number; cy: number; n: number }[] = [];
  if (total) {
    items.forEach((it, i) => {
      if (it.energy === null) return;
      const x0 = x(it.startSeconds / total);
      const x1 = x(Math.min(1, (it.startSeconds + it.spanSeconds) / total));
      const yy = y(it.energy);
      steps.push(`M${x0.toFixed(1)},${yy.toFixed(1)} L${x1.toFixed(1)},${yy.toFixed(1)}`);
      dots.push({ cx: (x0 + x1) / 2, cy: yy, n: i + 1 });
    });
  }

  const xTicks = [0, 0.25, 0.5, 0.75, 1];
  const yTicks = [1, 4, 7, 10];
  const missing = items.filter((i) => i.energy === null).length;

  return (
    <figure className="on-dark rounded-[12px] bg-dark p-6 text-on-dark">
      <figcaption className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <span className="text-card-title text-on-dark">{title}</span>
        <span className="text-caption text-on-dark-muted">
          Relative energy annotations (1 to 10) by elapsed planned time. Not a calibrated measurement.
        </span>
      </figcaption>

      <div className="mt-4 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[560px]" role="img" aria-label={`${title}. The data table below lists the values.`}>
          {yTicks.map((e) => (
            <g key={e}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(e)} y2={y(e)} stroke="#C4D0D8" strokeOpacity={0.18} />
              <text x={PAD.left - 10} y={y(e) + 4} textAnchor="end" fontSize={12} fill="#C4D0D8" fontFamily="ui-monospace, monospace">
                {e}
              </text>
            </g>
          ))}
          {xTicks.map((u) => (
            <text key={u} x={x(u)} y={H - 10} textAnchor={u === 0 ? "start" : u === 1 ? "end" : "middle"} fontSize={12} fill="#C4D0D8" fontFamily="ui-monospace, monospace">
              {total ? formatTime(u * total) : `${Math.round(u * 100)}%`}
            </text>
          ))}
          {arcPath ? <path d={arcPath} fill="none" stroke="#C4D0D8" strokeWidth={2} strokeDasharray="6 5" /> : null}
          {steps.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="#FF7B68" strokeWidth={3} strokeLinecap="round" />
          ))}
          {dots.map((d) => (
            <g key={d.n}>
              <circle cx={d.cx} cy={d.cy} r={4.5} fill="#FF7B68" />
              {dots.length <= 40 ? (
                <text x={d.cx} y={d.cy - 10} textAnchor="middle" fontSize={11} fill="#F8FAFC" fontFamily="ui-monospace, monospace">
                  {d.n}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-caption text-on-dark-muted">
        {arc ? (
          <span className="inline-flex items-center gap-2">
            <svg width="28" height="8" aria-hidden>
              <line x1="0" x2="28" y1="4" y2="4" stroke="#C4D0D8" strokeWidth="2" strokeDasharray="6 5" />
            </svg>
            Target arc (dashed)
          </span>
        ) : (
          <span>No target arc requested</span>
        )}
        {items.length ? (
          <span className="inline-flex items-center gap-2">
            <svg width="28" height="10" aria-hidden>
              <line x1="0" x2="28" y1="5" y2="5" stroke="#FF7B68" strokeWidth="3" />
              <circle cx="14" cy="5" r="3.5" fill="#FF7B68" />
            </svg>
            Track energy (solid, numbered by position)
          </span>
        ) : null}
        {missing ? <span>{missing} track(s) without an energy annotation are not drawn.</span> : null}
      </div>
      {caption ? <p className="mt-2 text-caption text-on-dark-muted">{caption}</p> : null}

      {items.length ? (
        <details className="mt-4">
          <summary className="min-h-11 cursor-pointer py-2 text-ui text-action-on-dark">Show data table</summary>
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-[14px]">
              <thead>
                <tr className="border-b border-on-dark-muted/30 text-left">
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">Track</th>
                  <th className="py-2 pr-3 text-right">Starts at</th>
                  <th className="py-2 pr-3 text-right">Energy</th>
                  <th className="py-2 text-right">Target</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-on-dark-muted/15">
                    <td className="py-1.5 pr-3 text-data">{i + 1}</td>
                    <td className="py-1.5 pr-3">{it.label}</td>
                    <td className="py-1.5 pr-3 text-right text-data">{formatTime(it.startSeconds)}</td>
                    <td className="py-1.5 pr-3 text-right text-data">{it.energy ?? "Unavailable"}</td>
                    <td className="py-1.5 text-right text-data">{it.targetEnergy === null ? "None" : it.targetEnergy.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </figure>
  );
}
