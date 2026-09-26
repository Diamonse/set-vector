import { fft, hannPeriodic } from "./fft";
import { resample } from "./resample";

/**
 * Beat This! front end and post-processing, ported from
 * `src/setvector/analysis/beat_this/_inference.py` and `__init__.py`. The network itself
 * runs through an injected `BeatRunner` (ONNX Runtime Web in the browser).
 */

export const MODEL_FPS = 50;
export const MODEL_SAMPLE_RATE = 22_050;
export const N_FFT = 1024;
export const HOP_LENGTH = 441;
export const F_MIN = 30;
export const F_MAX = 11_000;
export const N_MELS = 128;
export const CHUNK_FRAMES = 1500;
export const BORDER_FRAMES = 6;
export const PEAK_WINDOW_FRAMES = 7;

/** Runs the network on one `(1, frames, 128)` spectrogram chunk (at most 1,500 frames), returning per-frame logits. */
export type BeatRunner = (chunk: Float32Array, frames: number) => Promise<{ beat: Float32Array; downbeat: Float32Array }>;

function hzToMel(f: number): number {
  const fSp = 200 / 3;
  const minLogHz = 1000;
  const minLogMel = minLogHz / fSp;
  const logstep = Math.log(6.4) / 27;
  return f >= minLogHz ? minLogMel + Math.log(f / minLogHz) / logstep : f / fSp;
}

function melToHz(m: number): number {
  const fSp = 200 / 3;
  const minLogHz = 1000;
  const minLogMel = minLogHz / fSp;
  const logstep = Math.log(6.4) / 27;
  return m >= minLogMel ? minLogHz * Math.exp(logstep * (m - minLogMel)) : fSp * m;
}

let cachedBank: Float64Array[] | null = null;

/** `librosa.filters.mel(sr=22050, n_fft=1024, n_mels=128, fmin=30, fmax=11000, htk=False, norm=None)`. */
export function melFilterbank(): Float64Array[] {
  if (cachedBank) return cachedBank;
  const bins = N_FFT / 2 + 1;
  const fftFreqs = Array.from({ length: bins }, (_, k) => (k * (MODEL_SAMPLE_RATE / 2)) / (bins - 1));
  const minMel = hzToMel(F_MIN);
  const maxMel = hzToMel(F_MAX);
  const melF = Array.from({ length: N_MELS + 2 }, (_, i) => melToHz(minMel + ((maxMel - minMel) * i) / (N_MELS + 1)));
  const bank: Float64Array[] = [];
  for (let i = 0; i < N_MELS; i++) {
    const row = new Float64Array(bins);
    const lowDiff = melF[i + 1]! - melF[i]!;
    const highDiff = melF[i + 2]! - melF[i + 1]!;
    for (let k = 0; k < bins; k++) {
      const lower = -(melF[i]! - fftFreqs[k]!) / lowDiff;
      const upper = (melF[i + 2]! - fftFreqs[k]!) / highDiff;
      row[k] = Math.max(0, Math.min(lower, upper));
    }
    bank.push(row);
  }
  cachedBank = bank;
  return bank;
}

/** `(frames, 128)` log-mel spectrogram (row-major) of mono samples, at 50 frames per second. */
export function logMel(samples: Float32Array, sampleRate: number): { data: Float32Array; frames: number } {
  const x = sampleRate === MODEL_SAMPLE_RATE ? samples : resample(samples, sampleRate, MODEL_SAMPLE_RATE);
  const pad = N_FFT / 2;
  const n = x.length;
  // Reflect padding as torch.stft(center=True, pad_mode="reflect").
  const at = (i: number): number => {
    let j = i - pad;
    if (n === 1) return x[0]!;
    while (j < 0 || j >= n) j = j < 0 ? -j : 2 * (n - 1) - j;
    return x[j]!;
  };
  const frames = 1 + Math.floor(n / HOP_LENGTH);
  const window = hannPeriodic(N_FFT);
  const norm = 1 / Math.sqrt(N_FFT);
  const bank = melFilterbank();
  const bins = N_FFT / 2 + 1;
  const bandRange = bank.map((row) => {
    let lo = 0;
    while (lo < bins && row[lo] === 0) lo++;
    let hi = bins - 1;
    while (hi > lo && row[hi] === 0) hi--;
    return [lo, hi] as const;
  });
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  const mag = new Float64Array(bins);
  const out = new Float32Array(frames * N_MELS);
  for (let f = 0; f < frames; f++) {
    const start = f * HOP_LENGTH;
    for (let i = 0; i < N_FFT; i++) {
      re[i] = at(start + i) * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < bins; k++) mag[k] = Math.hypot(re[k]!, im[k]!) * norm;
    for (let m = 0; m < N_MELS; m++) {
      const [lo, hi] = bandRange[m]!;
      const row = bank[m]!;
      let acc = 0;
      for (let k = lo; k <= hi; k++) acc += mag[k]! * row[k]!;
      out[f * N_MELS + m] = Math.log1p(1000 * acc);
    }
  }
  return { data: out, frames };
}

/**
 * Per-frame logits over the whole spectrogram with 1,500-frame chunks overlapping by
 * `BORDER_FRAMES`, discarding borders and letting earlier chunks win overlaps, as
 * `frame_logits`.
 */
export async function frameLogits(
  spect: { data: Float32Array; frames: number },
  runner: BeatRunner,
  onProgress?: (fraction: number) => void,
): Promise<{ beat: Float32Array; downbeat: Float32Array }> {
  const size = spect.frames;
  const step = CHUNK_FRAMES - 2 * BORDER_FRAMES;
  const starts: number[] = [];
  for (let s = -BORDER_FRAMES; s < size - BORDER_FRAMES; s += step) starts.push(s);
  if (size > step) starts[starts.length - 1] = size - (CHUNK_FRAMES - BORDER_FRAMES);
  const beat = new Float32Array(size).fill(-1000);
  const downbeat = new Float32Array(size).fill(-1000);
  let done = 0;
  for (const start of starts.slice().reverse()) {
    // As F.pad(spect[max(start, 0):min(start + CHUNK, size)], left, right): the chunk is
    // shorter than CHUNK_FRAMES when the whole track is.
    const from = Math.max(start, 0);
    const to = Math.min(start + CHUNK_FRAMES, size);
    const left = Math.max(0, -start);
    const right = Math.max(0, Math.min(BORDER_FRAMES, start + CHUNK_FRAMES - size));
    const length = left + (to - from) + right;
    const chunk = new Float32Array(length * N_MELS);
    chunk.set(spect.data.subarray(from * N_MELS, to * N_MELS), left * N_MELS);
    const pred = await runner(chunk, length);
    for (let f = BORDER_FRAMES; f < length - BORDER_FRAMES; f++) {
      const dst = start + f;
      if (dst < 0 || dst >= size) continue;
      beat[dst] = pred.beat[f]!;
      downbeat[dst] = pred.downbeat[f]!;
    }
    done++;
    onProgress?.(done / starts.length);
  }
  return { beat, downbeat };
}

/** Frames that are the maximum within ±3 frames with logit above 0, adjacent frames merged. */
export function peakFrames(logits: Float32Array): number[] {
  const n = logits.length;
  const half = Math.floor(PEAK_WINDOW_FRAMES / 2);
  const peaks: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = logits[i]!;
    if (!(v > 0)) continue;
    let isMax = true;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      if (logits[j]! > v) {
        isMax = false;
        break;
      }
    }
    if (isMax) peaks.push(i);
  }
  const merged: number[] = [];
  let group: number[] = [];
  for (const p of peaks) {
    if (group.length && p - group[group.length - 1]! > 1) {
      merged.push(group.reduce((a, b) => a + b, 0) / group.length);
      group = [];
    }
    group.push(p);
  }
  if (group.length) merged.push(group.reduce((a, b) => a + b, 0) / group.length);
  return merged;
}

/** Upstream's minimal postprocessor: beat and downbeat times, downbeats moved to their nearest beat. */
export function pickPeaks(beat: Float32Array, downbeat: Float32Array): { beats: number[]; downbeats: number[] } {
  const beats = peakFrames(beat).map((f) => f / MODEL_FPS);
  let downbeats = peakFrames(downbeat).map((f) => f / MODEL_FPS);
  if (beats.length && downbeats.length) {
    const snapped = new Set<number>();
    for (const d of downbeats) {
      let best = 0;
      for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i]! - d) < Math.abs(beats[best]! - d)) best = i;
      snapped.add(beats[best]!);
    }
    downbeats = [...snapped].sort((a, b) => a - b);
  }
  return { beats, downbeats };
}

/** Move each peak time to the vertex of a parabola through its neighbouring logits. */
export function refinePeakTimes(times: number[], activation: Float32Array): number[] {
  return times.map((time) => {
    const frame = Math.round(time * MODEL_FPS);
    if (!(frame > 0 && frame < activation.length - 1)) return time;
    const left = activation[frame - 1]!;
    const peak = activation[frame]!;
    const right = activation[frame + 1]!;
    if (peak <= left || peak <= right) return time;
    const offset = (0.5 * (left - right)) / (left - 2 * peak + right);
    return (frame + Math.min(0.5, Math.max(-0.5, offset))) / MODEL_FPS;
  });
}

export async function detectBeats(
  samples: Float32Array,
  sampleRate: number,
  runner: BeatRunner,
  onProgress?: (fraction: number) => void,
): Promise<{ beats: number[]; downbeats: number[] }> {
  const spect = logMel(samples, sampleRate);
  const logits = await frameLogits(spect, runner, onProgress);
  const { beats, downbeats } = pickPeaks(logits.beat, logits.downbeat);
  return { beats: refinePeakTimes(beats, logits.beat), downbeats };
}
