import { describe, expect, it } from "vitest";
import { activeFilterCount, cueStateOf, EMPTY_FILTERS, filterTracks, parseLength, sortTracks, type FilterableTrack, type TrackFilters } from "@/lib/library/filters";

const track = (id: string, extra: Partial<FilterableTrack> = {}): FilterableTrack => ({
  id,
  title: id,
  artist: "",
  versionLabel: "",
  styleTags: [],
  bpm: null,
  keyTonic: null,
  keyMode: null,
  keyStatus: "unknown",
  energy: null,
  durationSeconds: 300,
  ...extra,
});

const lib = [
  track("Warm Room", { artist: "A", styleTags: ["House"], bpm: 122, keyTonic: 9, keyMode: "minor", keyStatus: "reviewed", energy: 4, durationSeconds: 372 }),
  track("Neon Steps", { artist: "B", styleTags: ["EDM", "House"], bpm: 124, keyTonic: 4, keyMode: "minor", keyStatus: "estimated", energy: 6, durationSeconds: 342 }),
  track("Late Signal", { artist: "D", styleTags: ["Hip-hop"], bpm: 94, keyTonic: 2, keyMode: "minor", keyStatus: "uncertain", energy: 5, durationSeconds: 288 }),
  track("Rooftop Pop", { artist: "E", styleTags: ["Pop"], bpm: 118, keyTonic: 0, keyMode: "major", keyStatus: "estimated", durationSeconds: 211 }),
  track("Half Time", { artist: "F", styleTags: ["Trap"], bpm: 63, keyTonic: 9, keyMode: "minor", keyStatus: "reviewed", energy: 9, durationSeconds: 180 }),
];
const f = (patch: Partial<TrackFilters>) => ({ ...EMPTY_FILTERS, ...patch });
const titles = (ts: FilterableTrack[]) => ts.map((t) => t.title);

describe("track filters", () => {
  it("returns everything with no filters", () => {
    expect(filterTracks(lib, EMPTY_FILTERS)).toHaveLength(lib.length);
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it("filters by text and style", () => {
    expect(titles(filterTracks(lib, f({ text: "neon" })))).toEqual(["Neon Steps"]);
    expect(titles(filterTracks(lib, f({ style: "House" })))).toEqual(["Warm Room", "Neon Steps"]);
  });

  it("filters BPM ranges, optionally at half or double time", () => {
    expect(titles(filterTracks(lib, f({ bpmMin: "120", bpmMax: "126" })))).toEqual(["Warm Room", "Neon Steps"]);
    expect(titles(filterTracks(lib, f({ bpmMin: "120", bpmMax: "130", bpmHalfDouble: true })))).toEqual(["Warm Room", "Neon Steps", "Half Time"]);
    expect(titles(filterTracks(lib, f({ bpmMax: "100" })))).toEqual(["Late Signal", "Half Time"]);
  });

  it("filters exact and compatible Camelot keys, ignoring uncertain keys", () => {
    expect(titles(filterTracks(lib, f({ key: "8A" })))).toEqual(["Warm Room", "Half Time"]);
    // 8A mixes with 7A, 9A (E minor), and its relative 8B (C major).
    expect(titles(filterTracks(lib, f({ key: "8A", keyCompatible: true })))).toEqual(["Warm Room", "Neon Steps", "Rooftop Pop", "Half Time"]);
    expect(titles(filterTracks(lib, f({ key: "none" })))).toEqual(["Late Signal"]);
  });

  it("filters energy and length ranges; tracks without energy drop out of an energy filter", () => {
    expect(titles(filterTracks(lib, f({ energyMin: "5" })))).toEqual(["Neon Steps", "Late Signal", "Half Time"]);
    expect(titles(filterTracks(lib, f({ lengthMax: "5:00" })))).toEqual(["Late Signal", "Rooftop Pop", "Half Time"]);
    expect(titles(filterTracks(lib, f({ lengthMin: "4:00", lengthMax: "6:00" })))).toEqual(["Neon Steps", "Late Signal"]);
    expect(parseLength("1:02:03")).toBe(3723);
    expect(parseLength("nope")).toBeNull();
  });

  it("combines filters and counts them", () => {
    const filters = f({ style: "House", energyMin: "5", bpmMin: "100" });
    expect(titles(filterTracks(lib, filters))).toEqual(["Neon Steps"]);
    expect(activeFilterCount(filters)).toBe(3);
  });

  it("derives cue state from regions", () => {
    expect(cueStateOf(track("x"))).toBe("none");
    expect(cueStateOf(track("x", { cues: [{ kind: "entry", reviewStatus: "approved" }, { kind: "exit", reviewStatus: "approved" }] }))).toBe("ready");
    expect(cueStateOf(track("x", { cues: [{ kind: "entry", reviewStatus: "approved" }, { kind: "exit", reviewStatus: "pending" }] }))).toBe("pending");
    expect(cueStateOf(track("x", { cues: [{ kind: "entry", reviewStatus: "approved" }, { kind: "exit", reviewStatus: "rejected" }] }))).toBe("partial");
    expect(cueStateOf(track("x", { cueState: "ready" }))).toBe("ready");
    expect(titles(filterTracks([track("a", { cueState: "none" }), track("b", { cueState: "ready" })], f({ cues: "ready" })))).toEqual(["b"]);
  });
});

describe("track sorting", () => {
  it("sorts each column both ways with missing values last", () => {
    expect(titles(sortTracks(lib, "bpm", "asc"))).toEqual(["Half Time", "Late Signal", "Rooftop Pop", "Warm Room", "Neon Steps"]);
    expect(titles(sortTracks(lib, "energy", "desc"))).toEqual(["Half Time", "Neon Steps", "Late Signal", "Warm Room", "Rooftop Pop"]);
    expect(titles(sortTracks(lib, "energy", "asc")).at(-1)).toBe("Rooftop Pop");
    // Camelot order: 8A (A minor) twice, 8B (C major), 9A (E minor); the uncertain key is last.
    expect(titles(sortTracks(lib, "key", "asc"))).toEqual(["Half Time", "Warm Room", "Rooftop Pop", "Neon Steps", "Late Signal"]);
    expect(titles(sortTracks(lib, "length", "desc"))[0]).toBe("Warm Room");
    expect(titles(sortTracks(lib, "title", "asc"))[0]).toBe("Half Time");
  });

  it("does not mutate its input", () => {
    const before = titles(lib);
    sortTracks(lib, "bpm", "desc");
    expect(titles(lib)).toEqual(before);
  });
});
