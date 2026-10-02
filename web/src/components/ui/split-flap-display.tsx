"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

// Adapted from Componentry's Split-Flap Display (componentry.dev/r/split-flap-display). Each
// cell shuffles through a few characters before landing, rather than stepping through the
// whole alphabet, so a board settles within about a second and does not re-render on every
// step of every cell. Cells size to the board's width, characters the board cannot show
// become blanks, and with reduced motion the text appears without flipping.

const CHARACTERS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:-+/&#'";

/** Upper-cases text, strips accents, and blanks characters the flaps do not carry. */
export function toFlapText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split("")
    .map((c) => (CHARACTERS.includes(c) ? c : " "))
    .join("");
}

function FlapCell({ target, delay, flips, speed, still }: { target: string; delay: number; flips: number; speed: number; still: boolean }) {
  const [shown, setShown] = useState(" ");
  const [previous, setPrevious] = useState(" ");
  const [step, setStep] = useState(0);
  const shownRef = useRef(" ");

  useEffect(() => {
    if (still || target === " ") {
      shownRef.current = target;
      setShown(target);
      return;
    }
    // A short shuffle of characters picked from the target's position, then the target.
    const sequence = Array.from({ length: flips }, (_, i) => CHARACTERS[(CHARACTERS.indexOf(target) + 7 * (i + 1)) % CHARACTERS.length]!);
    sequence.push(target);
    const timers: number[] = [];
    sequence.forEach((char, i) => {
      timers.push(
        window.setTimeout(() => {
          setPrevious(shownRef.current);
          shownRef.current = char;
          setShown(char);
          setStep((s) => s + 1);
        }, delay + i * speed),
      );
    });
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [target, delay, flips, speed, still]);

  const half = "absolute inset-x-0 h-1/2 overflow-hidden";
  const glyph = "absolute inset-x-0 flex h-[200%] items-center justify-center";
  return (
    <span className="relative block aspect-[5/7] [perspective:300px]">
      {/* Both halves show the current character; each clips its own half of the glyph. */}
      <span className={cn(half, "top-0 rounded-t-[3px] bg-[linear-gradient(180deg,#26272c,#1c1d21)]")}>
        <span className={cn(glyph, "top-0")}>{shown}</span>
      </span>
      <span className={cn(half, "bottom-0 rounded-b-[3px] bg-[linear-gradient(180deg,#17181b,#111214)]")}>
        <span className={cn(glyph, "bottom-0")}>{shown}</span>
      </span>
      {/* The falling leaf carries the previous character over the top half. */}
      {step > 0 && !still ? (
        <span
          key={step}
          className={cn(half, "top-0 z-10 origin-bottom rounded-t-[3px] bg-[linear-gradient(180deg,#2a2b30,#1e1f23)] [backface-visibility:hidden]")}
          style={{ animation: `flap-fall ${Math.round(speed * 0.9)}ms ease-in forwards` }}
        >
          <span className={cn(glyph, "top-0")}>{previous}</span>
        </span>
      ) : null}
      <span className="absolute inset-x-0 top-1/2 z-20 h-px -translate-y-1/2 bg-black/90" />
    </span>
  );
}

/**
 * A departure-board readout: rows of flap cells that shuffle into place, between two LED
 * strips. Decorative; pass the same content as `label` for assistive technology.
 */
export function SplitFlapDisplay({
  rows,
  label,
  columns = 18,
  flips = 5,
  speed = 70,
  stagger = 22,
  className,
}: {
  rows: string[];
  /** The board's content as a sentence for screen readers. */
  label: string;
  columns?: number;
  /** Characters shown before each cell lands. */
  flips?: number;
  /** Milliseconds per flip. */
  speed?: number;
  /** Milliseconds between neighbouring cells starting, for a wave across the row. */
  stagger?: number;
  className?: string;
}) {
  const [still, setStill] = useState(false);
  useEffect(() => setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);

  return (
    <div className={cn("@container w-full max-w-3xl rounded-card bg-[var(--screen)] p-3 shadow-[0_0_0_3px_var(--screen-bezel),0_0_0_4px_var(--plate-edge),var(--elev-card)] sm:p-4", className)}>
      <p className="sr-only">{label}</p>
      <div aria-hidden className="flex flex-col gap-2" style={{ "--flap-cols": columns } as CSSProperties}>
        {rows.map((row, r) => {
          const cells = toFlapText(row).padEnd(columns, " ").slice(0, columns).split("");
          return (
            <div key={r} className="flex items-stretch gap-1.5">
              <span className="w-1 shrink-0 rounded-[2px] bg-[var(--led-orange)] shadow-[0_0_6px_var(--led-orange)]" />
              <div
                className="grid flex-1 gap-[3px] font-mono leading-none font-bold text-[#eef1f5] [font-size:calc((100cqw-2rem)/var(--flap-cols)*0.62)]"
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
              >
                {cells.map((char, i) => (
                  <FlapCell key={i} target={char} delay={r * 120 + i * stagger} flips={flips} speed={speed} still={still} />
                ))}
              </div>
              <span className="w-1 shrink-0 rounded-[2px] bg-[var(--led-orange)] shadow-[0_0_6px_var(--led-orange)]" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
