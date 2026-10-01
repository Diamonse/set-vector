import { describe, expect, it } from "vitest";
import { barStartIndices, phraseCues, REGION_BEATS } from "@/lib/cues/phrases";

const BPM = 125;
const P = 60 / BPM;
const beatsFor = (seconds: number, offset = 0.2) => Array.from({ length: Math.floor((seconds - offset) / P) + 1 }, (_, i) => offset + i * P);

describe("phrase-aligned cue candidates", () => {
  const duration = 300;
  const beats = beatsFor(duration);
  // Bars start on the third beat (a pickup), so the first bar line is beat index 2.
  const downbeats = beats.filter((_, i) => i >= 2 && (i - 2) % 4 === 0);

  it("starts entries on 8-bar phrases from the first bar line", () => {
    const cues = phraseCues({ beats, barStarts: barStartIndices(beats, downbeats), duration, source: "Suggested" });
    const entries = cues.filter((c) => c.kind === "entry");
    expect(entries.length).toBe(3);
    expect(entries[0]!.startSeconds).toBeCloseTo(beats[2]!, 3);
    expect(entries[1]!.startSeconds).toBeCloseTo(beats[2 + 32]!, 3);
    expect(entries[0]!.label).toMatch(/intro at bar 1/);
    expect(entries[1]!.label).toMatch(/bar 9/);
    for (const c of entries) expect(c.endSeconds - c.startSeconds).toBeCloseTo(REGION_BEATS * P, 2);
  });

  it("puts exits on phrases in the last part, preferring section boundaries", () => {
    const boundaryBeat = 2 + 32 * 15; // bar 121, about 231 s
    const cues = phraseCues({
      beats,
      barStarts: barStartIndices(beats, downbeats),
      boundaries: [{ seconds: beats[boundaryBeat]! + 0.05, strength: 0.8 }],
      duration,
      source: "Suggested",
    });
    const exits = cues.filter((c) => c.kind === "exit");
    expect(exits.length).toBeGreaterThan(0);
    expect(exits.length).toBeLessThanOrEqual(3);
    for (const e of exits) {
      expect(e.startSeconds).toBeGreaterThanOrEqual(duration * 0.6);
      expect(e.endSeconds).toBeLessThanOrEqual(duration);
    }
    const boundary = exits.find((e) => Math.abs(e.startSeconds - beats[boundaryBeat]!) < 1e-3);
    expect(boundary?.label).toMatch(/section boundary/);
  });

  it("says the bar phase is unknown without bar lines", () => {
    const cues = phraseCues({ beats, barStarts: null, duration, source: "Grid" });
    expect(cues[0]!.startSeconds).toBeCloseTo(beats[0]!, 3);
    expect(cues.every((c) => c.label.includes("bar phase unknown"))).toBe(true);
  });

  it("falls back to time windows without a usable grid", () => {
    const cues = phraseCues({ beats: beats.slice(0, 20), barStarts: null, duration: 90, source: "Suggested" });
    expect(cues.map((c) => c.kind)).toEqual(["entry", "exit"]);
    expect(cues[1]!.endSeconds).toBe(90);
  });
});
