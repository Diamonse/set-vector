import { cn } from "@/lib/utils";

/**
 * Decorative waveform built from deterministic bar heights (no audio). Hidden from assistive
 * technology; the surrounding text carries the meaning.
 */
export function WaveformArt({ bars = 72, seed = 1, animated = false, className }: { bars?: number; seed?: number; animated?: boolean; className?: string }) {
  const heights = Array.from({ length: bars }, (_, i) => {
    const x = i / bars;
    const envelope = 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, x * 1.15)) ** 0.6;
    const texture = 0.55 + 0.45 * Math.abs(Math.sin(i * 1.7 + seed) * Math.cos(i * 0.37 + seed * 2));
    return Math.max(0.08, envelope * texture);
  });
  return (
    <div aria-hidden className={cn("flex h-24 items-center gap-[3px]", className)}>
      {heights.map((h, i) => (
        <span
          key={i}
          className={cn("min-w-[2px] flex-1 origin-center rounded-full bg-gradient-to-t from-action via-action-on-dark to-accent-2", animated && i % 3 === 0 && "animate-eq")}
          style={{ height: `${Math.round(h * 100)}%`, opacity: 0.35 + h * 0.65, animationDelay: animated ? `${(i % 7) * -0.23}s` : undefined }}
        />
      ))}
    </div>
  );
}
