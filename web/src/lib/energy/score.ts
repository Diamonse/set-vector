/**
 * Experimental energy estimate, library-relative.
 *
 * Each input is ranked against the other analyzed tracks in the same library (a mid-rank
 * percentile), blended with a fixed reference range so a small library still gives
 * sensible numbers, then combined with fixed weights into a 1 to 10 score. The ranking
 * follows the library: adding or removing analyzed tracks moves other tracks' scores.
 *
 * The weights and reference ranges are hypotheses, not validated values. Each result keeps
 * its per-input contributions so the score can be explained and later compared with the
 * user's own ratings.
 */

export const ENERGY_MODEL_ID = "library-percentile-v1";

/** How many tracks of library evidence count as much as the fixed reference range. */
export const PRIOR_WEIGHT = 8;
/** An estimate needs loudness and at least this many inputs in total. */
export const MIN_INPUTS = 3;

export type EnergyInputKey = "loudness" | "onsetRate" | "tempo" | "bassRatio" | "brightness";

export interface EnergyInputs {
  loudness: number | null;
  onsetRate: number | null;
  tempo: number | null;
  bassRatio: number | null;
  brightness: number | null;
}

interface InputSpec {
  label: string;
  weight: number;
  /** Reference range mapped linearly to 0..1 before blending with the library rank. */
  low: number;
  high: number;
  unit: string;
  describe: (pct: number) => string;
}

export const INPUTS: Record<EnergyInputKey, InputSpec> = {
  loudness: { label: "Loudness of the busiest sections", weight: 0.35, low: -20, high: -5, unit: "LUFS", describe: (p) => `louder than ${p}% of analyzed tracks` },
  onsetRate: { label: "Drum and note activity", weight: 0.25, low: 1, high: 7, unit: "onsets/s", describe: (p) => `busier than ${p}%` },
  tempo: { label: "Tempo", weight: 0.15, low: 80, high: 150, unit: "BPM", describe: (p) => `faster than ${p}%` },
  bassRatio: { label: "Bass weight", weight: 0.15, low: 0.15, high: 0.7, unit: "share", describe: (p) => `heavier than ${p}%` },
  brightness: { label: "Brightness", weight: 0.1, low: 800, high: 3500, unit: "Hz", describe: (p) => `brighter than ${p}%` },
};

export const INPUT_KEYS = Object.keys(INPUTS) as EnergyInputKey[];

export interface EnergyContribution {
  key: EnergyInputKey;
  label: string;
  value: number;
  unit: string;
  /** Share of comparable library tracks below this one, 0 to 100. */
  percentile: number;
  /** Library rank blended with the reference range, 0 to 1. */
  position: number;
  /** Effective weight after renormalizing over the available inputs. */
  weight: number;
  /** Points of the 1 to 10 score this input contributes above the minimum. */
  points: number;
  description: string;
}

export interface EnergyEstimate {
  model: typeof ENERGY_MODEL_ID;
  /** 1 to 10, one decimal; null when the inputs are insufficient. */
  energy: number | null;
  contributions: EnergyContribution[];
  missing: EnergyInputKey[];
  /** Number of analyzed tracks in the comparison population. */
  population: number;
  reason: string | null;
}

/** Mid-rank percentile of `value` within sorted `population` (which contains it). */
export function midRank(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (sorted[m]! < value) lo = m + 1;
    else hi = m;
  }
  let eq = lo;
  while (eq < sorted.length && sorted[eq] === value) eq++;
  const below = lo;
  const equal = eq - lo;
  const n = sorted.length;
  if (n <= 1) return 0.5;
  // Exclude the track itself from the comparison so a single track maps to 0.5.
  return (below + Math.max(0, equal - 1) / 2) / (n - 1);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export interface LibraryTrackInputs {
  id: string;
  inputs: EnergyInputs;
}

/** Score every track in the library against the library's own distribution. */
export function scoreLibrary(tracks: LibraryTrackInputs[]): Map<string, EnergyEstimate> {
  // The comparison population is the analyzed tracks (those with loudness), for every input.
  const population = tracks.filter((t) => t.inputs.loudness !== null);
  const sorted = Object.fromEntries(
    INPUT_KEYS.map((k) => [k, population.map((t) => t.inputs[k]).filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b)]),
  ) as Record<EnergyInputKey, number[]>;
  const analyzed = population.length;

  const out = new Map<string, EnergyEstimate>();
  for (const t of tracks) {
    const available = INPUT_KEYS.filter((k) => t.inputs[k] !== null && Number.isFinite(t.inputs[k]!));
    const missing = INPUT_KEYS.filter((k) => !available.includes(k));
    if (t.inputs.loudness === null || available.length < MIN_INPUTS) {
      out.set(t.id, {
        model: ENERGY_MODEL_ID,
        energy: null,
        contributions: [],
        missing,
        population: analyzed,
        reason: t.inputs.loudness === null ? "No loudness measurement; analyze the audio file." : "Too few measurements for an estimate.",
      });
      continue;
    }
    const totalWeight = available.reduce((s, k) => s + INPUTS[k].weight, 0);
    let score = 0;
    const contributions = available.map((k) => {
      const spec = INPUTS[k];
      const value = t.inputs[k]!;
      const pop = sorted[k];
      const rank = midRank(pop, value);
      const reference = clamp01((value - spec.low) / (spec.high - spec.low));
      const others = pop.length - 1;
      const position = (others * rank + PRIOR_WEIGHT * reference) / (others + PRIOR_WEIGHT);
      const weight = spec.weight / totalWeight;
      score += weight * position;
      const pct = Math.round(rank * 100);
      return {
        key: k,
        label: spec.label,
        value,
        unit: spec.unit,
        percentile: pct,
        position,
        weight,
        points: 9 * weight * position,
        description: others > 0 ? spec.describe(pct) : "no other analyzed tracks to compare with yet",
      };
    });
    out.set(t.id, {
      model: ENERGY_MODEL_ID,
      energy: Math.round((1 + 9 * score) * 10) / 10,
      contributions,
      missing,
      population: analyzed,
      reason: null,
    });
  }
  return out;
}
