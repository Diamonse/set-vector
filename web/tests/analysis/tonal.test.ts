import { describe, expect, it } from "vitest";
import { formatCamelot, toCamelot } from "@/lib/domain/camelot";
import { chromagram, estimateKey } from "@/lib/analysis/key";
import { measureLoudness } from "@/lib/analysis/loudness";
import loudnessFixture from "../fixtures/analysis/loudness.json";
import { club } from "./signals";

describe("key", () => {
  it("finds A minor in an A minor progression", () => {
    const key = estimateKey(chromagram(club(22050, 30, 124), 22050));
    expect(key.tonic).toBe(9);
    expect(key.mode).toBe("minor");
    expect(formatCamelot(toCamelot({ tonic: 9, mode: "minor" }))).toBe("8A");
    expect(key.ranking).toHaveLength(5);
  });

  it("abstains on unpitched audio", () => {
    const n = 22050 * 10;
    const clicks = new Float32Array(n);
    for (let i = 0; i < n; i += 11025) clicks[i] = 1;
    const key = estimateKey(chromagram(clicks, 22050));
    expect(key.status).toBe("uncertain");
    expect(key.reasons.length).toBeGreaterThan(0);
  });
});

describe("loudness", () => {
  it("measures the BS.1770 reference: a -23 dBFS stereo 1 kHz sine is -23 LUFS", () => {
    const sr = loudnessFixture.sampleRate;
    const n = sr * 10;
    const amp = 10 ** (-23 / 20);
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) ch[i] = amp * Math.sin((2 * Math.PI * 1000 * i) / sr);
    const r = measureLoudness([ch, ch], sr);
    expect(r.integratedLufs!).toBeCloseTo(-23, 1);
    expect(Math.abs(r.integratedLufs! - loudnessFixture.sineIntegrated)).toBeLessThan(0.05);
  });

  it("agrees with pyloudnorm on program material", () => {
    const sr = loudnessFixture.sampleRate;
    const left = club(sr, 20, 124);
    const right = left.map((v) => v * 0.5);
    const r = measureLoudness([left, right], sr);
    expect(Math.abs(r.integratedLufs! - loudnessFixture.clubIntegrated)).toBeLessThan(0.1);
    expect(r.shortTerm.length).toBe(18);
  });

  it("reports silence as unavailable, not as a number", () => {
    const r = measureLoudness([new Float32Array(44100 * 5)], 44100);
    expect(r.integratedLufs).toBeNull();
    expect(r.samplePeakDbfs).toBeNull();
  });
});
