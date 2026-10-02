import { describe, expect, it } from "vitest";
import type { Track } from "@/lib/domain/types";
import { bpmHistogram, energyHistogram, gettingStarted, keyCounts, libraryHealth, styleCounts } from "@/lib/home/stats";

const track = (id: string, extra: Partial<Track> = {}): Track => ({
  id,
  title: id,
  artist: "",
  versionLabel: "",
  remixGroup: "",
  durationSeconds: 300,
  styleTags: [],
  bpm: null,
  bpmAlternatives: [],
  bpmSource: null,
  keyTonic: null,
  keyMode: null,
  keyStatus: "unknown",
  energy: null,
  energySource: null,
  assetId: null,
  featureId: null,
  notes: "",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  cues: [],
  ...extra,
});

const cue = (kind: "entry" | "exit", reviewStatus: "approved" | "pending") =>
  ({ id: `${kind}${reviewStatus}`, trackId: "x", kind, startSeconds: 0, endSeconds: 10, label: "", provenance: "reviewed", reviewStatus, vocalActivity: "unknown" }) as Track["cues"][number];

const lib = [
  track("a", { bpm: 122, bpmSource: "reviewed", keyTonic: 9, keyMode: "minor", keyStatus: "reviewed", energy: 4, energySource: "reviewed", styleTags: ["House"], cues: [cue("entry", "approved"), cue("exit", "approved")] }),
  track("b", { bpm: 124.9, bpmSource: "estimate", keyTonic: 9, keyMode: "minor", keyStatus: "estimated", energy: 6.4, energySource: "estimate", energyModel: "m", styleTags: ["House", "EDM"] }),
  track("c", { bpm: 94, keyTonic: 2, keyMode: "minor", keyStatus: "uncertain", styleTags: ["Hip-hop"], durationSeconds: 200 }),
];

describe("home stats", () => {
  it("summarizes library health", () => {
    expect(libraryHealth(lib)).toEqual({ tracks: 3, totalSeconds: 800, withTempo: 3, withKey: 2, withEnergy: 2, estimatedEnergy: 1, cueReady: 1, needsReview: 2 });
  });

  it("bins tempos in 5 BPM steps across the library's range", () => {
    const bins = bpmHistogram(lib);
    expect(bins[0]!.from).toBe(90);
    expect(bins.at(-1)!.to).toBe(125);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(3);
    expect(bins.find((b) => b.from === 120)!.count).toBe(2);
    expect(bpmHistogram([track("x")])).toEqual([]);
  });

  it("bins energy by whole steps and counts usable Camelot keys only", () => {
    const e = energyHistogram(lib);
    expect(e).toHaveLength(10);
    expect(e[3]!.count).toBe(1);
    expect(e[5]!.count).toBe(1);
    const k = keyCounts(lib);
    expect(k).toHaveLength(24);
    expect(k.find((x) => x.number === 8 && x.letter === "A")!.count).toBe(2);
    expect(k.reduce((s, x) => s + x.count, 0)).toBe(2);
  });

  it("ranks styles and folds the tail into Other", () => {
    expect(styleCounts(lib)).toEqual([
      { style: "House", count: 2 },
      { style: "EDM", count: 1 },
      { style: "Hip-hop", count: 1 },
    ]);
    const folded = styleCounts(lib, 1);
    expect(folded.at(-1)).toEqual({ style: "Other styles (2)", count: 2 });
  });

  it("ticks off getting-started steps from the data", () => {
    const empty = gettingStarted({ tracks: [], analyses: 0, crates: 0, plans: 0 });
    expect(empty.every((s) => !s.done)).toBe(true);
    const some = gettingStarted({ tracks: lib, analyses: 1, crates: 0, plans: 2 });
    expect(some.filter((s) => s.done).map((s) => s.id)).toEqual(["tracks", "analyze", "cues", "plan"]);
  });
});
