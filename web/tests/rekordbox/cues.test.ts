import { describe, expect, it } from "vitest";
import { mapRekordboxCues, roleOf } from "@/lib/rekordbox/cues";
import type { PositionMark, TempoMarker } from "@/lib/rekordbox/read";

const tempo: TempoMarker[] = [{ startSeconds: 0.05, bpm: 124, meter: "4/4", beatInBar: 1 }];
const P = 60 / 124;
const mark = (startSeconds: number, extra: Partial<PositionMark> = {}): PositionMark => ({
  name: "",
  kind: "cue",
  startSeconds,
  endSeconds: null,
  slot: null,
  colour: null,
  ...extra,
});

describe("Rekordbox cue roles", () => {
  it("uses type, then name, then position", () => {
    expect(roleOf(mark(200, { kind: "fade_in" }), 300)).toBe("entry");
    expect(roleOf(mark(10, { kind: "fade_out" }), 300)).toBe("exit");
    expect(roleOf(mark(150, { name: "Mix In" }), 300)).toBe("entry");
    expect(roleOf(mark(20, { name: "Outro" }), 300)).toBe("exit");
    expect(roleOf(mark(30, { name: "Drop" }), 300)).toBe("entry");
    expect(roleOf(mark(250), 300)).toBe("exit");
    expect(roleOf(mark(150), 300)).toBeNull();
    expect(roleOf(mark(10, { kind: "load" }), 300)).toBeNull();
    // "Breakdown" contains no whole-word role, so position decides.
    expect(roleOf(mark(150, { name: "Breakdown" }), 300)).toBeNull();
  });
});

describe("Rekordbox cue regions", () => {
  it("makes 32-beat regions on the grid, keeps loop spans, and drops duplicates", () => {
    const { regions, ignored } = mapRekordboxCues(
      [
        mark(0.05 + 16 * P, { slot: 0, name: "Intro" }),
        mark(0.05 + 16 * P), // memory cue on the same point
        mark(150), // middle third, unnamed
        mark(250, { kind: "loop", endSeconds: 262 }),
      ],
      tempo,
      300,
    );
    expect(ignored).toBe(1);
    const entry = regions.find((r) => r.kind === "entry")!;
    expect(regions.filter((r) => r.kind === "entry")).toHaveLength(1);
    expect(entry.label).toBe('Rekordbox hot cue A "Intro"');
    expect(entry.origin).toBe("rekordbox_cue");
    expect(entry.endSeconds - entry.startSeconds).toBeCloseTo(32 * P, 2);
    const exit = regions.find((r) => r.kind === "exit")!;
    expect([exit.startSeconds, exit.endSeconds]).toEqual([250, 262]);
    expect(regions.some((r) => r.origin === "rekordbox_grid")).toBe(false);
  });

  it("clamps regions at the end of the track and skips very short ones", () => {
    const { regions } = mapRekordboxCues([mark(285), mark(299.5)], tempo, 300);
    const exits = regions.filter((r) => r.origin === "rekordbox_cue");
    expect(exits).toHaveLength(1);
    expect(exits[0]!.endSeconds).toBe(300);
  });

  it("adds grid suggestions for a role with no cue", () => {
    const { regions } = mapRekordboxCues([mark(260, { name: "Mix out", slot: 3 })], tempo, 300);
    const grid = regions.filter((r) => r.origin === "rekordbox_grid");
    expect(grid.length).toBeGreaterThan(0);
    expect(grid.every((r) => r.kind === "entry")).toBe(true);
    expect(grid[0]!.startSeconds).toBeCloseTo(0.05, 3);
    expect(grid[0]!.label).toMatch(/^Grid intro at bar 1/);
  });

  it("suggests from the grid alone when there are no cues", () => {
    const { regions } = mapRekordboxCues([], tempo, 300);
    expect(regions.some((r) => r.kind === "entry")).toBe(true);
    expect(regions.some((r) => r.kind === "exit")).toBe(true);
    expect(regions.every((r) => r.origin === "rekordbox_grid")).toBe(true);
  });

  it("uses the average BPM when there is no grid and makes no grid suggestions", () => {
    const { regions } = mapRekordboxCues([mark(5, { name: "Intro" })], [], 300, 120);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.endSeconds).toBeCloseTo(5 + 16, 3);
  });
});
