"use client";

import { useEffect, useState } from "react";
import { activityWeeks, type ActivityDay } from "@/lib/home/activity";
import { cn } from "@/lib/utils";

// Adapted from Componentry's GitHub Calendar (componentry.dev/r/github-calendar), in its
// "city lights" variant. It reads the app's own activity instead of fetching from GitHub, and
// draws the year as an LED matrix on a deck screen.

const WEEKS = 53;
const LEVEL: Record<ActivityDay["level"], string> = {
  0: "bg-surface-subtle",
  1: "bg-[color-mix(in_oklab,var(--led-orange)_32%,var(--surface-subtle))]",
  2: "bg-[color-mix(in_oklab,var(--led-orange)_55%,var(--surface-subtle))]",
  3: "bg-[color-mix(in_oklab,var(--led-orange)_78%,var(--surface-subtle))] shadow-[0_0_4px_color-mix(in_oklab,var(--led-orange)_50%,transparent)]",
  4: "bg-[var(--led-orange)] shadow-[0_0_7px_var(--led-orange)]",
};

const longDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/**
 * A year of activity, one LED per day in columns of weeks. Days are grouped by the viewer's
 * own calendar, so the grid fills in after the page loads; until then the matrix shows unlit,
 * at the same size. Hover a day for its count; the summary carries the totals for everyone.
 */
export function LedCalendar({ timestamps, noun = "change" }: { timestamps: string[]; noun?: string }) {
  const [weeks, setWeeks] = useState<(ActivityDay | null)[][] | null>(null);
  useEffect(() => setWeeks(activityWeeks(timestamps, new Date(), WEEKS)), [timestamps]);

  const days = (weeks ?? []).flat().filter((d): d is ActivityDay => d !== null);
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const active = days.filter((d) => d.count > 0).length;
  const busiest = days.reduce<ActivityDay | null>((top, d) => (d.count > (top?.count ?? 0) ? d : top), null);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  // A month label over the first week that contains the 1st of that month.
  const months = (weeks ?? Array.from({ length: WEEKS }, () => [])).map((week) => {
    const first = week.find((d) => d?.date.endsWith("-01"));
    return first ? new Date(`${first.date}T12:00:00`).toLocaleDateString(undefined, { month: "short" }) : "";
  });

  return (
    <figure className="deck-screen m-1 p-4 md:p-5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 text-eyebrow text-muted">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="size-1.5 rounded-full bg-[var(--led-blue)] shadow-[0_0_6px_var(--led-blue)]" />
          Last 12 months
        </span>
        <span>
          {weeks ? (
            <>
              <span className="font-segment text-[14px] tracking-normal text-ink">{total}</span> {total === 1 ? noun : `${noun}s`} on{" "}
              <span className="font-segment text-[14px] tracking-normal text-ink">{active}</span> {active === 1 ? "day" : "days"}
            </>
          ) : (
            "Loading"
          )}
        </span>
      </figcaption>
      <p className="sr-only" aria-live="polite">
        {weeks
          ? `${plural(total, noun)} on ${plural(active, "day")} in the last 12 months.${busiest ? ` Busiest day: ${longDate(busiest.date)}, with ${plural(busiest.count, noun)}.` : ""}`
          : ""}
      </p>
      <div aria-hidden className="mt-3">
        <div className="grid gap-px text-[10px] leading-none text-muted sm:gap-[3px]" style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}>
          {months.map((m, i) => (
            <span key={i} className="h-3 overflow-visible whitespace-nowrap">
              {m}
            </span>
          ))}
        </div>
        <div className="mt-1 grid gap-px sm:gap-[3px]" style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}>
          {Array.from({ length: WEEKS }, (_, w) => (
            <div key={w} className="grid gap-px sm:gap-[3px]">
              {Array.from({ length: 7 }, (_, d) => {
                const day = weeks?.[w]?.[d];
                if (day === null) return <span key={d} className="aspect-square" />;
                return (
                  <span
                    key={d}
                    title={day ? `${longDate(day.date)}: ${plural(day.count, noun)}` : undefined}
                    className={cn("aspect-square rounded-[1.5px] transition-[background-color,box-shadow] duration-300", LEVEL[day?.level ?? 0])}
                    // Lights sweep in from the oldest week, like a display powering up.
                    style={{ transitionDelay: `${w * 6}ms` }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted">
        Less
        {([0, 1, 2, 3, 4] as const).map((l) => (
          <span key={l} className={cn("size-2.5 rounded-[1.5px]", LEVEL[l])} />
        ))}
        More
      </div>
    </figure>
  );
}
