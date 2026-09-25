import type { PlanMode } from "@/lib/domain/types";
import type { ArcPoint, ArcPreset, PlanRequest, PlanWeights } from "./types";

export const ARC_PRESETS: Record<Exclude<ArcPreset, "none" | "custom">, { label: string; points: ArcPoint[] }> = {
  flat: { label: "Sustained", points: [{ t: 0, energy: 6 }, { t: 1, energy: 6 }] },
  build: { label: "Gradual build", points: [{ t: 0, energy: 4 }, { t: 1, energy: 9 }] },
  peak: {
    label: "Peak then release",
    points: [
      { t: 0, energy: 4 },
      { t: 0.65, energy: 9 },
      { t: 0.85, energy: 9 },
      { t: 1, energy: 6 },
    ],
  },
  wave: {
    label: "Waves",
    points: [
      { t: 0, energy: 5 },
      { t: 0.25, energy: 7.5 },
      { t: 0.5, energy: 5.5 },
      { t: 0.75, energy: 8.5 },
      { t: 1, energy: 6 },
    ],
  },
  cooldown: { label: "Cool down", points: [{ t: 0, energy: 8 }, { t: 1, energy: 4 }] },
  opening: { label: "Opening set", points: [{ t: 0, energy: 3 }, { t: 1, energy: 6 }] },
};

export const ARC_PRESET_LABELS: Record<ArcPreset, string> = {
  none: "No arc",
  custom: "Custom",
  flat: ARC_PRESETS.flat.label,
  build: ARC_PRESETS.build.label,
  peak: ARC_PRESETS.peak.label,
  wave: ARC_PRESETS.wave.label,
  cooldown: ARC_PRESETS.cooldown.label,
  opening: ARC_PRESETS.opening.label,
};

/**
 * Starting weights per mode. These are declared hypotheses, not fitted values;
 * the evaluation research requires held-out listening judgments before any
 * set of weights is treated as established.
 */
export const MODE_WEIGHTS: Record<PlanMode, PlanWeights> = {
  dj: {
    transition: { harmonic: 1, tempo: 1.2, energyStep: 0.6, cue: 0.8, vocal: 0.5, style: 0.15 },
    meanTransition: 1,
    worstTransition: 0.35,
    arc: 1,
    diversity: 0.5,
  },
  listening: {
    transition: { harmonic: 0.2, tempo: 0.5, energyStep: 0.8, cue: 0, vocal: 0, style: 0.35 },
    meanTransition: 1,
    worstTransition: 0.25,
    arc: 1,
    diversity: 0.8,
  },
};

export function defaultPlanRequest(mode: PlanMode, candidateTrackIds: string[] = []): PlanRequest {
  return {
    mode,
    selectionPolicy: "use_all",
    candidateTrackIds,
    targetCount: null,
    targetDuration: null,
    requiredTrackIds: [],
    excludedTrackIds: [],
    startTrackId: null,
    endTrackId: null,
    repeatPolicy: { allowRepeats: false, minGapTracks: 10 },
    energyArc: { preset: "peak", points: ARC_PRESETS.peak.points },
    preferences: {
      maxTempoAdjustPct: 6,
      artistSpacing: 3,
      keyLock: true,
      transitionPreference: "auto",
      minPlayedSeconds: mode === "dj" ? 60 : 0,
    },
    weights: structuredClone(MODE_WEIGHTS[mode]),
    search: { beamWidth: 12, branchFactor: 10, maxCandidates: 160, timeBudgetMs: 2500, seed: 7, alternatives: 2 },
  };
}

/** Length, in seconds, of a fallback region when a track has no usable cue of that kind. */
export const FALLBACK_REGION_SECONDS = 30;
/** Beats per phrase-length overlap assumed for a long blend. Not a detected phrase. */
export const BLEND_BEATS = 32;
export const SHORT_BLEND_BEATS = 8;
export const MIN_BLEND_BEATS = 4;
