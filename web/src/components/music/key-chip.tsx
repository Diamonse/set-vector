import { formatCamelot, toCamelot, type MusicalKey } from "@/lib/domain/camelot";
import { cn } from "@/lib/utils";

/** Hue for a Camelot number, so neighbours on the wheel get neighbouring colours. */
export function camelotHue(number: number): number {
  return ((number - 1) * 30 + 150) % 360;
}

/**
 * A Camelot code with its wheel colour. The code is always printed, so colour is never the
 * only signal; minor (A) keys use a deeper tone than major (B).
 */
export function KeyChip({ musicalKey, estimated = false, className }: { musicalKey: MusicalKey; estimated?: boolean; className?: string }) {
  const code = toCamelot(musicalKey);
  const hue = camelotHue(code.number);
  const tone = code.letter === "A" ? "0.66 0.15" : "0.76 0.13";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[13px] leading-5 font-semibold text-ink",
        estimated && "border-dashed",
        className,
      )}
      style={{
        borderColor: `color-mix(in oklab, oklch(${tone} ${hue}) 55%, transparent)`,
        backgroundColor: `color-mix(in oklab, oklch(${tone} ${hue}) 16%, transparent)`,
      }}
    >
      <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: `oklch(${tone} ${hue})` }} />
      {formatCamelot(code)}
    </span>
  );
}
