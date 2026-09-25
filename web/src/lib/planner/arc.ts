import { ARC_PRESETS } from "./defaults";
import type { ArcPoint, EnergyArc } from "./types";

/** Resolves an arc to sorted control points, or null when no arc is requested. */
export function arcPoints(arc: EnergyArc): ArcPoint[] | null {
  if (arc.preset === "none") return null;
  const points = arc.preset === "custom" ? arc.points : ARC_PRESETS[arc.preset].points;
  const sorted = points
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.energy))
    .map((p) => ({ t: Math.min(1, Math.max(0, p.t)), energy: Math.min(10, Math.max(1, p.energy)) }))
    .sort((a, b) => a.t - b.t);
  return sorted.length === 0 ? null : sorted;
}

/** Piecewise-linear target energy at elapsed fraction u. */
export function targetEnergyAt(points: ArcPoint[], u: number): number {
  const x = Math.min(1, Math.max(0, u));
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (x <= first.t) return first.energy;
  if (x >= last.t) return last.energy;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (x <= b.t) {
      const span = b.t - a.t;
      if (span <= 0) return b.energy;
      return a.energy + ((x - a.t) / span) * (b.energy - a.energy);
    }
  }
  return last.energy;
}

export function sampleArc(points: ArcPoint[], samples = 50): ArcPoint[] {
  return Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples;
    return { t, energy: targetEnergyAt(points, t) };
  });
}
