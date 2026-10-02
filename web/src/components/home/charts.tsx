import type { Bin, KeyCount, StyleCount } from "@/lib/home/stats";

/**
 * Small single-series charts for the home page. Each uses one hue (the accent) for
 * magnitude, shows its value on hover through an SVG title, labels only the peak, and
 * offers the same numbers as a table.
 */

function DataTable({ caption, head, rows }: { caption: string; head: [string, string]; rows: [string, number][] }) {
  return (
    <details className="mt-3">
      <summary className="min-h-9 cursor-pointer py-1 text-caption text-muted hover:text-ink">Show data</summary>
      <table className="mt-2 w-full text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-divider text-left text-muted">
            <th className="py-1 pr-3 font-medium">{head[0]}</th>
            <th className="py-1 text-right font-medium">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-divider/60">
              <td className="py-1 pr-3">{k}</td>
              <td className="py-1 text-right font-mono tabular">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function Histogram({ bins, title, unit, empty }: { bins: Bin[]; title: string; unit: string; empty: string }) {
  const total = bins.reduce((s, b) => s + b.count, 0);
  if (total === 0) return <p className="text-caption text-muted">{empty}</p>;
  const W = 320;
  const H = 120;
  const AXIS = 18;
  const max = Math.max(...bins.map((b) => b.count));
  const gap = 2;
  const bw = W / bins.length;
  const peak = bins.findIndex((b) => b.count === max);
  const y = (c: number) => (H - AXIS - 14) * (c / max);
  const every = Math.ceil(bins.length / 6);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title}: ${total} tracks. Use Show data for the values.`}>
        <line x1={0} x2={W} y1={H - AXIS} y2={H - AXIS} className="stroke-divider" strokeWidth={1} />
        {bins.map((b, i) => {
          const h = y(b.count);
          const x = i * bw + gap / 2;
          const w = Math.max(1, bw - gap);
          return (
            <g key={b.label}>
              <title>{`${b.label} ${unit}: ${b.count} track${b.count === 1 ? "" : "s"}`}</title>
              {/* Hit area covers the full column so thin or empty bars still show their tooltip. */}
              <rect x={i * bw} y={0} width={bw} height={H - AXIS} fill="transparent" />
              {b.count > 0 ? <path d={roundedTop(x, H - AXIS - h, w, h, Math.min(4, w / 2))} className="fill-action" /> : null}
              {i === peak ? (
                <text x={x + w / 2} y={H - AXIS - h - 4} textAnchor="middle" className="fill-body font-mono text-[10px]">
                  {b.count}
                </text>
              ) : null}
              {i % every === 0 ? (
                <text x={i * bw} y={H - 5} className="fill-muted font-mono text-[10px]">
                  {b.from}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <DataTable caption={title} head={[unit, "Tracks"]} rows={bins.map((b) => [b.label, b.count])} />
    </figure>
  );
}

/** A bar with rounded top corners anchored flat on the baseline. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export function StyleBars({ styles }: { styles: StyleCount[] }) {
  if (!styles.length) return <p className="text-caption text-muted">No style tags yet. Genres from a Rekordbox import become style tags.</p>;
  const max = Math.max(...styles.map((s) => s.count));
  return (
    <figure>
      <ul className="flex flex-col gap-2">
        {styles.map((s) => (
          <li key={s.style} className="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-3" title={`${s.style}: ${s.count} track${s.count === 1 ? "" : "s"}`}>
            <span className="truncate text-[14px] text-body">{s.style}</span>
            <span aria-hidden className="h-3 overflow-hidden rounded-r-[4px] bg-surface-subtle">
              <span className="block h-full rounded-r-[4px] bg-action" style={{ width: `${Math.max(3, (s.count / max) * 100)}%` }} />
            </span>
            <span className="text-right font-mono text-[13px] text-body tabular">{s.count}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-caption text-muted">A track with several style tags counts once for each.</p>
    </figure>
  );
}

/**
 * Camelot wheel: minor keys (A) on the inner ring, major keys (B) on the outer ring, with
 * the code printed on every segment. Darker accent means more tracks in that key.
 */
export function KeyWheel({ keys }: { keys: KeyCount[] }) {
  const total = keys.reduce((s, k) => s + k.count, 0);
  if (total === 0) return <p className="text-caption text-muted">No usable keys yet. Analyze audio or import keys to fill the wheel.</p>;
  const max = Math.max(...keys.map((k) => k.count));
  const C = 110;
  const rings = { A: [44, 74], B: [76, 106] } as const;
  const top = keys.reduce((a, b) => (b.count > a.count ? b : a));
  return (
    <figure>
      <svg viewBox="0 0 220 220" className="mx-auto h-auto w-full max-w-[260px]" role="img" aria-label={`Keys on the Camelot wheel: ${total} tracks; most common ${top.number}${top.letter}. Use Show data for the values.`}>
        {keys.map((k) => {
          const [r0, r1] = rings[k.letter];
          // 12 o'clock is 12; numbers run clockwise, so 1 sits one step clockwise of 12.
          const a0 = ((k.number % 12) * 30 - 14 - 90) * (Math.PI / 180);
          const a1 = a0 + (28 * Math.PI) / 180;
          const share = k.count / max;
          const mix = k.count === 0 ? 0 : 18 + share * 72;
          const mid = (a0 + a1) / 2;
          const rm = (r0 + r1) / 2;
          const strong = mix > 55;
          return (
            <g key={`${k.number}${k.letter}`}>
              <title>{`${k.number}${k.letter}: ${k.count} track${k.count === 1 ? "" : "s"}`}</title>
              <path
                d={arc(C, r0 + 1, r1 - 1, a0, a1)}
                style={{ fill: k.count === 0 ? "var(--surface-subtle)" : `color-mix(in oklab, var(--action) ${mix}%, var(--surface))` }}
              />
              <text
                x={C + rm * Math.cos(mid)}
                y={C + rm * Math.sin(mid) + 3.5}
                textAnchor="middle"
                className={`font-mono text-[9.5px] font-semibold ${strong ? "fill-on-action" : k.count ? "fill-ink" : "fill-muted"}`}
              >
                {k.number}
                {k.letter}
              </text>
            </g>
          );
        })}
        <text x={C} y={C - 2} textAnchor="middle" className="fill-ink font-mono text-[18px] font-semibold">
          {total}
        </text>
        <text x={C} y={C + 13} textAnchor="middle" className="fill-muted text-[9px]">
          tracks with a key
        </text>
      </svg>
      <p className="mt-1 text-center text-caption text-muted">Inner ring minor (A), outer ring major (B). Neighbours mix most easily.</p>
      <DataTable caption="Tracks per Camelot key" head={["Key", "Tracks"]} rows={keys.filter((k) => k.count > 0).map((k) => [`${k.number}${k.letter}`, k.count])} />
    </figure>
  );
}

function arc(c: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${(c + r * Math.cos(a)).toFixed(2)},${(c + r * Math.sin(a)).toFixed(2)}`;
  return `M${p(r1, a0)} A${r1},${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 0 0 ${p(r0, a0)} Z`;
}
