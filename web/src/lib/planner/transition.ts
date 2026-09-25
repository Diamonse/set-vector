import { compareKeys, transposeKey, usableKey, type KeyComparison } from "@/lib/domain/camelot";
import type { PlanMode } from "@/lib/domain/types";
import { BLEND_BEATS, MIN_BLEND_BEATS, SHORT_BLEND_BEATS } from "./defaults";
import type {
  CostComponent,
  CueOption,
  OptionOrigin,
  PlanPreferences,
  PlannerTrack,
  Transition,
  TransitionComponents,
  TransitionType,
  TransitionWeights,
} from "./types";

export interface TempoMatch {
  /** Rate applied to B so its pulse matches A. */
  rate: number;
  adjustPct: number;
  /** Ratio between the matched tactus and B's primary BPM (1, 2, 0.5, or an alternative). */
  multiple: number;
  usedAlternative: boolean;
}

/** Finds the smallest tempo change that aligns B's pulse to A's, allowing half/double time and B's stored alternatives. */
export function matchTempo(bpmA: number, bpmB: number, alternativesB: number[]): TempoMatch {
  const candidates: { bpm: number; alt: boolean }[] = [
    { bpm: bpmB, alt: false },
    { bpm: bpmB * 2, alt: false },
    { bpm: bpmB / 2, alt: false },
    ...alternativesB.filter((b) => b > 0).map((b) => ({ bpm: b, alt: true })),
  ];
  let best: TempoMatch | null = null;
  for (const c of candidates) {
    const rate = bpmA / c.bpm;
    const adjustPct = (rate - 1) * 100;
    if (best === null || Math.abs(adjustPct) < Math.abs(best.adjustPct) - 1e-9) {
      best = { rate, adjustPct, multiple: c.bpm / bpmB, usedAlternative: c.alt };
    }
  }
  return best!;
}

const ORIGIN_COST: Record<OptionOrigin, number> = {
  reviewed: 0,
  full_track: 0,
  estimated: 0.35,
  pending: 0.4,
  fallback: 0.7,
};

const HARMONIC_FACTOR: Record<TransitionType, number> = { blend: 1, short_blend: 0.6, cut: 0.15, sequential: 1 };
const VOCAL_FACTOR: Record<TransitionType, number> = { blend: 1, short_blend: 0.6, cut: 0, sequential: 0 };

const TYPE_LABEL: Record<TransitionType, string> = {
  blend: "long blend",
  short_blend: "short blend",
  cut: "cut",
  sequential: "play in sequence",
};

function sharesStyle(a: PlannerTrack, b: PlannerTrack): boolean | null {
  if (a.styleTags.length === 0 || b.styleTags.length === 0) return null;
  const set = new Set(a.styleTags.map((s) => s.toLowerCase()));
  return b.styleTags.some((s) => set.has(s.toLowerCase()));
}

function component(cost: number, weight: number, status: CostComponent["status"], detail: string): CostComponent {
  return { cost: Math.min(1, Math.max(0, cost)), weight, status, detail };
}

export interface TransitionContext {
  mode: PlanMode;
  preferences: PlanPreferences;
  weights: TransitionWeights;
}

/**
 * Scores one directional transition from A's exit region into B's entry region.
 * Costs are transparent 0 to 1 heuristics; missing evidence stays visible
 * through a neutral cost and a "missing" status rather than becoming zero.
 */
export function evaluateTransition(
  a: PlannerTrack,
  exit: CueOption,
  b: PlannerTrack,
  entry: CueOption,
  ctx: TransitionContext,
): Transition {
  const { mode, preferences, weights } = ctx;
  const reasons: string[] = [];
  let reviewNeeded = false;

  // Tempo relation.
  const tempo = a.bpm !== null && b.bpm !== null ? matchTempo(a.bpm, b.bpm, b.bpmAlternatives) : null;
  const tempoWithinLimit = tempo !== null && Math.abs(tempo.adjustPct) <= preferences.maxTempoAdjustPct;

  // Transition type and overlap.
  let type: TransitionType;
  let overlapSeconds = 0;
  const keyA = usableKey(a.keyTonic, a.keyMode, a.keyStatus);
  const keyB = usableKey(b.keyTonic, b.keyMode, b.keyStatus);
  const vocalClash = exit.vocalActivity === "present" && entry.vocalActivity === "present";

  if (mode === "listening") {
    type = "sequential";
  } else if (!tempo || !tempoWithinLimit || preferences.transitionPreference === "cut") {
    type = "cut";
  } else {
    const beat = 60 / a.bpm!;
    const available = Math.min(exit.endSeconds - exit.startSeconds, entry.endSeconds - entry.startSeconds);
    const blendLength = Math.min(available, BLEND_BEATS * beat);
    const shortLength = Math.min(available, SHORT_BLEND_BEATS * beat);
    const harmonicOk = keyA !== null && keyB !== null && compareKeys(keyA, keyB).cost <= 0.2;
    if (available < MIN_BLEND_BEATS * beat) {
      type = "cut";
    } else if (preferences.transitionPreference === "blend") {
      type = "blend";
      overlapSeconds = blendLength;
    } else if (harmonicOk && !vocalClash && blendLength >= 16 * beat) {
      type = "blend";
      overlapSeconds = blendLength;
    } else {
      type = "short_blend";
      overlapSeconds = shortLength;
    }
  }

  // Harmonic component, using the sounding key when key lock is off.
  let harmonic: CostComponent;
  let keyComparison: KeyComparison | null = null;
  let soundingShift = 0;
  const hWeight = weights.harmonic * HARMONIC_FACTOR[type];
  if (keyA && keyB) {
    let sounding = keyB;
    let detuneCost = 0;
    if (!preferences.keyLock && tempo && type !== "sequential") {
      const shift = 12 * Math.log2(tempo.rate);
      soundingShift = Math.round(shift);
      sounding = transposeKey(keyB, soundingShift);
      if (Math.abs(shift - soundingShift) > 0.25) detuneCost = 0.2;
    }
    keyComparison = compareKeys(keyA, sounding);
    let detail = keyComparison.description;
    if (soundingShift !== 0) detail += ` (B sounds ${soundingShift > 0 ? "+" : ""}${soundingShift} semitones without key lock)`;
    if (detuneCost > 0) detail += "; pitch lands between semitones";
    harmonic = component(keyComparison.cost + detuneCost, hWeight, "measured", detail);
  } else {
    const which = !keyA && !keyB ? "both keys" : !keyA ? "exit track key" : "entry track key";
    harmonic = component(0.4, hWeight, "missing", `${which} unavailable or marked uncertain`);
    if (type === "blend" || type === "short_blend") reviewNeeded = true;
  }

  // Tempo component.
  let tempoComponent: CostComponent;
  if (!tempo) {
    tempoComponent = component(0.5, weights.tempo, "missing", "tempo unavailable for one or both tracks");
    if (mode === "dj") reviewNeeded = true;
  } else if (mode === "listening") {
    const logDiff = Math.abs(Math.log(tempo.rate));
    tempoComponent = component(
      logDiff / Math.log(1.12),
      weights.tempo,
      "measured",
      `${a.bpm!.toFixed(0)} to ${b.bpm!.toFixed(0)} BPM${tempo.multiple !== 1 ? " (half/double-time relation)" : ""}`,
    );
  } else {
    const pct = Math.abs(tempo.adjustPct);
    const base = tempoWithinLimit ? pct / preferences.maxTempoAdjustPct : 1;
    const multiplePenalty = tempo.multiple !== 1 ? 0.15 : 0;
    let detail = tempoWithinLimit
      ? `about ${pct < 0.05 ? "0" : pct.toFixed(1)}% tempo adjustment`
      : `${pct.toFixed(1)}% tempo change exceeds the ${preferences.maxTempoAdjustPct}% limit`;
    if (tempo.usedAlternative) detail += ", using B's alternative tactus";
    else if (tempo.multiple === 2) detail += ", matched at double time";
    else if (tempo.multiple === 0.5) detail += ", matched at half time";
    tempoComponent = component(base * 0.85 + multiplePenalty, weights.tempo, "measured", detail);
  }

  // Energy step between tracks (annotated relative energy). Direction is left to the arc term.
  let energyStep: CostComponent;
  if (a.energy !== null && b.energy !== null) {
    const delta = b.energy - a.energy;
    energyStep = component(
      Math.max(0, Math.abs(delta) - 1) / 4,
      weights.energyStep,
      "measured",
      `energy ${a.energy} to ${b.energy} (${delta >= 0 ? "+" : ""}${delta.toFixed(1)})`,
    );
  } else {
    energyStep = component(0.3, weights.energyStep, "missing", "relative energy not annotated");
  }

  // Cue provenance.
  let cue: CostComponent;
  if (mode === "listening") {
    cue = component(0, weights.cue, "not_applicable", "whole tracks play in sequence");
  } else {
    const cost = (ORIGIN_COST[exit.origin] + ORIGIN_COST[entry.origin]) / 2;
    const notes: string[] = [];
    if (exit.origin !== "reviewed") notes.push(`exit ${exit.origin === "fallback" ? "has no cue (outro window)" : "cue unverified"}`);
    if (entry.origin !== "reviewed") notes.push(`entry ${entry.origin === "fallback" ? "has no cue (intro window)" : "cue unverified"}`);
    if (notes.length > 0) reviewNeeded = true;
    cue = component(cost, weights.cue, "measured", notes.length ? notes.join("; ") : "reviewed exit and entry cues");
  }

  // Vocal overlap.
  const vWeight = weights.vocal * VOCAL_FACTOR[type];
  let vocal: CostComponent;
  if (VOCAL_FACTOR[type] === 0) {
    vocal = component(0, vWeight, "not_applicable", "no overlap planned");
  } else if (vocalClash) {
    vocal = component(1, vWeight, "measured", "vocals in both overlap regions");
    reviewNeeded = true;
  } else if (exit.vocalActivity === "unknown" || entry.vocalActivity === "unknown") {
    vocal = component(0.3, vWeight, "missing", "vocal activity not annotated in overlap");
  } else {
    vocal = component(0, vWeight, "measured", "no vocal overlap annotated");
  }

  // Style continuity. A change is permitted; this only nudges toward gradual moves.
  const shared = sharesStyle(a, b);
  const style =
    shared === null
      ? component(0.2, weights.style, "missing", "style tags missing")
      : component(shared ? 0 : 0.5, weights.style, "measured", shared ? "shared style tag" : "style change");

  const components: TransitionComponents = { harmonic, tempo: tempoComponent, energyStep, cue, vocal, style };
  let weighted = 0;
  let totalWeight = 0;
  for (const c of Object.values(components)) {
    if (c.weight <= 0 || c.status === "not_applicable") continue;
    weighted += c.weight * c.cost;
    totalWeight += c.weight;
  }
  const cost = totalWeight > 0 ? weighted / totalWeight : 0;

  if (keyComparison) reasons.push(keyComparison.description);
  else reasons.push("key unavailable");
  if (tempo && mode === "dj") reasons.push(tempoComponent.detail);
  else if (!tempo) reasons.push("tempo unavailable");
  if (mode === "dj") {
    if (exit.origin !== "reviewed") reasons.push(exit.origin === "fallback" ? "exit cue missing" : "exit cue unverified");
    if (entry.origin !== "reviewed") reasons.push(entry.origin === "fallback" ? "entry cue missing" : "entry cue unverified");
    if (vocalClash) reasons.push("vocal overlap risk");
  }
  if (energyStep.status === "measured") reasons.push(energyStep.detail);
  const typeText =
    type === "cut" || type === "sequential"
      ? `${TYPE_LABEL[type]} suggested`
      : `${TYPE_LABEL[type]} suggested (${Math.round(overlapSeconds)} s overlap)`;
  reasons.push(typeText);

  return {
    fromTrackId: a.id,
    toTrackId: b.id,
    exitOptionId: exit.id,
    entryOptionId: entry.id,
    type,
    overlapSeconds,
    playbackRate: tempo ? tempo.rate : null,
    tempoAdjustPct: tempo ? tempo.adjustPct : null,
    tempoMultiple: tempo ? tempo.multiple : null,
    keyRelation: keyComparison ? keyComparison.relation : null,
    soundingShiftSemitones: soundingShift,
    keyLock: preferences.keyLock,
    components,
    cost,
    reviewNeeded,
    reasons,
    explanation: reasons.join("; "),
  };
}
