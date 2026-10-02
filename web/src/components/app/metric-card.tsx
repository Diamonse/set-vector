import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A readout on a deck screen: label, large value, and optional detail, always dark like a
 * CDJ display. `meter` (0 to 1) adds a segmented level bar like a mixer's meter; the value
 * text always carries the same information.
 */
export function MetricCard({
  label,
  value,
  unit,
  detail,
  status,
  meter,
  segment = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  detail?: React.ReactNode;
  status?: React.ReactNode;
  meter?: number | null;
  /** Show the value in seven-segment digits, for tempo and time readouts. */
  segment?: boolean;
  className?: string;
}) {
  const unavailable = value === null || value === undefined || value === "";
  const lit = meter === null || meter === undefined ? null : Math.round(Math.max(0, Math.min(1, meter)) * 20);
  return (
    <div className={cn("deck-screen m-1 flex flex-col gap-2 p-5", className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-eyebrow text-muted">{label}</span>
        {status}
      </div>
      <div className={cn("font-mono text-[30px] leading-none font-semibold tracking-[-0.02em] text-ink tabular", segment && "font-segment font-bold tracking-normal")}>
        {unavailable ? <span className="font-sans text-[18px] font-medium tracking-normal text-muted">Unavailable</span> : value}
        {!unavailable && unit ? <span className="ml-1.5 font-sans text-[14px] font-normal tracking-normal text-muted">{unit}</span> : null}
      </div>
      {lit !== null ? (
        <div aria-hidden className="flex gap-[3px]">
          {Array.from({ length: 20 }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-[1px]",
                // One hue for magnitude: a full meter is good coverage, not a warning.
                i < lit ? "bg-action" : "bg-surface-subtle",
              )}
            />
          ))}
        </div>
      ) : null}
      {detail ? <p className="text-caption text-muted">{detail}</p> : null}
    </div>
  );
}
