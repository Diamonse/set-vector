import { describe, expect, it } from "vitest";
import { artistTokens } from "@/lib/planner/artists";

describe("artist tokens", () => {
  it("splits on featuring credits in every common spelling", () => {
    expect(artistTokens("Audion featuring Ellen")).toEqual(["audion", "ellen"]);
    expect(artistTokens("Audion feat. Ellen")).toEqual(["audion", "ellen"]);
    expect(artistTokens("Audion Feat Ellen")).toEqual(["audion", "ellen"]);
    expect(artistTokens("Audion ft. Ellen")).toEqual(["audion", "ellen"]);
  });

  it("keeps names that only start with feat or ft", () => {
    expect(artistTokens("Featurecast")).toEqual(["featurecast"]);
    expect(artistTokens("Fthr")).toEqual(["fthr"]);
  });

  it("splits on separators and a standalone x", () => {
    expect(artistTokens("A & B, C / D; E x F")).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(artistTokens("Xinobi")).toEqual(["xinobi"]);
  });
});
