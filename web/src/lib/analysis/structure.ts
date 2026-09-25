import type { BaselineFrames } from "./features";
import type { Chromagram } from "./key";

/**
 * Section boundary candidates from beat-synchronous novelty, and entry and exit region
 * suggestions. A boundary is where the music changes; it is not a verified phrase, drop,
 * or safe mix point, and every suggestion is saved as an estimate pending review.
 */

export const REGION_BEATS = 32;
export const MIN_REGION_BEATS = 16;
export const KERNEL_BEATS = 16;
const FALLBACK_STEP_SECONDS = 0.5;

export interface Boundary {
  seconds: number;
  strength: number;
}

export interface CueSuggestion {
  kind: "entry" | "exit";
  startSeconds: number;
  endSeconds: number;
  label: string;
}

function meanOver(times: Float64Array, values: Float64Array, start: number, end: number): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < times.length; i++) {
    const t = times[i]!;
    if (t < start) continue;
    if (t >= end) break;
    const v = values[i]!;
    if (Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  return n ? sum / n : NaN;
}

/** Feature vectors per unit: 12 chroma bins, log RMS, spectral centroid, bass ratio. */
function unitFeatures(edges: number[], frames: BaselineFrames, chroma: Chromagram): number[][] {
  const vectors: number[][] = [];
  for (let u = 0; u < edges.length - 1; u++) {
    const start = edges[u]!;
    const end = edges[u + 1]!;
    const v = new Array<number>(15).fill(0);
    let count = 0;
    for (let f = 0; f < chroma.frames; f++) {
      const t = (f + 0.5) * chroma.secondsPerFrame;
      if (t < start || t >= end || !chroma.voiced[f]) continue;
      for (let c = 0; c < 12; c++) v[c] = v[c]! + chroma.data[f * 12 + c]!;
      count++;
    }
    if (count) for (let c = 0; c < 12; c++) v[c] = v[c]! / count;
    v[12] = Math.log10(meanOver(frames.timestamps, frames.rms, start, end) + 1e-6);
    v[13] = meanOver(frames.timestamps, frames.centroid, start, end) / 1000;
    v[14] = meanOver(frames.timestamps, frames.bassRatio, start, end);
    vectors.push(v.map((x) => (Number.isFinite(x) ? x : 0)));
  }
  // Standardize each dimension so no feature dominates by scale.
  for (let d = 0; d < 15; d++) {
    const col = vectors.map((v) => v[d]!);
    const mean = col.reduce((a, b) => a + b, 0) / Math.max(1, col.length);
    const std = Math.sqrt(col.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, col.length)) || 1;
    vectors.forEach((v) => (v[d] = (v[d]! - mean) / std));
  }
  return vectors;
}

/** Foote novelty: a Gaussian-tapered checkerboard kernel slid along the cosine self-similarity diagonal. */
function novelty(vectors: number[][], half: number): Float64Array {
  const n = vectors.length;
  const norms = vectors.map((v) => Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1);
  const sim = (i: number, j: number) => {
    let dot = 0;
    const a = vectors[i]!;
    const b = vectors[j]!;
    for (let d = 0; d < a.length; d++) dot += a[d]! * b[d]!;
    return dot / (norms[i]! * norms[j]!);
  };
  const out = new Float64Array(n);
  const sigma = half / 2;
  for (let c = 0; c < n; c++) {
    let acc = 0;
    let weight = 0;
    for (let i = -half; i < half; i++) {
      for (let j = -half; j < half; j++) {
        const a = c + i;
        const b = c + j;
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const sign = (i < 0) === (j < 0) ? 1 : -1;
        const g = Math.exp(-((i + 0.5) ** 2 + (j + 0.5) ** 2) / (2 * sigma * sigma));
        acc += sign * g * sim(a, b);
        weight += g;
      }
    }
    out[c] = weight > 0 ? Math.max(0, acc / weight) : 0;
  }
  return out;
}

export function findBoundaries(beats: number[], duration: number, frames: BaselineFrames, chroma: Chromagram): Boundary[] {
  const usesBeats = beats.length >= 2 * KERNEL_BEATS;
  const edges = usesBeats
    ? [...beats, Math.min(duration, beats[beats.length - 1]! + (beats[beats.length - 1]! - beats[beats.length - 2]!))]
    : Array.from({ length: Math.floor(duration / FALLBACK_STEP_SECONDS) + 1 }, (_, i) => i * FALLBACK_STEP_SECONDS);
  if (edges.length < 2 * KERNEL_BEATS) return [];
  const vectors = unitFeatures(edges, frames, chroma);
  const curve = novelty(vectors, KERNEL_BEATS);
  const sorted = Array.from(curve).sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const peaks: Boundary[] = [];
  for (let i = KERNEL_BEATS / 2; i < curve.length - KERNEL_BEATS / 2; i++) {
    const v = curve[i]!;
    if (v <= 0 || v < threshold) continue;
    let isMax = true;
    for (let j = Math.max(0, i - KERNEL_BEATS / 2); j <= Math.min(curve.length - 1, i + KERNEL_BEATS / 2); j++) {
      if (curve[j]! > v) isMax = false;
    }
    if (isMax) peaks.push({ seconds: edges[i]!, strength: v });
  }
  const max = Math.max(...peaks.map((p) => p.strength), 0);
  return peaks.map((p) => ({ seconds: p.seconds, strength: max > 0 ? p.strength / max : 0 }));
}

function nearestIndex(beats: number[], t: number): number {
  let best = 0;
  for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i]! - t) < Math.abs(beats[best]! - t)) best = i;
  return best;
}

/**
 * One entry region at the start of the grid and one exit region at the last strong
 * boundary in the final third, each 32 beats where the track allows. Without a grid,
 * 30 s windows at the start and end are suggested instead.
 */
export function suggestCues(beats: number[], downbeats: number[], boundaries: Boundary[], duration: number): CueSuggestion[] {
  const out: CueSuggestion[] = [];
  const round = (x: number) => Math.round(x * 1000) / 1000;
  if (beats.length < REGION_BEATS + MIN_REGION_BEATS) {
    const len = Math.min(30, duration / 3);
    out.push({ kind: "entry", startSeconds: 0, endSeconds: round(len), label: "Suggested intro (no reliable beat grid)" });
    out.push({ kind: "exit", startSeconds: round(duration - len), endSeconds: round(duration), label: "Suggested outro (no reliable beat grid)" });
    return out;
  }
  const firstBar = downbeats.length ? nearestIndex(beats, downbeats[0]!) : 0;
  const entryStart = firstBar;
  const entryEnd = Math.min(beats.length - 1, entryStart + REGION_BEATS);
  out.push({
    kind: "entry",
    startSeconds: round(beats[entryStart]!),
    endSeconds: round(beats[entryEnd]!),
    label: `Suggested intro, ${entryEnd - entryStart} beats from the ${downbeats.length ? "first downbeat" : "first beat"}`,
  });

  const latest = duration - (MIN_REGION_BEATS * (beats[beats.length - 1]! - beats[0]!)) / (beats.length - 1);
  const candidates = boundaries
    .filter((b) => b.seconds >= duration * 0.6 && b.seconds <= latest && b.strength >= 0.3)
    .sort((a, b) => b.seconds - a.seconds);
  let exitStart: number;
  let label: string;
  if (candidates.length) {
    exitStart = nearestIndex(beats, candidates[0]!.seconds);
    label = "Suggested outro from the last estimated section boundary";
  } else {
    exitStart = Math.max(entryEnd, beats.length - 1 - REGION_BEATS);
    label = "Suggested outro, last 32 beats (no section boundary found)";
  }
  const exitEnd = Math.min(beats.length - 1, exitStart + REGION_BEATS);
  const exitEndSeconds = exitEnd > exitStart ? beats[exitEnd]! : duration;
  out.push({ kind: "exit", startSeconds: round(beats[exitStart]!), endSeconds: round(Math.min(duration, exitEndSeconds)), label });
  return out.filter((c) => c.endSeconds > c.startSeconds && c.endSeconds <= duration + 1e-6);
}
