import { describe, expect, it } from "vitest";
import { extractBaselineFrames, DEFAULT_BASELINE_CONFIG } from "@/lib/analysis/features";
import { energyFeatures, onsetRate } from "@/lib/analysis/energy-features";
import { measureLoudness } from "@/lib/analysis/loudness";
import { club } from "../analysis/signals";
import { midRank, scoreLibrary, type EnergyInputs } from "@/lib/energy/score";

const SR = 22050;

/** Decaying noise bursts at a fixed rate, scaled by `gain`. */
function bursts(seconds: number, perSecond: number, gain: number): Float32Array {
  const n = Math.round(SR * seconds);
  const out = new Float32Array(n);
  let x = 7;
  const period = Math.round(SR / perSecond);
  for (let i = 0; i < n; i++) {
    x = (48271 * x) % 2147483647;
    const noise = (x / 2147483647) * 2 - 1;
    const phase = i % period;
    out[i] = gain * noise * Math.exp(-phase / (SR * 0.02));
  }
  return out;
}

describe("energy features", () => {
  it("counts onsets per second independent of level", () => {
    const sparse = extractBaselineFrames(bursts(20, 2, 0.5), SR, DEFAULT_BASELINE_CONFIG);
    const busy = extractBaselineFrames(bursts(20, 8, 0.5), SR, DEFAULT_BASELINE_CONFIG);
    const quiet = extractBaselineFrames(bursts(20, 8, 0.05), SR, DEFAULT_BASELINE_CONFIG);
    const r2 = onsetRate(sparse)!;
    const r8 = onsetRate(busy)!;
    expect(r2).toBeGreaterThan(1.6);
    expect(r2).toBeLessThan(2.4);
    expect(r8).toBeGreaterThan(6.5);
    expect(r8).toBeLessThan(9);
    expect(Math.abs(onsetRate(quiet)! - r8)).toBeLessThan(0.5);
  });

  it("counts a kick and an off-beat hat as two onsets per beat", () => {
    for (const bpm of [90, 124, 174]) {
      const rate = onsetRate(extractBaselineFrames(club(44100, 30, bpm), 44100, DEFAULT_BASELINE_CONFIG))!;
      expect(rate).toBeCloseTo((2 * bpm) / 60, 0);
    }
  });

  it("summarizes loudness and spectrum", () => {
    const signal = bursts(20, 4, 0.5);
    const frames = extractBaselineFrames(signal, SR, DEFAULT_BASELINE_CONFIG);
    const loud = measureLoudness([signal], SR);
    const f = energyFeatures(frames, loud);
    expect(f.version).toBe(1);
    expect(f.integratedLufs).not.toBeNull();
    expect(f.loudSectionLufs!).toBeGreaterThanOrEqual(f.integratedLufs! - 1);
    expect(f.bassRatio!).toBeGreaterThanOrEqual(0);
    expect(f.bassRatio!).toBeLessThanOrEqual(1);
    expect(f.centroidHz!).toBeGreaterThan(0);
  });
});

const inputs = (loudness: number | null, onsetRate: number | null, tempo: number | null, bassRatio: number | null, brightness: number | null): EnergyInputs => ({
  loudness,
  onsetRate,
  tempo,
  bassRatio,
  brightness,
});

describe("library energy score", () => {
  it("ranks with mid-ranks that exclude the track itself", () => {
    expect(midRank([1, 2, 3], 1)).toBe(0);
    expect(midRank([1, 2, 3], 3)).toBe(1);
    expect(midRank([1, 2, 2, 3], 2)).toBeCloseTo(1.5 / 3);
    expect(midRank([5], 5)).toBe(0.5);
  });

  it("orders tracks by their inputs and stays within 1 to 10", () => {
    const lib = [
      { id: "calm", inputs: inputs(-16, 2, 95, 0.3, 1200) },
      { id: "mid", inputs: inputs(-10, 4, 122, 0.45, 2000) },
      { id: "peak", inputs: inputs(-6, 6.5, 128, 0.6, 3000) },
    ];
    const s = scoreLibrary(lib);
    const e = (id: string) => s.get(id)!.energy!;
    expect(e("calm")).toBeLessThan(e("mid"));
    expect(e("mid")).toBeLessThan(e("peak"));
    for (const id of ["calm", "mid", "peak"]) {
      expect(e(id)).toBeGreaterThanOrEqual(1);
      expect(e(id)).toBeLessThanOrEqual(10);
      expect(Number.isInteger(e(id) * 10)).toBe(true);
      const total = 1 + s.get(id)!.contributions.reduce((sum, c) => sum + c.points, 0);
      expect(Math.abs(total - e(id))).toBeLessThan(0.051);
    }
  });

  it("moves with the library: a louder newcomer lowers others' loudness rank", () => {
    const base = [
      { id: "a", inputs: inputs(-10, 4, 124, 0.4, 2000) },
      { id: "b", inputs: inputs(-12, 4, 124, 0.4, 2000) },
    ];
    const before = scoreLibrary(base).get("a")!.energy!;
    const after = scoreLibrary([...base, { id: "c", inputs: inputs(-5, 4, 124, 0.4, 2000) }]).get("a")!.energy!;
    expect(after).toBeLessThan(before);
  });

  it("abstains without loudness and renormalizes over the inputs it has", () => {
    const s = scoreLibrary([
      { id: "unanalyzed", inputs: inputs(null, null, 124, null, null) },
      { id: "old", inputs: inputs(-9, null, 124, 0.5, 2200) },
    ]);
    expect(s.get("unanalyzed")!.energy).toBeNull();
    expect(s.get("unanalyzed")!.reason).toMatch(/analyze/);
    const old = s.get("old")!;
    expect(old.energy).not.toBeNull();
    expect(old.missing).toEqual(["onsetRate"]);
    expect(old.contributions.reduce((sum, c) => sum + c.weight, 0)).toBeCloseTo(1);
  });

  it("uses the reference range when the library is tiny", () => {
    const loud = scoreLibrary([{ id: "x", inputs: inputs(-5, 7, 150, 0.7, 3500) }]).get("x")!.energy!;
    const soft = scoreLibrary([{ id: "x", inputs: inputs(-20, 1, 80, 0.15, 800) }]).get("x")!.energy!;
    expect(loud).toBeGreaterThan(soft + 4);
  });
});
