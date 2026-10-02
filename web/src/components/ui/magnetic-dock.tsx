"use client";

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from "framer-motion";
import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";

// Adapted from Componentry's Magnetic Dock (componentry.dev/r/magnetic-dock): the tiles are
// CDJ rubber keys with an indicator LED, and each has its legend printed on the plate below,
// as deck hardware does, so the labels are always visible rather than shown on hover.

export interface DockItemData {
  /** Unique identifier */
  id: string;
  /** Accessible name */
  label: string;
  /** Short legend printed under the key; defaults to the label */
  legend?: string;
  /** Icon; it is hidden from assistive technology */
  icon: React.ReactNode;
  /** Renders a link when set, otherwise a button */
  href?: string;
  /** Click handler */
  onClick?: () => void;
  /** Whether the item is the current page (links) or the pressed option (buttons) */
  isActive?: boolean;
  /** Draws a divider before the item, to group it apart from the ones before */
  separated?: boolean;
}

interface MagneticDockProps {
  /** Dock items, left to right */
  items: DockItemData[];
  /** Resting tile size in pixels */
  iconSize?: number;
  /** Scale of the tile under the pointer */
  maxScale?: number;
  /** Pointer distance in pixels over which neighbouring tiles grow */
  magneticDistance?: number;
  className?: string;
}

const SPRING = { damping: 20, stiffness: 300, mass: 0.5 };

function DockItem({
  item,
  mouseX,
  iconSize,
  maxScale,
  magneticDistance,
  reducedMotion,
}: {
  item: DockItemData;
  mouseX: MotionValue<number>;
  iconSize: number;
  maxScale: number;
  magneticDistance: number;
  reducedMotion: boolean;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  // Distance from the pointer to this tile's centre drives its size: closer is larger.
  const distance = useTransform(mouseX, (x: number) => {
    const rect = ref.current?.getBoundingClientRect();
    return rect ? x - (rect.left + rect.width / 2) : magneticDistance + 1;
  });
  const scale = useSpring(useTransform(distance, [-magneticDistance, 0, magneticDistance], [1, maxScale, 1]), SPRING);
  const size = useTransform(scale, (s) => s * iconSize);
  const y = useSpring(useTransform(scale, (s) => (s - 1) * -10), SPRING);

  const tileClass = cn(
    "key flex size-full items-center justify-center rounded-[12px] no-underline",
    "before:absolute before:top-[5px] before:left-1/2 before:-ml-[6px] before:h-[3px] before:w-3 before:rounded-[2px]",
    item.isActive
      ? "before:bg-[var(--led-blue)] before:shadow-[0_0_6px_var(--led-blue)]"
      : "before:bg-[color-mix(in_oklab,var(--key-ink)_22%,transparent)]",
  );
  const icon = (
    <span aria-hidden className="flex size-[46%] items-center justify-center [&_svg]:size-full">
      {item.icon}
    </span>
  );

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <motion.div
        ref={ref}
        className="relative"
        style={{ width: reducedMotion ? iconSize : size, height: reducedMotion ? iconSize : size, y: reducedMotion ? 0 : y }}
      >
        {item.href ? (
          <Link
            href={item.href}
            aria-label={item.label}
            aria-current={item.isActive ? "page" : undefined}
            onClick={item.onClick}
            className={tileClass}
          >
            {icon}
          </Link>
        ) : (
          <button type="button" aria-label={item.label} onClick={item.onClick} className={cn(tileClass, "cursor-pointer")}>
            {icon}
          </button>
        )}
      </motion.div>
      <span aria-hidden className={cn("font-mono text-[10px] leading-none font-semibold tracking-[0.12em] whitespace-nowrap uppercase", item.isActive ? "text-ink" : "text-muted")}>
        {item.legend ?? item.label}
      </span>
    </div>
  );
}

/**
 * A row of keys that swell toward the pointer, like a macOS dock. With reduced motion the
 * keys keep their size.
 */
export function MagneticDock({ items, iconSize = 44, maxScale = 1.45, magneticDistance = 120, className }: MagneticDockProps) {
  const mouseX = useMotionValue(Infinity);
  const reducedMotion = useReducedMotion() ?? false;

  return (
    <div
      onMouseMove={reducedMotion ? undefined : (e) => mouseX.set(e.clientX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      className={cn("panel flex items-end gap-2 px-2.5 pt-2.5 pb-3 shadow-lift", className)}
    >
      {items.map((item) => (
        <React.Fragment key={item.id}>
          {item.separated ? <span aria-hidden className="mx-1 w-px self-stretch bg-[var(--plate-edge)]" /> : null}
          <DockItem
            item={item}
            mouseX={mouseX}
            iconSize={iconSize}
            maxScale={maxScale}
            magneticDistance={magneticDistance}
            reducedMotion={reducedMotion}
          />
        </React.Fragment>
      ))}
    </div>
  );
}
