import { describe, expect, it } from "vitest";
import { BEATS_PER_SECOND, formatClock, makeWaveform, TRACK_BEATS } from "@/components/loading/deck-art";

describe("loader deck art", () => {
  it("builds the same three-band waveform every time", () => {
    const a = makeWaveform();
    expect(a).toEqual(makeWaveform());
    expect(a).toHaveLength(TRACK_BEATS * 16);
    for (const s of a) {
      for (const v of [s.low, s.mid, s.high]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("drops the kick in the breakdown", () => {
    const wave = makeWaveform();
    const onBeat = (bar: number) => wave[bar * 4 * 16]!.low;
    expect(onBeat(20)).toBeGreaterThan(0.6);
    expect(onBeat(35)).toBeLessThan(0.25);
  });

  it("formats the elapsed clock", () => {
    expect(BEATS_PER_SECOND).toBeCloseTo(124 / 60);
    expect(formatClock(0)).toBe("00:00.0");
    expect(formatClock(83.44)).toBe("01:23.4");
  });
});
