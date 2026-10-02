"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Adapted from Componentry's Wheel Carousel (componentry.dev/r/wheel-carousel). Each item brings
// its own preview instead of a remote photo, colours come from the theme, and the wheel never
// captures mouse-wheel scrolling, so the page always scrolls past it; drag it like a platter,
// use the arrow keys, or press the step keys.

export interface WheelItem {
  label: string;
  preview: ReactNode;
}

function wrap(index: number, length: number) {
  return ((index % length) + length) % length;
}

/** Signed distance from the wheel's position to an item, taking the short way round. */
function offsetOf(index: number, rotation: number, length: number) {
  let offset = index - rotation;
  while (offset > length / 2) offset -= length;
  while (offset < -length / 2) offset += length;
  return offset;
}

/**
 * Labels set around the edge of a wheel, the chosen one level with a marker, and its preview
 * beside it. Drags carry momentum and settle on the nearest label, like a jog wheel snapping
 * to a cue. A listbox for assistive technology, announcing the chosen item.
 */
export function WheelCarousel({
  items,
  label,
  radius = 260,
  spacing = 15,
  visible = 4,
  className,
}: {
  items: WheelItem[];
  /** Accessible name for the wheel. */
  label: string;
  /** Wheel radius in pixels. */
  radius?: number;
  /** Degrees between neighbouring labels. */
  spacing?: number;
  /** Labels shown on each side of the chosen one. */
  visible?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const id = useId();
  const count = items.length;
  const [rotation, setRotation] = useState(0);
  const [selected, setSelected] = useState(0);
  const [dragging, setDragging] = useState(false);
  const rotationRef = useRef(0);
  const velocity = useRef(0);
  const drag = useRef<{ y: number; rotation: number; last: number } | null>(null);
  const frame = useRef<number | null>(null);

  const commit = useCallback(
    (next: number) => {
      rotationRef.current = next;
      setRotation(next);
      setSelected(wrap(Math.round(next), count));
    },
    [count],
  );

  // Momentum after a release, then a spring to the nearest label.
  const settle = useCallback(() => {
    if (frame.current !== null) return;
    const tick = () => {
      let again = false;
      if (!drag.current && Math.abs(velocity.current) > 0.001 && !reduceMotion) {
        commit(rotationRef.current + velocity.current);
        velocity.current *= 0.9;
        again = true;
      } else if (!drag.current) {
        velocity.current = 0;
        const target = Math.round(rotationRef.current);
        const delta = target - rotationRef.current;
        if (Math.abs(delta) > 0.001 && !reduceMotion) {
          commit(rotationRef.current + delta * 0.22);
          again = true;
        } else commit(target);
      }
      frame.current = again ? requestAnimationFrame(tick) : null;
    };
    frame.current = requestAnimationFrame(tick);
  }, [commit, reduceMotion]);

  useEffect(() => () => void (frame.current !== null && cancelAnimationFrame(frame.current)), []);

  const step = (by: number) => {
    velocity.current = 0;
    commit(Math.round(rotationRef.current) + by);
    settle();
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || e.button !== 0) return;
    drag.current = { y: e.clientY, rotation: rotationRef.current, last: rotationRef.current };
    velocity.current = 0;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = drag.current.rotation - (e.clientY - drag.current.y) * 0.02;
    velocity.current = next - drag.current.last;
    drag.current.last = next;
    commit(next);
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    settle();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    if (e.key in moves) {
      e.preventDefault();
      step(moves[e.key]!);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      step((e.key === "Home" ? 0 : count - 1) - selected);
    }
  };

  const chosen = items[selected]!;
  return (
    <div className={cn("grid items-stretch gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]", className)}>
      <div className="relative min-h-56">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={selected}
            initial={reduceMotion ? false : { opacity: 0, scale: 1.03, filter: "blur(4px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, filter: "blur(4px)" }}
            transition={{ duration: reduceMotion ? 0 : 0.35 }}
            className="h-full"
          >
            {chosen.preview}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-stretch gap-3">
        <div
          role="listbox"
          aria-label={label}
          aria-activedescendant={`${id}-${selected}`}
          tabIndex={0}
          className={cn(
            "relative h-72 flex-1 touch-none overflow-hidden rounded-inset select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action",
            dragging ? "cursor-grabbing" : "cursor-grab",
          )}
          style={{ maskImage: "linear-gradient(to bottom, transparent, #000 28%, #000 72%, transparent)" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={onKeyDown}
        >
          {/* The marker: a lit cue LED level with the chosen label. */}
          <span aria-hidden className="absolute top-1/2 left-2 z-10 h-[3px] w-4 -translate-y-1/2 rounded-full bg-[var(--led-orange)] shadow-[0_0_8px_var(--led-orange)]" />
          {items.map((item, index) => {
            const offset = offsetOf(index, rotation, count);
            const hidden = Math.abs(offset) > visible + 1;
            const angle = offset * spacing;
            const rad = (angle * Math.PI) / 180;
            const x = -radius * (1 - Math.cos(rad));
            const y = radius * Math.sin(rad);
            const fade = Math.cos((Math.min(Math.abs(offset) / visible, 1) * Math.PI) / 2);
            const isSelected = index === selected;
            return (
              <div
                key={item.label}
                id={`${id}-${index}`}
                role="option"
                aria-selected={isSelected}
                className={cn(
                  "pointer-events-none absolute top-1/2 left-10 origin-left font-[family-name:var(--font-display)] text-[28px] leading-none font-extrabold whitespace-nowrap uppercase",
                  isSelected ? "text-ink" : "text-muted",
                )}
                style={{
                  visibility: hidden ? "hidden" : undefined,
                  opacity: fade,
                  transform: `translate(${x}px, ${y}px) translateY(-50%) rotate(${angle}deg) scale(${1 - Math.min(Math.abs(offset) * 0.05, 0.4)})`,
                }}
              >
                {item.label}
              </div>
            );
          })}
        </div>
        <div className="flex flex-col justify-center gap-2">
          <button type="button" onClick={() => step(-1)} aria-label="Previous" className="key flex size-11 items-center justify-center rounded-full">
            <ChevronUp className="size-4" aria-hidden />
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Next" className="key flex size-11 items-center justify-center rounded-full">
            <ChevronDown className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {chosen.label}, {selected + 1} of {count}
      </p>
    </div>
  );
}
