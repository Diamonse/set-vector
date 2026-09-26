/**
 * ITU-R BS.1770-4 loudness: K-weighting, 400 ms blocks with 75% overlap, absolute
 * (-70 LUFS) and relative (-10 LU) gates. Short-term loudness uses 3 s windows every
 * second, and loudness range follows EBU Tech 3342. Loudness is a standardized level,
 * not a model of perceived energy.
 */

export interface LoudnessResult {
  integratedLufs: number | null;
  loudnessRangeLu: number | null;
  samplePeakDbfs: number | null;
  /** Short-term loudness at 1 s steps; null where the window is below the absolute gate. */
  shortTerm: (number | null)[];
  channelWeights: number[];
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** K-weighting stages for any sample rate (libebur128's analogue-prototype design). */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const highpass: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, highpass];
}

function filter(x: ArrayLike<number>, f: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    y[i] = yi;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
  }
  return y;
}

/** Channel weights: 1 for up to three front channels, 1.41 for surrounds in a 5.x layout. */
function weightsFor(channels: number): number[] {
  if (channels >= 5) return Array.from({ length: channels }, (_, i) => (i === 3 && channels === 6 ? 0 : i >= channels - 2 ? 1.41 : 1));
  return Array.from({ length: channels }, () => 1);
}

const toLufs = (power: number) => -0.691 + 10 * Math.log10(power);

/** Mean-square K-weighted power per window, summed over weighted channels. */
function windowPowers(filtered: Float64Array[], weights: number[], windowSamples: number, stepSamples: number): number[] {
  const n = filtered[0]?.length ?? 0;
  if (n < windowSamples) return [];
  // Prefix sums of squares make every window O(1).
  const prefix = filtered.map((ch) => {
    const p = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) p[i + 1] = p[i]! + ch[i]! * ch[i]!;
    return p;
  });
  const out: number[] = [];
  for (let start = 0; start + windowSamples <= n; start += stepSamples) {
    let power = 0;
    prefix.forEach((p, c) => {
      power += (weights[c]! * (p[start + windowSamples]! - p[start]!)) / windowSamples;
    });
    out.push(power);
  }
  return out;
}

function percentile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function measureLoudness(channels: Float32Array[], sampleRate: number): LoudnessResult {
  const weights = weightsFor(channels.length);
  const [shelf, highpass] = kWeighting(sampleRate);
  const filtered = channels.map((ch) => filter(filter(ch, shelf), highpass));

  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]!));

  const blocks = windowPowers(filtered, weights, Math.round(0.4 * sampleRate), Math.round(0.1 * sampleRate));
  const aboveAbsolute = blocks.filter((p) => toLufs(p) > -70);
  let integrated: number | null = null;
  if (aboveAbsolute.length) {
    const relative = toLufs(aboveAbsolute.reduce((a, b) => a + b, 0) / aboveAbsolute.length) - 10;
    const gated = aboveAbsolute.filter((p) => toLufs(p) > relative);
    if (gated.length) integrated = toLufs(gated.reduce((a, b) => a + b, 0) / gated.length);
  }

  const shortPowers = windowPowers(filtered, weights, 3 * sampleRate, sampleRate);
  const shortTerm = shortPowers.map((p) => (p > 0 && toLufs(p) > -70 ? toLufs(p) : null));

  // EBU Tech 3342: short-term values above -70 LUFS, then a -20 LU relative gate.
  let range: number | null = null;
  const absGated = shortPowers.filter((p) => p > 0 && toLufs(p) > -70);
  if (absGated.length) {
    const relative = toLufs(absGated.reduce((a, b) => a + b, 0) / absGated.length) - 20;
    const values = absGated.map(toLufs).filter((l) => l > relative).sort((a, b) => a - b);
    if (values.length >= 2) range = percentile(values, 0.95) - percentile(values, 0.1);
  }

  return {
    integratedLufs: integrated,
    loudnessRangeLu: range,
    samplePeakDbfs: peak > 0 ? 20 * Math.log10(peak) : null,
    shortTerm,
    channelWeights: weights,
  };
}
