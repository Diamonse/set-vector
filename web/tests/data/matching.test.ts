import { describe, expect, it } from "vitest";
import { uniqueTwin } from "@/lib/data/matching";

const track = (id: string, title: string, artist: string, duration_seconds: number | string) => ({ id, title, artist, duration_seconds });

describe("uniqueTwin", () => {
  it("matches a Rekordbox import by title, artist and whole-second length", () => {
    const imported = track("r", "Free Your Mind (Main)", "Chapter and Verse", "217.000");
    expect(uniqueTwin([imported], "free your  mind (main)", " Chapter and Verse", 217.92)).toBe(imported);
  });

  it("rejects a different length, title or artist", () => {
    expect(uniqueTwin([track("r", "DIY (Extended)", "Dissolut", 287)], "DIY (Extended)", "Dissolut", 290)).toBeNull();
    expect(uniqueTwin([track("r", "DIY (QuickHitter)", "Dissolut", 287)], "DIY (Extended)", "Dissolut", 287)).toBeNull();
    expect(uniqueTwin([track("r", "DIY (Extended)", "Someone", 287)], "DIY (Extended)", "Dissolut", 287)).toBeNull();
  });

  it("gives null when two tracks match, so neither is guessed", () => {
    const twins = [track("a", "Desire (Extended)", "Artist", 300), track("b", "Desire (Extended)", "Artist", 301)];
    expect(uniqueTwin(twins, "Desire (Extended)", "Artist", 300.4)).toBeNull();
  });
});
