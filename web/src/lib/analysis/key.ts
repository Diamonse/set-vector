import { fft, hannPeriodic } from "./fft";

/**
 * Chroma and major/minor template ranking. The correlation margin between the best and
 * second-best key is an algorithm diagnostic, not a probability that the label is right.
 */

export const CHROMA_N_FFT = 4096;
export const CHROMA_HOP = 2048;
export const CHROMA_F_MIN = 65;
export const CHROMA_F_MAX = 2100;
/** Provisional abstention thresholds; to be set from reviewed keys (see the evaluation plan). */
export const MIN_KEY_CORRELATION = 0.5;
export const MIN_KEY_MARGIN = 0.02;
export const MIN_TONAL_FRAMES_SHARE = 0.2;

export type KeyProfileName = "krumhansl-kessler" | "temperley";

const PROFILES: Record<KeyProfileName, { major: number[]; minor: number[] }> = {
  "krumhansl-kessler": {
    major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
  },
  temperley: {
    major: [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0],
    minor: [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0],
  },
};

export interface Chromagram {
  /** Row-major `frames x 12`, each frame scaled to a maximum of 1 (zeros when silent). */
  data: Float64Array;
  frames: number;
  secondsPerFrame: number;
  /** Frames with enough energy to carry pitch information. */
  voiced: Uint8Array;
}

/** STFT chroma of mono audio: bin energies folded onto the nearest pitch class, then square-rooted. */
export function chromagram(samples: Float32Array, sampleRate: number): Chromagram {
  const n = CHROMA_N_FFT;
  const frames = samples.length < n ? 0 : 1 + Math.floor((samples.length - n) / CHROMA_HOP);
  const window = hannPeriodic(n);
  const bins: { k: number; pc: number; w: number }[] = [];
  for (let k = 1; k <= n / 2; k++) {
    const f = (k * sampleRate) / n;
    if (f < CHROMA_F_MIN || f > CHROMA_F_MAX) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    const nearest = Math.round(midi);
    const w = 1 - 2 * Math.abs(midi - nearest);
    if (w > 0) bins.push({ k, pc: ((nearest % 12) + 12) % 12, w });
  }
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const data = new Float64Array(frames * 12);
  const energy = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const start = f * CHROMA_HOP;
    let e = 0;
    for (let i = 0; i < n; i++) {
      const s = samples[start + i]!;
      e += s * s;
      re[i] = s * window[i]!;
      im[i] = 0;
    }
    energy[f] = e / n;
    fft(re, im);
    const row = f * 12;
    for (const b of bins) data[row + b.pc] = data[row + b.pc]! + b.w * (re[b.k]! * re[b.k]! + im[b.k]! * im[b.k]!);
    // Square root keeps tonal peaks dominant over broadband noise while limiting the
    // pull of a single loud note.
    for (let c = 0; c < 12; c++) data[row + c] = Math.sqrt(data[row + c]!);
    let max = 0;
    for (let c = 0; c < 12; c++) max = Math.max(max, data[row + c]!);
    if (max > 0) for (let c = 0; c < 12; c++) data[row + c] = data[row + c]! / max;
  }
  // Frames quieter than 40 dB below the track's loudest 10% are treated as silent.
  const sorted = Array.from(energy).sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const voiced = new Uint8Array(frames);
  for (let f = 0; f < frames; f++) voiced[f] = energy[f]! > loud * 1e-4 && energy[f]! > 1e-10 ? 1 : 0;
  return { data, frames, secondsPerFrame: CHROMA_HOP / sampleRate, voiced };
}

export interface KeyScore {
  tonic: number;
  mode: "major" | "minor";
  correlation: number;
}

export interface KeyEstimate {
  tonic: number | null;
  mode: "major" | "minor" | null;
  status: "estimated" | "uncertain";
  correlation: number;
  margin: number;
  voicedShare: number;
  ranking: KeyScore[];
  profile: KeyProfileName;
  reasons: string[];
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/** Rank the 24 major and minor keys for a 12-bin pitch-class profile. */
export function rankKeys(profile: number[], name: KeyProfileName = "krumhansl-kessler"): KeyScore[] {
  const templates = PROFILES[name];
  const scores: KeyScore[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ["major", "minor"] as const) {
      const t = templates[mode];
      const rotated = Array.from({ length: 12 }, (_, pc) => t[(pc - tonic + 12) % 12]!);
      scores.push({ tonic, mode, correlation: pearson(profile, rotated) });
    }
  }
  return scores.sort((a, b) => b.correlation - a.correlation);
}

/** Estimate the key over `[startSeconds, endSeconds)`, or the whole track when omitted. */
export function estimateKey(chroma: Chromagram, startSeconds = 0, endSeconds = Infinity, name: KeyProfileName = "krumhansl-kessler"): KeyEstimate {
  const sum = new Array<number>(12).fill(0);
  let voiced = 0;
  let total = 0;
  for (let f = 0; f < chroma.frames; f++) {
    const t = f * chroma.secondsPerFrame;
    if (t < startSeconds || t >= endSeconds) continue;
    total++;
    if (!chroma.voiced[f]) continue;
    voiced++;
    for (let c = 0; c < 12; c++) sum[c] = sum[c]! + chroma.data[f * 12 + c]!;
  }
  const voicedShare = total ? voiced / total : 0;
  const reasons: string[] = [];
  if (voiced === 0) {
    return { tonic: null, mode: null, status: "uncertain", correlation: 0, margin: 0, voicedShare, ranking: [], profile: name, reasons: ["no pitched audio in the region"] };
  }
  const ranking = rankKeys(sum, name);
  const best = ranking[0]!;
  const margin = best.correlation - ranking[1]!.correlation;
  if (best.correlation < MIN_KEY_CORRELATION) reasons.push(`best template correlation ${best.correlation.toFixed(2)} is below ${MIN_KEY_CORRELATION}`);
  if (margin < MIN_KEY_MARGIN) reasons.push(`the top two keys differ by only ${margin.toFixed(3)}`);
  if (voicedShare < MIN_TONAL_FRAMES_SHARE) reasons.push(`only ${(voicedShare * 100).toFixed(0)}% of the region has pitched audio`);
  return {
    tonic: best.tonic,
    mode: best.mode,
    status: reasons.length ? "uncertain" : "estimated",
    correlation: best.correlation,
    margin,
    voicedShare,
    ranking: ranking.slice(0, 5),
    profile: name,
    reasons,
  };
}
