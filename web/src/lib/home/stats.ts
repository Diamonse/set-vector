/** Summaries of a library for the home dashboard. Pure, so the numbers are tested directly. */
import { toCamelot, usableKey } from "@/lib/domain/camelot";
import type { Track } from "@/lib/domain/types";
import { cueStateOf } from "@/lib/library/filters";

export interface Bin {
  label: string;
  /** Inclusive lower and exclusive upper bound, in the bin's unit. */
  from: number;
  to: number;
  count: number;
}

export interface LibraryHealth {
  tracks: number;
  totalSeconds: number;
  withTempo: number;
  withKey: number;
  withEnergy: number;
  estimatedEnergy: number;
  cueReady: number;
  needsReview: number;
}

export function needsReview(t: Track): boolean {
  return (
    t.bpm === null ||
    t.bpmSource === "estimate" ||
    usableKey(t.keyTonic, t.keyMode, t.keyStatus) === null ||
    t.keyStatus === "estimated" ||
    t.energy === null ||
    cueStateOf(t) !== "ready"
  );
}

export function libraryHealth(tracks: Track[]): LibraryHealth {
  return {
    tracks: tracks.length,
    totalSeconds: tracks.reduce((s, t) => s + t.durationSeconds, 0),
    withTempo: tracks.filter((t) => t.bpm !== null).length,
    withKey: tracks.filter((t) => usableKey(t.keyTonic, t.keyMode, t.keyStatus)).length,
    withEnergy: tracks.filter((t) => t.energy !== null).length,
    estimatedEnergy: tracks.filter((t) => t.energyModel).length,
    cueReady: tracks.filter((t) => cueStateOf(t) === "ready").length,
    needsReview: tracks.filter(needsReview).length,
  };
}

export const BPM_BIN = 5;

/** Tempo histogram in 5 BPM bins spanning the library's range; empty without tempos. */
export function bpmHistogram(tracks: Track[]): Bin[] {
  const bpms = tracks.map((t) => t.bpm).filter((b): b is number => b !== null);
  if (!bpms.length) return [];
  const lo = Math.floor(Math.min(...bpms) / BPM_BIN) * BPM_BIN;
  const hi = Math.floor(Math.max(...bpms) / BPM_BIN) * BPM_BIN + BPM_BIN;
  const bins: Bin[] = [];
  for (let from = lo; from < hi; from += BPM_BIN) bins.push({ label: `${from} to ${from + BPM_BIN}`, from, to: from + BPM_BIN, count: 0 });
  for (const b of bpms) bins[Math.min(bins.length - 1, Math.floor((b - lo) / BPM_BIN))]!.count++;
  return bins;
}

/** Energy histogram with one bin per whole step, 1 to 10. */
export function energyHistogram(tracks: Track[]): Bin[] {
  const bins: Bin[] = Array.from({ length: 10 }, (_, i) => ({ label: String(i + 1), from: i + 1, to: i + 2, count: 0 }));
  for (const t of tracks) {
    if (t.energy === null) continue;
    bins[Math.min(9, Math.max(0, Math.round(t.energy) - 1))]!.count++;
  }
  return bins;
}

export interface KeyCount {
  number: number;
  letter: "A" | "B";
  count: number;
}

/** Counts for all 24 Camelot codes, 1A..12B; uncertain and unknown keys are left out. */
export function keyCounts(tracks: Track[]): KeyCount[] {
  const counts: KeyCount[] = Array.from({ length: 12 }, (_, i) => [
    { number: i + 1, letter: "A" as const, count: 0 },
    { number: i + 1, letter: "B" as const, count: 0 },
  ]).flat();
  for (const t of tracks) {
    const key = usableKey(t.keyTonic, t.keyMode, t.keyStatus);
    if (!key) continue;
    const c = toCamelot(key);
    counts[(c.number - 1) * 2 + (c.letter === "B" ? 1 : 0)]!.count++;
  }
  return counts;
}

export interface StyleCount {
  style: string;
  count: number;
}

/** Tracks per style tag, most common first; beyond `top`, the rest fold into "Other styles". */
export function styleCounts(tracks: Track[], top = 8): StyleCount[] {
  const map = new Map<string, number>();
  for (const t of tracks) for (const s of new Set(t.styleTags)) map.set(s, (map.get(s) ?? 0) + 1);
  const sorted = [...map.entries()].map(([style, count]) => ({ style, count })).sort((a, b) => b.count - a.count || a.style.localeCompare(b.style));
  if (sorted.length <= top) return sorted;
  const rest = sorted.slice(top);
  return [...sorted.slice(0, top), { style: `Other styles (${rest.length})`, count: rest.reduce((s, r) => s + r.count, 0) }];
}

export interface ChecklistStep {
  id: "tracks" | "analyze" | "cues" | "crate" | "plan";
  title: string;
  detail: string;
  href: string;
  action: string;
  done: boolean;
}

export function gettingStarted(input: { tracks: Track[]; analyses: number; crates: number; plans: number }): ChecklistStep[] {
  const anyApproved = input.tracks.some((t) => t.cues.some((c) => c.reviewStatus === "approved"));
  return [
    { id: "tracks", title: "Add tracks", detail: "Import a Rekordbox collection, a spreadsheet, or add a track by hand.", href: "/library/import", action: "Import tracks", done: input.tracks.length > 0 },
    { id: "analyze", title: "Analyze audio", detail: "Measure tempo, key, loudness, energy, and cue suggestions in your browser.", href: "/library/analyze", action: "Analyze audio", done: input.analyses > 0 },
    { id: "cues", title: "Review a cue region", detail: "Approve an entry or exit region on a track's Cue regions tab.", href: "/library?review=needs", action: "Find tracks to review", done: anyApproved },
    { id: "crate", title: "Make a crate", detail: "Group tracks you might play together.", href: "/crates/new", action: "New crate", done: input.crates > 0 },
    { id: "plan", title: "Plan a set", detail: "Let the planner propose an order and explain each transition.", href: "/plans/new", action: "New plan", done: input.plans > 0 },
  ];
}
