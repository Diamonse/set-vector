import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv, parseLibrary } from "@/lib/import/parse";

describe("parseCsv", () => {
  it("handles quotes and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });
});

describe("parseLibrary", () => {
  it("reads the JSON sample with provenance intact", () => {
    const result = parseLibrary(readFileSync("examples/library.sample.json", "utf8"));
    expect(result.format).toBe("json");
    expect(result.problems).toEqual([]);
    expect(result.tracks).toHaveLength(6);
    const first = result.tracks[0]!;
    expect(first.duration_seconds).toBe(372);
    expect(first.key_status).toBe("reviewed");
    expect(first.bpm_source).toBe("reviewed");
    expect(first.cues).toHaveLength(2);
    expect(first.cues[0]!.review_status).toBe("approved");
    const second = result.tracks[1]!;
    expect(second.bpm_source).toBe("estimate");
    expect(second.key_status).toBe("estimated");
    expect(second.cues[1]!.review_status).toBe("pending");
    expect(result.tracks[3]!.key_status).toBe("uncertain");
  });

  it("reads the CSV sample with cue ranges", () => {
    const result = parseLibrary(readFileSync("examples/library.sample.csv", "utf8"));
    expect(result.format).toBe("csv");
    expect(result.problems).toEqual([]);
    expect(result.tracks).toHaveLength(3);
    expect(result.tracks[1]!.style_tags).toEqual(["BollyHouse", "Bollywood", "House"]);
    expect(result.tracks[1]!.cues.map((c) => c.kind)).toEqual(["entry", "exit"]);
    expect(result.tracks[2]!.bpm_alternatives).toEqual([188]);
  });

  it("reports and skips bad rows", () => {
    const result = parseLibrary(
      JSON.stringify([{ title: "No duration" }, { title: "Bad cue", duration: 100, cues: [{ kind: "exit", start: 90, end: 120 }] }]),
    );
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]!.cues).toHaveLength(0);
    expect(result.problems.map((p) => p.row)).toEqual([1, 2]);
  });
});
