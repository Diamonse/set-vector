import * as React from "react";
import { cn } from "@/lib/utils";

export interface ReadoutItem {
  label: string;
  value: React.ReactNode;
  /** Seven-segment digits, for counts, tempo, and time. */
  segment?: boolean;
}

/**
 * The info bar along the top of a CDJ screen: a row of labelled readouts on an always-dark
 * display, folding into a two-column grid on phones. A description list, so each value is
 * read with its label.
 */
export function DeckReadout({ items, className }: { items: ReadoutItem[]; className?: string }) {
  return (
    <dl
      className={cn(
        "deck-screen m-1 grid sm:inline-grid sm:auto-cols-max sm:grid-flow-col sm:grid-cols-none [&>div]:border-divider",
        items.length > 1 ? "grid-cols-2" : "grid-cols-1",
        // Rules between cells: down the middle and between rows on phones, between columns above.
        "max-sm:[&>div:nth-child(even)]:border-l max-sm:[&>div:nth-child(n+3)]:border-t sm:[&>div+div]:border-l",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex min-w-[5.5rem] flex-col gap-1.5 px-4 py-2.5">
          <dt className="text-eyebrow text-muted">{item.label}</dt>
          <dd className={cn("leading-none text-ink tabular", item.segment ? "font-segment text-[20px]" : "font-mono text-[18px] font-semibold")}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
