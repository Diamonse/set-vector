"use client";

import { motion, useAnimationFrame, useMotionValue, useReducedMotion, useTransform, wrap } from "framer-motion";
import { useRef } from "react";
import { cn } from "@/lib/utils";

// Adapted from Componentry's Scroll Based Velocity (componentry.dev/r/scroll-based-velocity).
// The rows move only while the page scrolls, faster with faster scrolling, and follow the
// scroll direction. They never drift on their own, so there is nothing to pause (WCAG 2.2.2),
// and with reduced motion they stand still.

/** Copies of the text in a row; the strip wraps after one copy, 100% / COPIES of its width. */
const COPIES = 8;

function VelocityRow({ children, speed, className }: { children: React.ReactNode; speed: number; className?: string }) {
  const reduceMotion = useReducedMotion();
  const baseX = useMotionValue(0);
  const x = useTransform(baseX, (v) => `${wrap(-100 / COPIES, 0, v)}%`);
  const lastY = useRef<number | null>(null);
  const drift = useRef(0);

  // Reads the scroll position each frame rather than scroll events, so smooth scrolling
  // (Lenis) drives it too; the distance scrolled is eased so the rows glide to a stop.
  useAnimationFrame(() => {
    const y = window.scrollY;
    const dy = lastY.current === null ? 0 : y - lastY.current;
    lastY.current = y;
    drift.current += (dy - drift.current) * 0.2;
    if (reduceMotion || Math.abs(drift.current) < 0.05) return;
    baseX.set(baseX.get() + (speed * drift.current) / 200);
  });

  return (
    <div className="flex overflow-hidden whitespace-nowrap">
      <motion.div className={cn("flex whitespace-nowrap", className)} style={{ x }}>
        {Array.from({ length: COPIES }, (_, i) => (
          <span key={i} className="block pr-10">
            {children}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

/**
 * Two rows of text that slide in opposite directions as the page scrolls, like the scrolling
 * title on a CDJ screen. Decorative: the rows repeat content found elsewhere on the page.
 */
export function ScrollVelocityTicker({
  rows,
  speed = 2,
  className,
  rowClassNames = [],
}: {
  rows: React.ReactNode[];
  /** Percent of the strip moved per 200 px scrolled (one copy of the text is 12.5%). */
  speed?: number;
  className?: string;
  rowClassNames?: string[];
}) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-2", className)}>
      {rows.map((row, i) => (
        <VelocityRow key={i} speed={i % 2 ? -speed : speed} className={rowClassNames[i]}>
          {row}
        </VelocityRow>
      ))}
    </div>
  );
}
