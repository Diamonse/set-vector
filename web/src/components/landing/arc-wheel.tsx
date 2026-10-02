"use client";

import { WheelCarousel, type WheelItem } from "@/components/ui/wheel-carousel";
import { ARC_PRESETS, type ArcPoint } from "@/lib/planner";

/** A preset's arc drawn large on a deck screen, with where it starts, peaks, and ends. */
function ArcScreen({ label, points }: { label: string; points: ArcPoint[] }) {
  const W = 320;
  const H = 150;
  const px = (t: number) => 12 + t * (W - 24);
  const py = (e: number) => H - 14 - ((e - 1) / 9) * (H - 28);
  const line = points.map((p) => `${px(p.t).toFixed(1)},${py(p.energy).toFixed(1)}`).join(" ");
  const area = `${px(points[0]!.t)},${H - 14} ${line} ${px(points.at(-1)!.t)},${H - 14}`;
  const peak = Math.max(...points.map((p) => p.energy));
  const readouts: [string, number][] = [
    ["Opens", points[0]!.energy],
    ["Peak", peak],
    ["Closes", points.at(-1)!.energy],
  ];
  return (
    <figure className="deck-screen m-1 flex h-full flex-col p-4">
      <figcaption className="text-eyebrow text-muted">
        {label}
        <span className="sr-only">: target energy from 1 to 10 across the set</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden className="mt-2 h-auto w-full flex-1">
        {[2, 4, 6, 8, 10].map((e) => (
          <line key={e} x1={12} x2={W - 12} y1={py(e)} y2={py(e)} className="stroke-divider" strokeWidth={1} />
        ))}
        <polygon points={area} fill="color-mix(in oklab, var(--led-orange) 16%, transparent)" />
        <polyline points={line} fill="none" stroke="var(--led-orange)" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 4px var(--led-orange))" }} />
      </svg>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        {readouts.map(([k, v]) => (
          <div key={k}>
            <dt className="text-eyebrow text-muted">{k}</dt>
            <dd className="mt-1 font-segment text-[18px] leading-none text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}

const ITEMS: WheelItem[] = Object.values(ARC_PRESETS).map((preset) => ({
  label: preset.label,
  preview: <ArcScreen label={preset.label} points={preset.points} />,
}));

/** The planner's energy arc presets on a jog wheel, each previewed on a deck screen. */
export function ArcWheel() {
  return <WheelCarousel items={ITEMS} label="Energy arc presets" />;
}
