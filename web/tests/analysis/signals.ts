/** Synthetic test signals, formula-identical to web/scripts/make_analysis_fixtures.py. */

const CHORDS: number[][] = [
  [220.0, 261.63, 329.63],
  [146.83, 174.61, 220.0],
  [164.81, 207.65, 246.94],
  [220.0, 261.63, 329.63],
];

export function noise(count: number): Float64Array {
  const out = new Float64Array(count);
  let x = 1;
  for (let i = 0; i < count; i++) {
    x = (48271 * x) % 2147483647;
    out[i] = (x / 2147483647) * 2 - 1;
  }
  return out;
}

export function club(sampleRate: number, seconds: number, bpm: number, offset = 0.05): Float32Array {
  const n = Math.round(sampleRate * seconds);
  const signal = new Float64Array(n);
  const beat = 60 / bpm;
  for (let k = 0; offset + k * beat < seconds; k++) {
    const kb = offset + k * beat;
    for (let i = Math.max(0, Math.ceil(kb * sampleRate)); i < n; i++) {
      const d = i / sampleRate - kb;
      if (d < 0) continue;
      if (d >= 0.25) break;
      signal[i] = signal[i]! + 0.9 * Math.sin(2 * Math.PI * 55 * d) * Math.exp(-d * 18);
    }
    const hb = kb + beat / 2;
    const idx: number[] = [];
    for (let i = Math.max(0, Math.ceil(hb * sampleRate) - 1); i < n; i++) {
      const d = i / sampleRate - hb;
      if (d < 0) continue;
      if (d >= 0.06) break;
      idx.push(i);
    }
    const nz = noise(idx.length);
    idx.forEach((i, j) => {
      const d = i / sampleRate - hb;
      signal[i] = signal[i]! + 0.15 * nz[j]! * Math.exp(-d * 60);
    });
  }
  const bar = 4 * beat;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const chord = Math.floor(Math.max(t - offset, 0) / (2 * bar)) % 4;
    for (const f of CHORDS[chord]!) signal[i] = signal[i]! + 0.08 * Math.sin(2 * Math.PI * f * t);
  }
  return Float32Array.from(signal);
}
