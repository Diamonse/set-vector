import { LetterCascade } from "@/components/ui/letter-cascade";
import { cn } from "@/lib/utils";

/** The SetVector mark: four level-meter bars rising into a set. */
export function LogoMark({ className, animated = false }: { className?: string; animated?: boolean }) {
  const bars = [0.45, 0.8, 0.6, 1];
  return (
    <span aria-hidden className={cn("inline-flex h-5 items-end gap-[3px]", className)}>
      {bars.map((h, i) => (
        <span
          key={i}
          className={cn("w-[4px] origin-bottom rounded-full bg-action", animated && "animate-eq")}
          style={{ height: `${h * 100}%`, animationDelay: animated ? `${i * -0.35}s` : undefined }}
        />
      ))}
    </span>
  );
}

/** The wordmark. With `cascade`, clicking its link sends the letters round in a wave. */
export function Logo({ className, cascade = false }: { className?: string; cascade?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-[family-name:var(--font-display)] text-[22px] leading-none font-extrabold tracking-[0.03em] text-ink uppercase", className)}>
      <LogoMark />
      {cascade ? <LetterCascade text="SetVector" /> : "SetVector"}
    </span>
  );
}
