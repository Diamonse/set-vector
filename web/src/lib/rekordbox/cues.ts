/**
 * Turn Rekordbox cue points into entry and exit regions for the planner.
 *
 * A cue's role comes from its type (fade-in and fade-out marks), then its name ("Intro",
 * "Mix in", "Outro", "Mix out", ...), then its position: the first third is an entry, the
 * last third an exit, and the middle is left out. Loops keep their own span; other cues run
 * 32 beats on the Rekordbox grid. Tracks with a grid but no usable cue for a role get
 * phrase-aligned grid suggestions for that role instead, pending review.
 */
import { phraseCues, REGION_BEATS } from "@/lib/cues/phrases";
import { expandTempo } from "./grid";
import type { PositionMark, TempoMarker } from "./read";

export const MAX_REGIONS_PER_KIND = 4;
export const MIN_REGION_SECONDS = 2;
const SAME_POINT_SECONDS = 0.5;
const SNAP_SECONDS = 0.05;

const ENTRY_NAME = /\b(intro|mix[\s-]?in|in|start|entry|begin)\b/i;
const EXIT_NAME = /\b(outro|mix[\s-]?out|out|end|ending|exit)\b/i;

export interface MappedCueRegion {
  kind: "entry" | "exit";
  startSeconds: number;
  endSeconds: number;
  label: string;
  /** Approved Rekordbox cue, or a pending suggestion from the grid. */
  origin: "rekordbox_cue" | "rekordbox_grid";
}

export interface CueMapping {
  regions: MappedCueRegion[];
  /** Cues in the middle third without an entry or exit name. */
  ignored: number;
}

export function roleOf(mark: PositionMark, duration: number): "entry" | "exit" | null {
  if (mark.kind === "fade_in") return "entry";
  if (mark.kind === "fade_out") return "exit";
  if (mark.kind === "load") return null;
  const entry = ENTRY_NAME.test(mark.name);
  const exit = EXIT_NAME.test(mark.name);
  if (entry !== exit) return entry ? "entry" : "exit";
  if (mark.startSeconds < duration / 3) return "entry";
  if (mark.startSeconds > (duration * 2) / 3) return "exit";
  return null;
}

function describe(mark: PositionMark): string {
  const slot = mark.slot === null ? "memory cue" : `hot cue ${String.fromCharCode(65 + mark.slot)}`;
  const name = mark.name.trim() ? ` "${mark.name.trim().slice(0, 60)}"` : "";
  return `Rekordbox ${mark.kind === "loop" ? "loop" : slot}${name}`;
}

const round = (x: number) => Math.round(x * 1000) / 1000;

export function mapRekordboxCues(marks: PositionMark[], tempo: TempoMarker[], duration: number, averageBpm: number | null = null): CueMapping {
  let beats: number[] = [];
  let positions: number[] = [];
  try {
    if (tempo.length) ({ beats, positions } = expandTempo(tempo, duration));
  } catch {
    beats = [];
  }
  const fallbackPeriod = averageBpm && averageBpm > 0 ? 60 / averageBpm : tempo[0] ? 60 / tempo[0].bpm : null;

  const endAfter = (start: number): number | null => {
    if (beats.length) {
      let i = beats.findIndex((b) => b >= start - SNAP_SECONDS);
      if (i >= 0 && i + REGION_BEATS < beats.length) return beats[i + REGION_BEATS]!;
      if (i >= 0) {
        const period = beats.length > 1 ? (beats[beats.length - 1]! - beats[0]!) / (beats.length - 1) : fallbackPeriod;
        if (period) return beats[i]! + REGION_BEATS * period;
      }
    }
    return fallbackPeriod ? start + REGION_BEATS * fallbackPeriod : null;
  };

  const found: (MappedCueRegion & { hot: boolean })[] = [];
  let ignored = 0;
  for (const mark of marks) {
    if (mark.startSeconds >= duration) continue;
    const kind = roleOf(mark, duration);
    if (!kind) {
      if (mark.kind !== "load") ignored++;
      continue;
    }
    const end = mark.kind === "loop" && mark.endSeconds !== null ? mark.endSeconds : endAfter(mark.startSeconds);
    if (end === null) continue;
    const endSeconds = Math.min(duration, end);
    if (endSeconds - mark.startSeconds < MIN_REGION_SECONDS) continue;
    found.push({
      kind,
      startSeconds: round(mark.startSeconds),
      endSeconds: round(endSeconds),
      label: describe(mark),
      origin: "rekordbox_cue",
      hot: mark.slot !== null,
    });
  }

  // Rekordbox often stores a memory cue and a hot cue on the same point; keep one, preferring the hot cue.
  found.sort((a, b) => a.startSeconds - b.startSeconds || Number(b.hot) - Number(a.hot));
  const unique: MappedCueRegion[] = [];
  for (const r of found) {
    if (unique.some((u) => u.kind === r.kind && Math.abs(u.startSeconds - r.startSeconds) < SAME_POINT_SECONDS)) continue;
    const { hot: _hot, ...region } = r;
    unique.push(region);
  }
  const entries = unique.filter((r) => r.kind === "entry").slice(0, MAX_REGIONS_PER_KIND);
  const exits = unique.filter((r) => r.kind === "exit").slice(-MAX_REGIONS_PER_KIND);

  const regions: MappedCueRegion[] = [...entries, ...exits];
  if (beats.length && (entries.length === 0 || exits.length === 0)) {
    const barStarts = positions.flatMap((p, i) => (p === 1 ? [i] : []));
    const grid = phraseCues({ beats, barStarts: barStarts.length ? barStarts : null, duration, source: "Grid" });
    for (const g of grid) {
      if ((g.kind === "entry" && entries.length === 0) || (g.kind === "exit" && exits.length === 0)) regions.push({ ...g, origin: "rekordbox_grid" });
    }
  }
  return { regions: regions.sort((a, b) => a.startSeconds - b.startSeconds), ignored };
}
