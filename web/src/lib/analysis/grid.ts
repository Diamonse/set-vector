/**
 * Piecewise-constant tempo grids and beat-grid acceptance, ported from
 * `src/setvector/analysis/grid.py`, `rhythm.py`, and the thresholds in `identity.py`.
 */

export const GRID_TOLERANCE_SECONDS = 0.04;
export const GRID_ACCEPT_FRACTION = 0.9;
export const GRID_MIN_SPLIT_BEATS = 32;
export const GRID_MAX_SEGMENTS = 8;
export const MIN_BEATS = 32;
export const MAX_INTERVAL_CV = 0.15;
export const INTERVAL_GAP_RATIO = 1.5;
export const MIN_GRID_FIT = 0.9;
export const MIN_BAR_REGULARITY = 0.75;
export const BAR_LENGTHS = [3, 4];
export const BAR_PHASE_CONFIRM = 4;
const REFITS = 5;

export interface Segment {
  startSeconds: number;
  period: number;
  beatCount: number;
}

export interface GridFit {
  segments: Segment[];
  beats: number[];
  gridFit: number;
}

export const segmentBpm = (s: Segment) => 60 / s.period;
const segmentTimes = (s: Segment) => Array.from({ length: s.beatCount }, (_, i) => s.startSeconds + i * s.period);

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function diffs(times: number[]): number[] {
  return times.slice(1).map((t, i) => t - times[i]!);
}

/** Round half to even, as NumPy does. */
function roundEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

function referencePeriod(times: number[]): number {
  const intervals = diffs(times);
  const med = median(intervals);
  const typical = intervals.filter((d) => Math.abs(d / med - 1) < 0.25);
  return typical.length ? typical.reduce((a, b) => a + b, 0) / typical.length : med;
}

function initialIndices(times: number[]): number[] {
  const period = referencePeriod(times);
  const indices = new Array<number>(times.length).fill(0);
  let anchorTime = times[0]!;
  let anchorIndex = 0;
  for (let i = 1; i < times.length; i++) {
    const steps = (times[i]! - anchorTime) / period;
    indices[i] = anchorIndex + roundEven(steps);
    if (Math.abs(steps - roundEven(steps)) <= 0.25) {
      anchorTime = times[i]!;
      anchorIndex = indices[i]!;
    }
  }
  return indices;
}

function polyfit1(x: number[], y: number[]): [number, number] {
  const n = x.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i]!;
    sy += y[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return [slope, my - slope * mx];
}

interface Line {
  period: number;
  offset: number;
  indices: number[];
  keep: boolean[];
}

function fitLine(times: number[]): Line {
  let indices = initialIndices(times);
  let keep = times.map(() => true);
  let period = referencePeriod(times);
  let offset = times[0]!;
  for (let r = 0; r < REFITS; r++) {
    const kx = indices.filter((_, i) => keep[i]);
    if (new Set(kx).size < 2) break;
    const ky = times.filter((_, i) => keep[i]);
    const [slope, intercept] = polyfit1(kx, ky);
    if (slope <= 0) break;
    period = slope;
    offset = intercept;
    indices = times.map((t) => roundEven((t - offset) / period));
    keep = times.map((t, i) => Math.abs(t - (offset + period * indices[i]!)) <= GRID_TOLERANCE_SECONDS);
  }
  keep = times.map((t, i) => Math.abs(t - (offset + period * indices[i]!)) <= GRID_TOLERANCE_SECONDS);
  if (period <= 2 * GRID_TOLERANCE_SECONDS) keep = keep.map(() => false);
  return { period, offset, indices, keep };
}

const keepMean = (keep: boolean[]) => (keep.length ? keep.filter(Boolean).length / keep.length : 0);

function splitCost(times: number[]): number {
  const { period, offset, indices } = fitLine(times);
  let total = 0;
  times.forEach((t, i) => {
    total += Math.min(Math.abs(t - (offset + period * indices[i]!)), GRID_TOLERANCE_SECONDS) ** 2;
  });
  return total;
}

function bestSplit(times: number[], start: number, stop: number): number {
  const cost = (split: number) => splitCost(times.slice(start, split)) + splitCost(times.slice(split, stop));
  const lo = start + GRID_MIN_SPLIT_BEATS;
  const hi = stop - GRID_MIN_SPLIT_BEATS;
  const step = Math.max(1, Math.floor((hi - lo) / 64));
  const argmin = (candidates: number[]) => {
    let best = candidates[0]!;
    let bestCost = cost(best);
    for (const c of candidates.slice(1)) {
      const v = cost(c);
      if (v < bestCost) {
        bestCost = v;
        best = c;
      }
    }
    return best;
  };
  const coarse: number[] = [];
  for (let s = lo; s <= hi; s += step) coarse.push(s);
  const best = argmin(coarse);
  const fine: number[] = [];
  for (let s = Math.max(lo, best - step); s <= Math.min(hi, best + step); s++) fine.push(s);
  return argmin(fine);
}

function tidy(times: number[], input: [number, number][]): [number, number][] {
  let ranges = input;
  for (let round = 0; round < GRID_MAX_SEGMENTS; round++) {
    const merged: [number, number][] = [ranges[0]!];
    for (const [start, stop] of ranges.slice(1)) {
      const first = merged[merged.length - 1]![0];
      if (keepMean(fitLine(times.slice(first, stop)).keep) >= GRID_ACCEPT_FRACTION) merged[merged.length - 1] = [first, stop];
      else merged.push([start, stop]);
    }
    if (round && merged.length === ranges.length) break;
    for (let i = 1; i < merged.length; i++) {
      const first = merged[i - 1]![0];
      const last = merged[i]![1];
      if (last - first >= 2 * GRID_MIN_SPLIT_BEATS) {
        const split = bestSplit(times, first, last);
        merged[i - 1] = [first, split];
        merged[i] = [split, last];
      }
    }
    ranges = merged;
  }
  return ranges;
}

function splitRanges(times: number[]): [number, number][] {
  const pending: [number, number][] = [[0, times.length]];
  const accepted: [number, number][] = [];
  while (pending.length) {
    const [start, stop] = pending.shift()!;
    const keep = fitLine(times.slice(start, stop)).keep;
    const room = accepted.length + pending.length + 2 <= GRID_MAX_SEGMENTS;
    if (keepMean(keep) >= GRID_ACCEPT_FRACTION || stop - start < 2 * GRID_MIN_SPLIT_BEATS || !room) {
      accepted.push([start, stop]);
      continue;
    }
    const split = bestSplit(times, start, stop);
    pending.unshift([start, split], [split, stop]);
  }
  return tidy(times, accepted.sort((a, b) => a[0] - b[0]));
}

function closeGaps(segments: Segment[]): Segment[] {
  const closed: Segment[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const s = segments[i]!;
    const limit = segments[i + 1]!.startSeconds - s.period / 2;
    let count = s.beatCount;
    while (s.startSeconds + count * s.period < limit) count++;
    closed.push({ ...s, beatCount: count });
  }
  closed.push(segments[segments.length - 1]!);
  return closed;
}

export function fitGrid(input: number[], duration: number): GridFit | null {
  const times = [...new Set(input.filter(Number.isFinite))].sort((a, b) => a - b);
  if (times.length < 2) return null;
  const segments: Segment[] = [];
  let inliers = 0;
  let previousEnd = -Infinity;
  for (const [start, stop] of splitRanges(times)) {
    const { period, offset, indices, keep } = fitLine(times.slice(start, stop));
    if (!keep.some(Boolean)) continue;
    const minIndex = Math.min(...indices);
    const maxIndex = Math.max(...indices);
    const first = offset + period * minIndex;
    const candidates = Array.from({ length: maxIndex - minIndex + 1 }, (_, i) => first + i * period);
    const valid = candidates.map((c, i) => (c >= 0 && c > previousEnd + period / 2 ? i : -1)).filter((i) => i >= 0);
    if (valid.length === 0) continue;
    const startSeconds = candidates[valid[0]!]!;
    let count = 0;
    for (let i = 0; i < valid.length; i++) if (startSeconds + i * period <= duration) count = i + 1;
    if (count === 0) continue;
    inliers += keep.filter(Boolean).length;
    const segment = { startSeconds, period, beatCount: count };
    segments.push(segment);
    previousEnd = startSeconds + (count - 1) * period;
  }
  if (segments.length === 0) return null;
  const closed = closeGaps(segments);
  return { segments: closed, beats: closed.flatMap(segmentTimes), gridFit: inliers / times.length };
}

// ---------------------------------------------------------------- acceptance

export interface CandidateQuality {
  beatCount: number;
  intervalCv: number | null;
  gridFit: number | null;
  segmentCount: number;
  modalBarLength: number | null;
  barRegularity: number | null;
}

export interface RhythmCandidate {
  name: "beat_this" | "setvector_fallback";
  detected: number[];
  fit: GridFit | null;
  quality: CandidateQuality;
  /** 1-based position within the bar for each grid beat; null where bars are unknown. */
  barPositions: (number | null)[];
  reasons: string[];
}

function intervalCv(beats: number[]): number | null {
  let intervals = diffs(beats);
  if (intervals.length < 2) return null;
  const med = median(intervals);
  intervals = intervals.filter((d) => d < INTERVAL_GAP_RATIO * med);
  if (intervals.length < 2) return null;
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (mean <= 0) return null;
  const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
  return Math.sqrt(variance) / mean;
}

function nearest(times: number[], target: number): number {
  let lo = 0;
  let hi = times.length - 1;
  if (times.length === 1) return 0;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! < target) lo = mid;
    else hi = mid;
  }
  return Math.abs(times[lo]! - target) <= Math.abs(times[hi]! - target) ? lo : hi;
}

function downbeatIndices(beats: number[], downbeats: number[]): number[] {
  if (beats.length === 0 || downbeats.length === 0) return [];
  const tolerance = beats.length > 1 ? median(diffs(beats)) / 2 : Infinity;
  const idx = new Set<number>();
  for (const d of downbeats) {
    const i = nearest(beats, d);
    if (Math.abs(beats[i]! - d) <= tolerance) idx.add(i);
  }
  return [...idx].sort((a, b) => a - b);
}

function barStats(beats: number[], downbeats: number[]): [number | null, number | null] {
  const lengths = diffs(downbeatIndices(beats, downbeats));
  if (lengths.length === 0) return [null, null];
  const counts = new Map<number, number>();
  for (const l of lengths) counts.set(l, (counts.get(l) ?? 0) + 1);
  let modal = lengths[0]!;
  for (const [l, c] of counts) if (c > counts.get(modal)! || (c === counts.get(modal)! && l < modal)) modal = l;
  return [modal, counts.get(modal)! / lengths.length];
}

function barPositions(gridBeats: number[], downbeats: number[], modal: number): number[] {
  const indices = downbeatIndices(gridBeats, downbeats);
  const phases = indices.map((i) => i % modal);
  const confirmed: [number, number][] = [];
  let runStart = 0;
  for (let i = 1; i <= phases.length; i++) {
    if (i === phases.length || phases[i] !== phases[runStart]) {
      if (i - runStart >= BAR_PHASE_CONFIRM) confirmed.push([indices[runStart]!, phases[runStart]!]);
      runStart = i;
    }
  }
  if (confirmed.length === 0) {
    const counts = new Array<number>(modal).fill(0);
    phases.forEach((p) => counts[p]!++);
    confirmed.push([0, counts.indexOf(Math.max(...counts))]);
  }
  const changes: [number, number][] = [[0, confirmed[0]![1]]];
  for (const [index, phase] of confirmed.slice(1)) if (phase !== changes[changes.length - 1]![1]) changes.push([index, phase]);
  const positions: number[] = [];
  let current = 0;
  for (let i = 0; i < gridBeats.length; i++) {
    while (current + 1 < changes.length && i >= changes[current + 1]![0]) current++;
    positions.push((((i - changes[current]![1]) % modal) + modal) % modal + 1);
  }
  return positions;
}

const fmt = (v: number | null) => (v === null ? "n/a" : v.toFixed(2));

/** Fit, score, and explain one detector's beats, as `rhythm._evaluate`. */
export function evaluateCandidate(
  name: RhythmCandidate["name"],
  detectedInput: number[],
  downbeats: number[] | null,
  duration: number,
): RhythmCandidate {
  const detected = [...new Set(detectedInput.filter(Number.isFinite))].sort((a, b) => a - b);
  const fit = fitGrid(detected, duration);
  const barBeats = fit ? fit.beats : detected;
  const [modal, regularity] = downbeats === null ? [null, null] : barStats(barBeats, downbeats);
  const quality: CandidateQuality = {
    beatCount: detected.length,
    intervalCv: intervalCv(detected),
    gridFit: fit ? fit.gridFit : null,
    segmentCount: fit ? fit.segments.length : 0,
    modalBarLength: modal,
    barRegularity: regularity,
  };
  const reasons: string[] = [];
  if (detected.length < MIN_BEATS) reasons.push(`${name}: ${detected.length} beats, fewer than ${MIN_BEATS}`);
  if (quality.intervalCv === null || quality.intervalCv > MAX_INTERVAL_CV) {
    reasons.push(`${name}: beat intervals vary too much (CV ${fmt(quality.intervalCv)})`);
  }
  if (quality.gridFit === null || quality.gridFit < MIN_GRID_FIT) {
    reasons.push(`${name}: only ${fmt(quality.gridFit)} of beats fit a steady grid`);
  }
  if (downbeats !== null) {
    if (modal === null) reasons.push(`${name}: no bars detected`);
    else if (!BAR_LENGTHS.includes(modal)) reasons.push(`${name}: usual bar length is ${modal} beats, not 3 or 4`);
    else if (regularity! < MIN_BAR_REGULARITY) reasons.push(`${name}: only ${regularity!.toFixed(2)} of bars have ${modal} beats`);
  }
  let positions: (number | null)[] = [];
  if (fit) {
    positions = reasons.length === 0 && downbeats !== null && modal !== null ? barPositions(fit.beats, downbeats, modal) : fit.beats.map(() => null);
  }
  return { name, detected, fit, quality, barPositions: positions, reasons };
}
