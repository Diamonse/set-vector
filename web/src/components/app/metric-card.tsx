import * as React from "react";
import { cn } from "@/lib/utils";

export function MetricCard({
  label,
  value,
  unit,
  detail,
  status,
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  detail?: React.ReactNode;
  status?: React.ReactNode;
  className?: string;
}) {
  const unavailable = value === null || value === undefined || value === "";
  return (
    <div className={cn("flex flex-col gap-1 rounded-[12px] border border-divider bg-surface p-6", className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-ui text-muted">{label}</span>
        {status}
      </div>
      <div className="text-data text-[24px] leading-tight font-semibold text-ink">
        {unavailable ? <span className="font-sans text-[18px] text-muted">Unavailable</span> : value}
        {!unavailable && unit ? <span className="ml-1 font-sans text-[14px] font-normal text-muted">{unit}</span> : null}
      </div>
      {detail ? <p className="text-caption text-muted">{detail}</p> : null}
    </div>
  );
}
