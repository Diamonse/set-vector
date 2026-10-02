/**
 * Activity calendar: saved analyses and revisions bucketed by local calendar day into weeks
 * that run Sunday to Saturday, like a contribution graph. The last week ends today; days
 * after today are null so the grid keeps its shape.
 */

export interface ActivityDay {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  count: number;
  /** 0 for no activity, then 1 to 4 by share of the busiest day. */
  level: 0 | 1 | 2 | 3 | 4;
}

export function dayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

export function activityWeeks(timestamps: string[], today: Date, weeks = 53): (ActivityDay | null)[][] {
  const counts = new Map<string, number>();
  for (const iso of timestamps) {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) continue;
    const key = dayKey(at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setDate(end.getDate() - end.getDay() - (weeks - 1) * 7);
  let max = 0;
  for (const [key, count] of counts) if (key >= dayKey(start) && key <= dayKey(end)) max = Math.max(max, count);

  const grid: (ActivityDay | null)[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < weeks; w++) {
    const week: (ActivityDay | null)[] = [];
    for (let d = 0; d < 7; d++) {
      if (cursor > end) week.push(null);
      else {
        const date = dayKey(cursor);
        const count = counts.get(date) ?? 0;
        const level = count === 0 ? 0 : (Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as 1 | 2 | 3 | 4);
        week.push({ date, count, level });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    grid.push(week);
  }
  return grid;
}
