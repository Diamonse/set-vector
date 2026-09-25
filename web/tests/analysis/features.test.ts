import { describe, expect, it } from "vitest";
import { extractBaselineFrames } from "@/lib/analysis/features";
import { fft } from "@/lib/analysis/fft";
import { estimateTempo, trackBeats } from "@/lib/analysis/tempo";
import fixture from "../fixtures/analysis/baseline.json";
import { club } from "./signals";

function close(actual: number, expected: number | null, rel: number, label: string) {
  if (expected === null) {
    expect(Number.isNaN(actual), label).toBe(true);
    return;
  }
  const tol = rel * Math.max(1e-9, Math.abs(expected));
  expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tol + 1e-9);
}

describe("fft", () => {
  it("matches a direct DFT", () => {
    const n = 64;
    const x = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1));
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    fft(re, im);
    for (let k = 0; k < n; k++) {
      let r = 0;
      let m = 0;
      for (let t = 0; t < n; t++) {
        r += x[t]! * Math.cos((-2 * Math.PI * k * t) / n);
        m += x[t]! * Math.sin((-2 * Math.PI * k * t) / n);
      }
      expect(re[k]).toBeCloseTo(r, 9);
      expect(im[k]).toBeCloseTo(m, 9);
    }
  });
});

describe("baseline parity with baseline.py", () => {
  const samples = club(fixture.sampleRate, fixture.seconds, fixture.bpm);
  const frames = extractBaselineFrames(samples, fixture.sampleRate);

  it("has the same frame layout", () => {
    expect(frames.frameCount).toBe(fixture.frameCount);
  });

  it("matches every measured series", () => {
    for (const [name, series] of [
      ["rms", frames.rms],
      ["centroid", frames.centroid],
      ["bassRatio", frames.bassRatio],
      ["onset", frames.onset],
      ["beatOnset", frames.beatOnset],
    ] as const) {
      const expected = fixture[name] as (number | null)[];
      expected.forEach((v, j) => close(series[j * fixture.step]!, v, 1e-4, `${name}[${j * fixture.step}]`));
    }
  });

  it("estimates the same tempo as librosa and tracks nearly the same beats", () => {
    const tempo = estimateTempo(frames.beatOnset, fixture.sampleRate, frames.hopLength)!;
    expect(Math.abs(tempo.bpm - fixture.tempoBpm)).toBeLessThan(0.01);
    const beats = trackBeats(frames.beatOnset, tempo.bpm, tempo.framesPerSecond);
    const expected = new Set(fixture.beatFrames);
    const matched = beats.filter((b) => expected.has(b) || expected.has(b - 1) || expected.has(b + 1)).length;
    expect(matched / fixture.beatFrames.length).toBeGreaterThan(0.95);
    expect(Math.abs(beats.length - fixture.beatFrames.length)).toBeLessThanOrEqual(1);
  });
});
