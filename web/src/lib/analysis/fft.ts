/** In-place iterative radix-2 FFT with cached twiddles and bit-reversal tables. */

interface Plan {
  n: number;
  rev: Uint32Array;
  cos: Float64Array;
  sin: Float64Array;
}

const plans = new Map<number, Plan>();

function plan(n: number): Plan {
  let p = plans.get(n);
  if (p) return p;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`);
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n);
    sin[i] = Math.sin((-2 * Math.PI * i) / n);
  }
  p = { n, rev, cos, sin };
  plans.set(n, p);
  return p;
}

/** Forward complex FFT of (re, im), in place. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  const { rev, cos, sin } = plan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i]!;
    if (j > i) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step]!;
        const wi = sin[k * step]!;
        const a = start + k;
        const b = a + half;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
    }
  }
}

/**
 * Magnitudes of the one-sided spectrum (n / 2 + 1 bins) of a real frame.
 * `scratchRe` and `scratchIm` must have length n and are overwritten.
 */
export function magnitudeSpectrum(frame: ArrayLike<number>, out: Float64Array, scratchRe: Float64Array, scratchIm: Float64Array): void {
  const n = scratchRe.length;
  for (let i = 0; i < n; i++) {
    scratchRe[i] = frame[i] ?? 0;
    scratchIm[i] = 0;
  }
  fft(scratchRe, scratchIm);
  for (let k = 0; k <= n / 2; k++) out[k] = Math.hypot(scratchRe[k]!, scratchIm[k]!);
}

/** NumPy's symmetric `np.hanning(n)`. */
export function hanningSymmetric(n: number): Float64Array {
  const w = new Float64Array(n);
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/** PyTorch's default periodic `torch.hann_window(n)`. */
export function hannPeriodic(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** `np.fft.rfftfreq(n, 1 / sampleRate)`. */
export function rfftFrequencies(n: number, sampleRate: number): Float64Array {
  const f = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) f[k] = (k * sampleRate) / n;
  return f;
}
