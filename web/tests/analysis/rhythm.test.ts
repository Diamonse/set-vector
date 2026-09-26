import { describe, expect, it } from "vitest";
import { BORDER_FRAMES, CHUNK_FRAMES, frameLogits, logMel, N_MELS, pickPeaks, refinePeakTimes } from "@/lib/analysis/beat-model";
import { evaluateCandidate, fitGrid } from "@/lib/analysis/grid";
import gridFixture from "../fixtures/analysis/grid.json";
import melFixture from "../fixtures/analysis/log_mel.json";
import peaksFixture from "../fixtures/analysis/peaks.json";
import { club } from "./signals";

describe("Beat This! log-mel parity with _inference.log_mel", () => {
  const spect = logMel(club(melFixture.sampleRate, melFixture.seconds, 124), melFixture.sampleRate);
  it("has the same frame count", () => {
    expect(spect.frames).toBe(melFixture.frames);
  });
  it("matches sampled frames", () => {
    let worst = 0;
    melFixture.rows.forEach((r, j) => {
      const expected = melFixture.values[j]!;
      for (let m = 0; m < N_MELS; m++) worst = Math.max(worst, Math.abs(spect.data[r * N_MELS + m]! - expected[m]!));
    });
    expect(worst).toBeLessThan(2e-3);
  });
});

describe("chunked inference", () => {
  it("passes short tracks as one shorter chunk, as frame_logits does", async () => {
    const lengths: number[] = [];
    const out = await frameLogits({ data: new Float32Array(100 * N_MELS), frames: 100 }, async (_chunk, frames) => {
      lengths.push(frames);
      return { beat: new Float32Array(frames).fill(1), downbeat: new Float32Array(frames).fill(-1) };
    });
    expect(lengths).toEqual([112]);
    expect(Array.from(out.beat).every((v) => v === 1)).toBe(true);
  });

  it("covers long tracks with overlapping full chunks and earlier chunks win", async () => {
    const size = 4000;
    const spect = { data: new Float32Array(size * N_MELS), frames: size };
    for (let f = 0; f < size; f++) spect.data[f * N_MELS] = f;
    const out = await frameLogits(spect, async (chunk, frames) => {
      expect(frames).toBe(CHUNK_FRAMES);
      // Echo the frame index so the stitched output reveals which chunk wrote each frame.
      const beat = new Float32Array(frames);
      for (let f = 0; f < frames; f++) beat[f] = chunk[f * N_MELS]!;
      return { beat, downbeat: beat };
    });
    for (let f = BORDER_FRAMES; f < size - BORDER_FRAMES; f++) expect(out.beat[f]).toBe(f);
  });
});

describe("peak picking parity with pick_peaks and refine_peak_times", () => {
  const n = peaksFixture.frames;
  const beat = new Float32Array(n);
  const down = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    beat[f] = Math.fround(4 * Math.cos((2 * Math.PI * f) / 24.2) - 1.5 + 0.3 * Math.sin(f * 0.9));
    down[f] = Math.fround(4 * Math.cos((2 * Math.PI * f) / 96.8) - 2.5 + 0.3 * Math.sin(f * 0.5));
  }
  const picked = pickPeaks(beat, down);
  it("finds the same beats and downbeats", () => {
    expect(picked.beats).toEqual(peaksFixture.beats);
    expect(picked.downbeats).toEqual(peaksFixture.downbeats);
  });
  it("refines times identically", () => {
    refinePeakTimes(picked.beats, beat).forEach((t, i) => expect(t).toBeCloseTo(peaksFixture.refined[i]!, 6));
  });
});

describe("grid parity with fit_grid and rhythm._evaluate", () => {
  for (const [name, c] of Object.entries(gridFixture)) {
    it(`fits ${name}`, () => {
      const fit = fitGrid(c.times, c.duration)!;
      expect(fit.segments.length).toBe(c.segments.length);
      fit.segments.forEach((s, i) => {
        const [start, period, count] = c.segments[i]!;
        expect(s.startSeconds).toBeCloseTo(start!, 9);
        expect(s.period).toBeCloseTo(period!, 9);
        expect(s.beatCount).toBe(count);
      });
      expect(fit.gridFit).toBeCloseTo(c.gridFit, 12);
    });
    it(`scores ${name}`, () => {
      const cand = evaluateCandidate(c.downbeats ? "beat_this" : "setvector_fallback", c.times, c.downbeats, c.duration);
      expect(cand.reasons).toEqual(c.reasons);
      expect(cand.quality.beatCount).toBe(c.quality.beatCount);
      expect(cand.quality.segmentCount).toBe(c.quality.segmentCount);
      expect(cand.quality.modalBarLength).toBe(c.quality.modalBarLength);
      if (c.quality.intervalCv !== null) expect(cand.quality.intervalCv).toBeCloseTo(c.quality.intervalCv, 9);
      if (c.quality.barRegularity !== null) expect(cand.quality.barRegularity).toBeCloseTo(c.quality.barRegularity, 9);
      expect(cand.barPositions.slice(0, 40)).toEqual(c.barPositions);
    });
  }
});
