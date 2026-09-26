import { hanningSymmetric, magnitudeSpectrum, rfftFrequencies } from "./fft";

/**
 * Port of `src/setvector/analysis/baseline.py` frame measurements for mono audio.
 * Frames hold exactly `frameLength` samples, start every `hopLength` samples, and
 * are neither centered nor padded; a final partial window is omitted.
 */

export const BASS_CUTOFF_HZ = 250;
export const BEAT_ONSET_BAND_HZ = 150;

export interface BaselineConfig {
  frameLength: number;
  hopLength: number;
}

export const DEFAULT_BASELINE_CONFIG: BaselineConfig = { frameLength: 2048, hopLength: 512 };

export interface BaselineFrames {
  sampleRate: number;
  frameLength: number;
  hopLength: number;
  frameCount: number;
  omittedTailSamples: number;
  /** Frame-center times in seconds. */
  timestamps: Float64Array;
  rms: Float64Array;
  /** Hz; NaN where the frame has no spectral magnitude. */
  centroid: Float64Array;
  /** Bass power share; NaN where the frame has no power. */
  bassRatio: Float64Array;
  /** Full-band positive spectral flux divided by its track maximum. */
  onset: Float64Array;
  /** Positive spectral flux at or below 150 Hz divided by its track maximum. */
  beatOnset: Float64Array;
}

export function frameCount(sampleCount: number, frameLength: number, hopLength: number): number {
  return sampleCount < frameLength ? 0 : 1 + Math.floor((sampleCount - frameLength) / hopLength);
}

function normalizeInPlace(x: Float64Array): void {
  let peak = 0;
  for (let i = 0; i < x.length; i++) if (x[i]! > peak) peak = x[i]!;
  if (peak > 0) for (let i = 0; i < x.length; i++) x[i] = x[i]! / peak;
}

export function extractBaselineFrames(
  samples: Float32Array,
  sampleRate: number,
  config: BaselineConfig = DEFAULT_BASELINE_CONFIG,
  onProgress?: (fraction: number) => void,
): BaselineFrames {
  const { frameLength: n, hopLength: hop } = config;
  const frames = frameCount(samples.length, n, hop);
  const omitted = frames === 0 ? samples.length : samples.length - ((frames - 1) * hop + n);
  const window = hanningSymmetric(n);
  const freqs = rfftFrequencies(n, sampleRate);
  const bins = n / 2 + 1;
  let bassLast = -1;
  let beatLast = -1;
  for (let k = 0; k < bins; k++) {
    if (freqs[k]! <= BASS_CUTOFF_HZ) bassLast = k;
    if (freqs[k]! <= BEAT_ONSET_BAND_HZ) beatLast = k;
  }

  const timestamps = new Float64Array(frames);
  const rms = new Float64Array(frames);
  const centroid = new Float64Array(frames);
  const bassRatio = new Float64Array(frames);
  const onset = new Float64Array(frames);
  const beatOnset = new Float64Array(frames);

  const frame = new Float64Array(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let mag = new Float64Array(bins);
  let prev = new Float64Array(bins);
  const progressEvery = Math.max(1, Math.floor(frames / 50));

  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    timestamps[f] = (start + n / 2) / sampleRate;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const s = samples[start + i]!;
      sq += s * s;
      frame[i] = s * window[i]!;
    }
    rms[f] = Math.sqrt(sq / n);
    magnitudeSpectrum(frame, mag, re, im);

    let weighted = 0;
    let magTotal = 0;
    let bassPower = 0;
    let totalPower = 0;
    let flux = 0;
    let beatFlux = 0;
    for (let k = 0; k < bins; k++) {
      const m = mag[k]!;
      weighted += m * freqs[k]!;
      magTotal += m;
      const p = m * m;
      totalPower += p;
      if (k <= bassLast) bassPower += p;
      if (f > 0) {
        const d = m - prev[k]!;
        if (d > 0) {
          flux += d;
          if (k <= beatLast) beatFlux += d;
        }
      }
    }
    centroid[f] = magTotal > 0 ? weighted / magTotal : NaN;
    bassRatio[f] = totalPower > 0 ? bassPower / totalPower : NaN;
    onset[f] = flux;
    beatOnset[f] = beatFlux;
    const swap = prev;
    prev = mag;
    mag = swap;
    if (onProgress && f % progressEvery === 0) onProgress(f / frames);
  }
  normalizeInPlace(onset);
  normalizeInPlace(beatOnset);
  return {
    sampleRate,
    frameLength: n,
    hopLength: hop,
    frameCount: frames,
    omittedTailSamples: omitted,
    timestamps,
    rms,
    centroid,
    bassRatio,
    onset,
    beatOnset,
  };
}
