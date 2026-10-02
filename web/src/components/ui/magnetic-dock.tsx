"use client";

import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from "framer-motion";
import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";

// Adapted from Componentry's Magnetic Dock (componentry.dev/r/magnetic-dock): the tiles are
// CDJ rubber keys with an indicator LED, and the labels show on a deck-screen readout.

export interface DockItemData {
  /** Unique identifier */
  id: string;
  /** Display label, also the accessible name */
  label: string;
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
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);

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
    <motion.div
      ref={ref}
      className="relative shrink-0"
      style={{ width: reducedMotion ? iconSize : size, height: reducedMotion ? iconSize : size, y: reducedMotion ? 0 : y }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
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

      <AnimatePresence initial={false}>
        {hovered || focused ? (
          <motion.span
            aria-hidden
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.94 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="pointer-events-none absolute -top-11 left-1/2 z-50 -translate-x-1/2 rounded-[8px] bg-[var(--screen)] px-2.5 py-1.5 text-eyebrow whitespace-nowrap text-on-dark shadow-[0_0_0_2px_var(--screen-bezel),0_0_0_3px_var(--plate-edge),var(--elev-lift)]"
          >
            {item.label}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * A row of keys that swell toward the pointer, like a macOS dock. With reduced motion the
 * keys keep their size and only the labels fade in.
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
