/**
 * Band-limited resampling with a Kaiser-windowed sinc kernel.
 *
 * The CLI uses soxr; this kernel is not bit-identical but keeps the passband flat
 * to about 0.9 of the lower Nyquist frequency, which is what the log-mel front end
 * needs (its highest band ends at 11 kHz of the 11.025 kHz Nyquist limit).
 */

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 50; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

export function resample(input: Float32Array, fromRate: number, toRate: number, halfWidth = 32, beta = 8.6): Float32Array {
  if (fromRate === toRate) return input.slice();
  const ratio = toRate / fromRate;
  const outLength = Math.floor(input.length * ratio);
  const out = new Float32Array(outLength);
  const cutoff = Math.min(1, ratio) * 0.97;
  const scale = cutoff;
  const width = Math.ceil(halfWidth / Math.min(1, ratio));
  const i0beta = besselI0(beta);
  // Tabulated kernel for speed: sinc(cutoff * x) * kaiser(x / width), x in input samples.
  const oversample = 512;
  const table = new Float64Array(width * oversample + 2);
  for (let i = 0; i < table.length; i++) {
    const x = i / oversample;
    const t = x / width;
    const window = t >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - t * t)) / i0beta;
    const arg = Math.PI * cutoff * x;
    table[i] = (x === 0 ? 1 : Math.sin(arg) / arg) * window * scale;
  }
  for (let j = 0; j < outLength; j++) {
    const center = j / ratio;
    const first = Math.max(0, Math.ceil(center - width));
    const last = Math.min(input.length - 1, Math.floor(center + width));
    let acc = 0;
    for (let i = first; i <= last; i++) {
      const pos = Math.abs(i - center) * oversample;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const k = table[idx]! + (table[idx + 1]! - table[idx]!) * frac;
      acc += input[i]! * k;
    }
    out[j] = acc;
  }
  return out;
}

/** Average all channels into one, as the CLI's mono channel policy does. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const n = channels[0]!.length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] = out[i]! + ch[i]! / channels.length;
  return out;
}
