import { describe, expect, it } from "vitest";
import { compareKeys, formatCamelot, fromCamelot, parseKey, toCamelot } from "@/lib/domain/camelot";
import { parseTime } from "@/lib/domain/format";

describe("Camelot mapping", () => {
  it("maps reference keys", () => {
    expect(formatCamelot(toCamelot({ tonic: 9, mode: "minor" }))).toBe("8A");
    expect(formatCamelot(toCamelot({ tonic: 0, mode: "major" }))).toBe("8B");
    expect(formatCamelot(toCamelot({ tonic: 8, mode: "minor" }))).toBe("1A");
    expect(formatCamelot(toCamelot({ tonic: 11, mode: "major" }))).toBe("1B");
    expect(formatCamelot(toCamelot({ tonic: 4, mode: "major" }))).toBe("12B");
  });

  it("round-trips all 24 keys", () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const mode of ["major", "minor"] as const) {
        expect(fromCamelot(toCamelot({ tonic, mode }))).toEqual({ tonic, mode });
      }
    }
  });

  it("parses common notations", () => {
    expect(parseKey("8A")).toEqual({ tonic: 9, mode: "minor" });
    expect(parseKey("08b")).toEqual({ tonic: 0, mode: "major" });
    expect(parseKey("C#m")).toEqual({ tonic: 1, mode: "minor" });
    expect(parseKey("Bb major")).toEqual({ tonic: 10, mode: "major" });
    expect(parseKey("E♭ min")).toEqual({ tonic: 3, mode: "minor" });
    expect(parseKey("F#")).toEqual({ tonic: 6, mode: "major" });
    expect(parseKey("13A")).toBeNull();
    expect(parseKey("H minor")).toBeNull();
  });

  it("orders wheel relations", () => {
    const am = { tonic: 9, mode: "minor" as const };
    expect(compareKeys(am, am).relation).toBe("same");
    expect(compareKeys(am, { tonic: 4, mode: "minor" }).relation).toBe("adjacent");
    expect(compareKeys(am, { tonic: 0, mode: "major" }).relation).toBe("relative");
    expect(compareKeys(am, { tonic: 3, mode: "minor" }).relation).toBe("distant");
    expect(compareKeys(am, { tonic: 4, mode: "minor" }).cost).toBeLessThan(compareKeys(am, { tonic: 3, mode: "minor" }).cost);
  });
});

describe("parseTime", () => {
  it("parses times", () => {
    expect(parseTime("3:25")).toBe(205);
    expect(parseTime("1:02:03")).toBe(3723);
    expect(parseTime("241.5")).toBe(241.5);
    expect(parseTime("3:75")).toBeNull();
    expect(parseTime("abc")).toBeNull();
  });
});
