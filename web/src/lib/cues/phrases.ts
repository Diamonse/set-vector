/**
 * Phrase-aligned entry and exit candidates from a beat grid.
 *
 * Phrases are 8 bars from the first bar line when bar lines are known (model downbeats or a
 * Rekordbox grid), or 32 beats from the first beat when they are not, in which case the bar
 * phase is unknown and the label says so. Several candidates per kind let the planner pick
 * the pair that fits each transition best.
 */

export const PHRASE_BARS = 8;
export const REGION_BEATS = 32;
export const MIN_REGION_BEATS = 16;
export const MAX_CANDIDATES = 3;
/** Entries are looked for in the first part of the track, exits in the last part. */
export const ENTRY_ZONE = 0.35;
export const EXIT_ZONE = 0.6;

export interface PhraseBoundary {
  seconds: number;
  strength: number;
}

export interface PhraseCue {
  kind: "entry" | "exit";
  startSeconds: number;
  endSeconds: number;
  label: string;
}

const round = (x: number) => Math.round(x * 1000) / 1000;

function nearestIndex(values: number[], t: number): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (Math.abs(values[i]! - t) < Math.abs(values[best]! - t)) best = i;
  return best;
}

export interface PhraseInput {
  beats: number[];
  /** Beat indices that start a bar, ascending; null when the bar phase is unknown. */
  barStarts: number[] | null;
  boundaries?: PhraseBoundary[];
  duration: number;
  /** Prefix for labels, for example "Grid" or "Suggested". */
  source: string;
}

export function phraseCues({ beats, barStarts, boundaries = [], duration, source }: PhraseInput): PhraseCue[] {
  if (beats.length < REGION_BEATS + MIN_REGION_BEATS) {
    const len = Math.min(30, duration / 3);
    return [
      { kind: "entry", startSeconds: 0, endSeconds: round(len), label: `${source} intro (no reliable beat grid)` },
      { kind: "exit", startSeconds: round(duration - len), endSeconds: round(duration), label: `${source} outro (no reliable beat grid)` },
    ];
  }
  const period = (beats[beats.length - 1]! - beats[0]!) / (beats.length - 1);
  const bars = barStarts && barStarts.length > 0;
  // Phrase starts as beat indices, with their bar number (1-based) when bars are known.
  const phrases: { index: number; bar: number | null }[] = [];
  if (bars) {
    for (let k = 0; k < barStarts!.length; k += PHRASE_BARS) phrases.push({ index: barStarts![k]!, bar: k + 1 });
  } else {
    for (let i = 0; i < beats.length; i += REGION_BEATS) phrases.push({ index: i, bar: null });
  }
  const strong = boundaries.filter((b) => b.strength >= 0.3);
  const nearBoundary = (t: number) => strong.some((b) => Math.abs(b.seconds - t) <= period * 1.5);
  const endOf = (index: number) => (index + REGION_BEATS < beats.length ? beats[index + REGION_BEATS]! : duration);
  const where = (p: { index: number; bar: number | null }) => (p.bar === null ? `beat ${p.index + 1}` : `bar ${p.bar}`);
  const phase = bars ? "" : "; bar phase unknown";

  const entries = phrases
    .filter((p) => beats[p.index]! <= duration * ENTRY_ZONE && p.index + MIN_REGION_BEATS < beats.length)
    .slice(0, MAX_CANDIDATES)
    .map<PhraseCue>((p, i) => ({
      kind: "entry",
      startSeconds: round(beats[p.index]!),
      endSeconds: round(Math.min(duration, endOf(p.index))),
      label: `${source} ${i === 0 ? "intro" : "entry"} at ${where(p)}${nearBoundary(beats[p.index]!) ? ", section boundary" : ""}${phase}`,
    }));

  // Exits: phrase starts in the last part with room for a full region; section boundaries first.
  const room = phrases.filter((p) => beats[p.index]! >= duration * EXIT_ZONE && p.index + MIN_REGION_BEATS <= beats.length - 1);
  const ranked = [...room].sort((a, b) => Number(nearBoundary(beats[b.index]!)) - Number(nearBoundary(beats[a.index]!)) || b.index - a.index);
  let exitPhrases = ranked.slice(0, MAX_CANDIDATES).sort((a, b) => a.index - b.index);
  if (exitPhrases.length === 0) {
    const index = Math.max(0, beats.length - 1 - REGION_BEATS);
    exitPhrases = [{ index, bar: null }];
  }
  const exits = exitPhrases.map<PhraseCue>((p) => ({
    kind: "exit",
    startSeconds: round(beats[p.index]!),
    endSeconds: round(Math.min(duration, endOf(p.index))),
    label: `${source} outro at ${where(p)}${nearBoundary(beats[p.index]!) ? ", section boundary" : ""}${phase}`,
  }));

  return [...entries, ...exits].filter((c) => c.endSeconds > c.startSeconds && c.endSeconds <= duration + 1e-6);
}

/** Beat indices of the given bar-line times, matched to the nearest beat. */
export function barStartIndices(beats: number[], downbeats: number[]): number[] {
  const out: number[] = [];
  for (const d of downbeats) {
    const i = nearestIndex(beats, d);
    if (out[out.length - 1] !== i) out.push(i);
  }
  return out;
}
