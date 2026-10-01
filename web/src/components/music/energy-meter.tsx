import { cn } from "@/lib/utils";

/** Ten-segment level meter for a 1 to 10 energy annotation; the number is printed beside it. */
export function EnergyMeter({ value, className }: { value: number; className?: string }) {
  const lit = Math.round(value);
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span aria-hidden className="inline-flex h-3.5 items-end gap-[2px]">
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className={cn("w-[3px] rounded-[1px]", i < lit ? (i >= 8 ? "bg-data-energy" : i >= 5 ? "bg-warning" : "bg-action") : "bg-surface-subtle")}
            style={{ height: `${30 + i * 7}%` }}
          />
        ))}
      </span>
      <span className="font-mono tabular">{value}</span>
    </span>
  );
}
