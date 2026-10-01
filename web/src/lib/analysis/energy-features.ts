/**
 * Per-track inputs for the energy estimate. Unlike the baseline summaries, every value here
 * is comparable between tracks: loudness is in LUFS, onset activity is a count per second
 * (not an amplitude), and the spectral values are ratios or frequencies.
 */
import type { BaselineFrames } from "./features";

export const ENERGY_FEATURES_VERSION = 1;

export interface EnergyFeatures {
  version: number;
  integratedLufs: number | null;
  /** 90th percentile of the 3 s short-term loudness: how loud the busiest sections are. */
  loudSectionLufs: number | null;
  loudnessRangeLu: number | null;
  /** Detected onsets per second of non-silent audio. */
  onsetRate: number | null;
  bassRatio: number | null;
  centroidHz: number | null;
}

// Peak picking follows librosa.util.peak_pick as used by onset_detect, in seconds.
const PRE_MAX_S = 0.03;
const POST_MAX_S = 0.03;
const PRE_AVG_S = 0.1;
const POST_AVG_S = 0.1;
const DELTA = 0.07;
const WAIT_S = 0.03;
const MIN_SILENCE_S = 1;

export function percentile(values: ArrayLike<number>, q: number): number | null {
  const finite = Array.from(values).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const pos = (finite.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return finite[lo]! + (finite[hi]! - finite[lo]!) * (pos - lo);
}

/**
 * Onsets per second. The envelope is scaled by its 98th percentile instead of its maximum,
 * so one loud transient does not suppress every other onset; long silences are left out of
 * the duration so they do not dilute the rate.
 */
export function onsetRate(frames: BaselineFrames): number | null {
  const n = frames.frameCount;
  if (n < 8) return null;
  const hop = frames.hopLength / frames.sampleRate;
  const scale = percentile(frames.onset, 0.98);
  if (!scale || scale <= 0) return 0;
  const env = Float64Array.from(frames.onset, (v) => (Number.isFinite(v) ? Math.min(1, v / scale) : 0));

  // Frames more than 60 dB below the track's loud frames are silent; only silent runs
  // longer than a second (intros, gaps, tails) leave the duration, not the gaps between hits.
  const rmsRef = percentile(frames.rms, 0.95) ?? 0;
  const silence = Math.max(1e-6, rmsRef * 1e-3);
  const minRun = Math.round(MIN_SILENCE_S / hop);
  let active = n;
  for (let i = 0; i < n; ) {
    if (frames.rms[i]! > silence) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && frames.rms[j]! <= silence) j++;
    if (j - i >= minRun) active -= j - i;
    i = j;
  }
  if (active <= 0) return 0;

  const preMax = Math.max(1, Math.round(PRE_MAX_S / hop));
  const postMax = Math.max(1, Math.round(POST_MAX_S / hop));
  const preAvg = Math.max(1, Math.round(PRE_AVG_S / hop));
  const postAvg = Math.max(1, Math.round(POST_AVG_S / hop));
  const wait = Math.max(1, Math.round(WAIT_S / hop));
  let count = 0;
  let last = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = env[i]!;
    if (v <= 0) continue;
    let isMax = true;
    for (let j = Math.max(0, i - preMax); j <= Math.min(n - 1, i + postMax); j++) {
      if (env[j]! > v) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;
    let sum = 0;
    const a = Math.max(0, i - preAvg);
    const b = Math.min(n - 1, i + postAvg);
    for (let j = a; j <= b; j++) sum += env[j]!;
    if (v < sum / (b - a + 1) + DELTA) continue;
    if (i - last <= wait) continue;
    count++;
    last = i;
  }
  return count / (active * hop);
}

function mean(values: Float64Array): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  return n ? sum / n : null;
}

const round = (v: number | null, digits: number) => (v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits);

export function energyFeatures(
  frames: BaselineFrames,
  loudness: { integratedLufs: number | null; loudnessRangeLu: number | null; shortTerm: (number | null)[] },
): EnergyFeatures {
  const shortTerm = loudness.shortTerm.filter((v): v is number => v !== null && Number.isFinite(v));
  return {
    version: ENERGY_FEATURES_VERSION,
    integratedLufs: round(loudness.integratedLufs, 2),
    loudSectionLufs: round(percentile(shortTerm, 0.9), 2),
    loudnessRangeLu: round(loudness.loudnessRangeLu, 2),
    onsetRate: round(onsetRate(frames), 3),
    bassRatio: round(mean(frames.bassRatio), 4),
    centroidHz: round(mean(frames.centroid), 1),
  };
}
