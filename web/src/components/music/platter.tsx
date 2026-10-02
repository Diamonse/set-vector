import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A CDJ jog platter: a grooved ring around a recessed centre display. `position` (0 to 1)
 * lights the rim marker at that point of a full turn, the way a jog display shows where the
 * track is. Decorative: the surrounding text always carries the meaning. The centre keeps the
 * deck's own near-black in both themes, like the screens.
 */
export function Platter({
  position,
  className,
  children,
}: {
  position?: number | null;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span aria-hidden className={cn("relative flex shrink-0 items-center justify-center rounded-full", className)}>
      <span className="absolute inset-0 rounded-full bg-[repeating-conic-gradient(var(--muted)_0_1.6deg,transparent_1.6deg_12deg)] [mask-image:radial-gradient(circle,transparent_60%,#000_62%,#000_70%,transparent_72%)]" />
      <span className="absolute inset-[22%] rounded-full bg-[var(--screen)] shadow-[0_0_0_2px_#2e2f35,inset_0_2px_8px_rgb(0_0_0/0.8)]" />
      {position !== null && position !== undefined ? (
        <span className="absolute inset-0" style={{ rotate: `${Math.max(0, Math.min(1, position)) * 360}deg` }}>
          <span className="absolute top-[3%] left-1/2 h-[18%] w-[7%] min-w-[2px] -translate-x-1/2 rounded-full bg-[var(--led-orange)] shadow-[0_0_6px_var(--led-orange)]" />
        </span>
      ) : null}
      {children ? <span className="relative flex items-center justify-center text-[#eef1f5]">{children}</span> : null}
    </span>
  );
}
