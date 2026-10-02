"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// Adapted from Componentry's Magnet Lines (componentry.dev/r/magnet-lines). One pointer
// listener, throttled to animation frames, turns every needle by writing its style directly;
// the original gave each line its own listener and React state. Needles ease with CSS and hold
// their resting angle for touch and reduced motion.

/**
 * A field of needles, like a bank of tonearms, that turn to point at the cursor. Fills its
 * positioned parent; decorative.
 */
export function MagnetLines({
  rows = 9,
  columns = 7,
  baseAngle = -35,
  className,
}: {
  rows?: number;
  columns?: number;
  /** Resting angle in degrees, before the cursor first moves. */
  baseAngle?: number;
  className?: string;
}) {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const needles = Array.from(grid.querySelectorAll<HTMLElement>("[data-needle]"));
    let centres: { x: number; y: number }[] = [];
    const measure = () => {
      const box = grid.getBoundingClientRect();
      centres = needles.map((n) => {
        const r = n.getBoundingClientRect();
        return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
      });
    };
    let frame = 0;
    let pointer = { x: 0, y: 0 };
    const turn = () => {
      frame = 0;
      const box = grid.getBoundingClientRect();
      needles.forEach((n, i) => {
        const c = centres[i]!;
        const angle = (Math.atan2(pointer.y - box.top - c.y, pointer.x - box.left - c.x) * 180) / Math.PI;
        // The needle is drawn vertically, so a quarter turn lines it up with the cursor.
        n.style.transform = `rotate(${(angle + 90).toFixed(1)}deg)`;
      });
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      pointer = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(turn);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointermove", onMove);
    };
  }, [rows, columns]);

  return (
    <div
      ref={gridRef}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 grid place-items-center", className)}
      style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
    >
      {Array.from({ length: rows * columns }, (_, i) => (
        <span
          key={i}
          data-needle
          className="relative block h-[42%] w-[2px] rounded-full bg-on-dark-muted/40 transition-transform duration-300 ease-out"
          style={{ transform: `rotate(${baseAngle}deg)` }}
        >
          <span className="absolute -top-0.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-[var(--led-orange)] opacity-70" />
        </span>
      ))}
    </div>
  );
}
