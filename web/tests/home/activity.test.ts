import { describe, expect, it } from "vitest";
import { activityWeeks, dayKey } from "@/lib/home/activity";

// Local-time dates, so the tests hold in any timezone.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
const flat = (grid: ReturnType<typeof activityWeeks>) => grid.flat().filter((d) => d !== null);

describe("activity calendar", () => {
  const today = new Date(2026, 9, 2); // Friday 2 October 2026

  it("ends on today, starts on a Sunday, and leaves the rest of this week empty", () => {
    const grid = activityWeeks([], today, 53);
    expect(grid).toHaveLength(53);
    expect(grid.every((w) => w.length === 7)).toBe(true);
    const first = grid[0]![0]!;
    expect(new Date(`${first.date}T12:00:00`).getDay()).toBe(0);
    const last = grid.at(-1)!;
    expect(last[5]!.date).toBe(dayKey(today));
    expect(last[6]).toBeNull();
  });

  it("counts events per local day and scales levels against the busiest day", () => {
    const grid = activityWeeks([at(2026, 10, 1, 9), at(2026, 10, 1, 21), at(2026, 10, 1, 23), at(2026, 10, 1, 8), at(2026, 9, 30)], today, 2);
    const days = new Map(flat(grid).map((d) => [d.date, d]));
    expect(days.get("2026-10-01")).toMatchObject({ count: 4, level: 4 });
    expect(days.get("2026-09-30")).toMatchObject({ count: 1, level: 1 });
    expect(days.get("2026-10-02")).toMatchObject({ count: 0, level: 0 });
  });

  it("ignores events outside the window and unreadable timestamps", () => {
    const grid = activityWeeks([at(2020, 1, 1), "not a date", at(2026, 10, 2)], today, 1);
    expect(flat(grid).reduce((sum, d) => sum + d.count, 0)).toBe(1);
  });
});
