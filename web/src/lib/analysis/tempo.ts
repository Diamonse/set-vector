import { fft } from "./fft";

/**
 * Tempo and fallback beat tracking on an onset envelope, ported from the librosa 0.11
 * routines the CLI calls: a time-averaged autocorrelation tempogram over 8 s windows,
 * `librosa.feature.tempo`'s log-normal prior around 120 BPM, and `beat_track`'s
 * dynamic-programming tracker (tightness 100, no trimming).
 */

export interface TempoCandidate {
  bpm: number;
  /** Mean normalized autocorrelation at this lag, 0 to 1. A diagnostic, not a probability. */
  strength: number;
  relation: "primary" | "double" | "half" | "peak";
}

export interface TempoEstimate {
  bpm: number;
  candidates: TempoCandidate[];
  /** Mean tempogram by lag; index 0 is lag 0. */
  tempogram: Float64Array;
  framesPerSecond: number;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** `librosa.time_to_frames(8.0, sr, hop)`. */
export function tempogramWindow(sampleRate: number, hopLength: number, seconds = 8): number {
  return Math.floor(Math.floor(seconds * sampleRate) / hopLength);
}

/**
 * Mean of librosa's autocorrelation tempogram columns, matching the CLI's
 * `_mean_tempogram`: linear-ramp padding by half a window, Hann-weighted windows,
 * each column's autocorrelation divided by its lag-0 value.
 */
export function meanTempogram(onset: Float64Array, sampleRate: number, hopLength: number): Float64Array {
  const win = tempogramWindow(sampleRate, hopLength);
  const padW = Math.floor(win / 2);
  const n = onset.length;
  const padded = new Float64Array(n + 2 * padW);
  // np.pad(mode="linear_ramp", end_values=0): ramps from 0 to the edge value.
  const first = onset[0] ?? 0;
  const last = onset[n - 1] ?? 0;
  for (let i = 0; i < padW; i++) {
    padded[i] = (first * i) / padW;
    padded[n + 2 * padW - 1 - i] = (last * i) / padW;
  }
  padded.set(onset, padW);

  // scipy.signal.get_window("hann", win) is periodic.
  const window = new Float64Array(win);
  for (let i = 0; i < win; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win);

  const size = nextPow2(2 * win);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const total = new Float64Array(win);
  const columns = n; // center=False over the padded envelope yields n columns
  for (let c = 0; c < columns; c++) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < win; i++) re[i] = (padded[c + i] ?? 0) * window[i]!;
    fft(re, im);
    for (let k = 0; k < size; k++) {
      re[k] = re[k]! * re[k]! + im[k]! * im[k]!;
      im[k] = 0;
    }
    // Inverse FFT of a real, even power spectrum: forward FFT and divide by size.
    fft(re, im);
    const zero = re[0]! / size;
    if (zero > 0) {
      let peak = 0;
      for (let k = 0; k < win; k++) peak = Math.max(peak, Math.abs(re[k]! / size));
      if (peak > 0) for (let k = 0; k < win; k++) total[k] = total[k]! + re[k]! / size / peak;
    }
  }
  for (let k = 0; k < win; k++) total[k] = total[k]! / Math.max(1, columns);
  return total;
}

function lagToBpm(lag: number, framesPerSecond: number): number {
  return lag === 0 ? Infinity : (60 * framesPerSecond) / lag;
}

export function estimateTempo(onset: Float64Array, sampleRate: number, hopLength: number, startBpm = 120, maxTempo = 320): TempoEstimate | null {
  let any = false;
  for (let i = 0; i < onset.length; i++) if (onset[i]! !== 0) any = true;
  if (!any) return null;
  const fps = sampleRate / hopLength;
  const tg = meanTempogram(onset, sampleRate, hopLength);
  let best = -1;
  let bestScore = -Infinity;
  for (let lag = 1; lag < tg.length; lag++) {
    const bpm = lagToBpm(lag, fps);
    if (bpm >= maxTempo) continue;
    const prior = -0.5 * ((Math.log2(bpm) - Math.log2(startBpm)) / 1.0) ** 2;
    const score = Math.log1p(1e6 * tg[lag]!) + prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  if (best < 0) return null;
  const bpm = lagToBpm(best, fps);

  const strengthAt = (target: number) => {
    const lag = Math.round((60 * fps) / target);
    return lag > 0 && lag < tg.length ? tg[lag]! : 0;
  };
  const candidates: TempoCandidate[] = [{ bpm, strength: tg[best]!, relation: "primary" }];
  if (bpm * 2 <= 250) candidates.push({ bpm: bpm * 2, strength: strengthAt(bpm * 2), relation: "double" });
  if (bpm / 2 >= 40) candidates.push({ bpm: bpm / 2, strength: strengthAt(bpm / 2), relation: "half" });
  // Other strong autocorrelation peaks within 60 to 200 BPM that are not octave relatives.
  const peaks: { lag: number; v: number }[] = [];
  for (let lag = 2; lag < tg.length - 1; lag++) {
    const b = lagToBpm(lag, fps);
    if (b < 60 || b > 200) continue;
    if (tg[lag]! > tg[lag - 1]! && tg[lag]! >= tg[lag + 1]!) peaks.push({ lag, v: tg[lag]! });
  }
  peaks.sort((a, b) => b.v - a.v);
  for (const p of peaks) {
    const b = lagToBpm(p.lag, fps);
    const related = candidates.some((c) => Math.abs(Math.log2(b / c.bpm)) < 0.03);
    if (!related) candidates.push({ bpm: b, strength: p.v, relation: "peak" });
    if (candidates.length >= 5) break;
  }
  return { bpm, candidates, tempogram: tg, framesPerSecond: fps };
}

/** librosa's `__beat_tracker` without trimming. Returns beat frame indices. */
export function trackBeats(onset: Float64Array, bpm: number, framesPerSecond: number, tightness = 100): number[] {
  const n = onset.length;
  if (n === 0 || !(bpm > 0)) return [];
  const period = Math.round((framesPerSecond * 60) / bpm);
  if (period < 1) return [];

  // Normalize by the sample standard deviation.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += onset[i]!;
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (onset[i]! - mean) ** 2;
  const std = n > 1 ? Math.sqrt(variance / (n - 1)) : 0;
  const norm = new Float64Array(n);
  const denom = std + 1e-300;
  for (let i = 0; i < n; i++) norm[i] = onset[i]! / denom;

  // Local score: convolution with a Gaussian of width period / 32, "same" mode.
  const half = period;
  const kernel = new Float64Array(2 * half + 1);
  for (let j = -half; j <= half; j++) kernel[j + half] = Math.exp(-0.5 * ((j * 32) / period) ** 2);
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = -half; j <= half; j++) {
      const idx = i - j;
      if (idx >= 0 && idx < n) acc += norm[idx]! * kernel[j + half]!;
    }
    local[i] = acc;
  }

  let localMax = -Infinity;
  for (let i = 0; i < n; i++) localMax = Math.max(localMax, local[i]!);
  const threshold = 0.01 * localMax;
  const backlink = new Int32Array(n).fill(-1);
  const cumscore = new Float64Array(n);
  cumscore[0] = local[0]!;
  let firstBeat = true;
  const logPeriod = Math.log(period);
  const nearest = Math.round(period / 2);
  for (let i = 1; i < n; i++) {
    let bestScore = -Infinity;
    let beatLocation = -1;
    for (let loc = i - nearest; loc > i - 2 * period - 1; loc--) {
      if (loc < 0) break;
      const score = cumscore[loc]! - tightness * (Math.log(i - loc) - logPeriod) ** 2;
      if (score > bestScore) {
        bestScore = score;
        beatLocation = loc;
      }
    }
    cumscore[i] = beatLocation >= 0 ? local[i]! + bestScore : local[i]!;
    if (firstBeat && local[i]! < threshold) backlink[i] = -1;
    else {
      backlink[i] = beatLocation;
      firstBeat = false;
    }
  }

  // Last beat: the last local maximum of the cumulative score above half their median.
  const isMax = (i: number) => {
    const left = i > 0 ? cumscore[i - 1]! : cumscore[i]!;
    const right = i < n - 1 ? cumscore[i + 1]! : cumscore[i]!;
    return cumscore[i]! > left && cumscore[i]! >= right;
  };
  const maxima: number[] = [];
  for (let i = 0; i < n; i++) if (isMax(i)) maxima.push(cumscore[i]!);
  if (maxima.length === 0) return [];
  maxima.sort((a, b) => a - b);
  const mid = Math.floor(maxima.length / 2);
  const median = maxima.length % 2 ? maxima[mid]! : (maxima[mid - 1]! + maxima[mid]!) / 2;
  let tail = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (isMax(i) && cumscore[i]! >= 0.5 * median) {
      tail = i;
      break;
    }
  }
  if (tail < 0) return [];
  const beats: number[] = [];
  for (let i = tail; i >= 0; i = backlink[i]!) {
    beats.push(i);
    if (backlink[i]! < 0) break;
  }
  return beats.reverse();
}
