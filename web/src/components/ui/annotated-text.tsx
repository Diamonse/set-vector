"use client";

// Adapted from Componentry's Annotated Text (componentry.dev/r/annotated-text): marker ink
// in the theme's colours, and drawing waits for the landing intro to lift.

import { cn } from "@/lib/utils";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Every mark is generated rather than hand-drawn: a seeded random walk pushes
 * each sampled point off its ideal line, which is what reads as "drawn by
 * hand". The seed is fixed per mark, so the geometry is computed once at module
 * load and is identical on the server and in the browser.
 */

type Point = { x: number; y: number };

function createRandom(seed: number) {
  let state = seed >>> 0;
  return function next() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** A signed nudge of at most `amount`. */
function shake(rand: () => number, amount: number) {
  return (rand() - 0.5) * 2 * amount;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

/** Curve through the sampled points by anchoring each one and passing through the midpoints. */
function trace(points: Point[], close = false) {
  const [first, ...rest] = points;
  if (!first) return "";

  let d = `M${round(first.x)},${round(first.y)}`;

  rest.forEach((anchor, index) => {
    const next = rest[index + 1];
    if (!next) {
      d += ` L${round(anchor.x)},${round(anchor.y)}`;
      return;
    }
    d += ` Q${round(anchor.x)},${round(anchor.y)} ${round(
      (anchor.x + next.x) / 2,
    )},${round((anchor.y + next.y) / 2)}`;
  });

  return close ? `${d} Z` : d;
}

/** A nearly straight stroke that bows by `sag` and trembles by `wobble`. */
function stroke(
  from: Point,
  to: Point,
  options: { sag?: number; wobble?: number; steps?: number },
  rand: () => number,
) {
  const { sag = 0, wobble = 0.55, steps = 12 } = options;
  const points: Point[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Leave the endpoints exactly where they were asked for, so marks butt up
    // against the edges of their box predictably.
    const loose = i === 0 || i === steps ? 0 : 1;
    points.push({
      x: from.x + (to.x - from.x) * t + shake(rand, wobble) * loose,
      y:
        from.y +
        (to.y - from.y) * t +
        Math.sin(t * Math.PI) * sag +
        shake(rand, wobble) * loose,
    });
  }

  return points;
}

/** A horizontal sine, sampled four times per cycle. */
function wave(
  from: Point,
  to: Point,
  options: { amplitude: number; cycles: number; wobble?: number },
  rand: () => number,
) {
  const { amplitude, cycles, wobble = 0.35 } = options;
  const steps = Math.round(cycles * 4);
  const points: Point[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: from.x + (to.x - from.x) * t,
      y:
        from.y +
        (to.y - from.y) * t +
        Math.sin(t * cycles * Math.PI * 2) * amplitude +
        shake(rand, wobble),
    });
  }

  return points;
}

/** An elliptical sweep whose radius drifts as it goes around. */
function arc(
  center: Point,
  radii: { rx: number; ry: number },
  sweep: { from: number; to: number },
  options: { wobble?: number; steps?: number },
  rand: () => number,
) {
  const { wobble = 0.03, steps = 28 } = options;
  const points: Point[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = ((sweep.from + (sweep.to - sweep.from) * t) * Math.PI) / 180;
    const drift = 1 + shake(rand, wobble);
    points.push({
      x: center.x + Math.cos(angle) * radii.rx * drift,
      y: center.y + Math.sin(angle) * radii.ry * drift,
    });
  }

  return points;
}

type Stroke = {
  d: string;
  width?: number;
  opacity?: number;
  fill?: boolean;
};

function wavyStrokes(): Stroke[] {
  const rand = createRandom(17);
  return [
    {
      d: trace(
        wave(
          { x: 2, y: 7 },
          { x: 138, y: 7 },
          { amplitude: 3, cycles: 9 },
          rand,
        ),
      ),
      width: 2.2,
    },
  ];
}

function underlineStrokes(): Stroke[] {
  const rand = createRandom(23);
  return [
    { d: trace(stroke({ x: 3, y: 6 }, { x: 137, y: 5 }, { sag: -2 }, rand)) },
  ];
}

function doubleUnderlineStrokes(): Stroke[] {
  const rand = createRandom(41);
  return [
    { d: trace(stroke({ x: 3, y: 5 }, { x: 137, y: 4 }, { sag: -2 }, rand)) },
    {
      d: trace(stroke({ x: 5, y: 12 }, { x: 135, y: 11 }, { sag: -1.2 }, rand)),
      width: 1.8,
      opacity: 0.75,
    },
  ];
}

function strikethroughStrokes(): Stroke[] {
  const rand = createRandom(59);
  return [
    { d: trace(stroke({ x: 3, y: 5 }, { x: 137, y: 5 }, { sag: 1.2 }, rand)) },
  ];
}

function crossOutStrokes(): Stroke[] {
  const rand = createRandom(73);
  return [
    {
      d: trace(
        stroke({ x: 4, y: 32 }, { x: 136, y: 8 }, { sag: -4, wobble: 1 }, rand),
      ),
    },
    {
      d: trace(
        stroke({ x: 6, y: 10 }, { x: 134, y: 30 }, { sag: 4, wobble: 1 }, rand),
      ),
      width: 2,
      opacity: 0.7,
    },
  ];
}

function arrowStrokes(): Stroke[] {
  const rand = createRandom(89);
  return [
    { d: trace(stroke({ x: 3, y: 7 }, { x: 140, y: 8 }, { sag: -2.5 }, rand)) },
    {
      d: trace([
        { x: 132, y: 3 },
        { x: 142, y: 8 },
        { x: 131, y: 13 },
      ]),
    },
  ];
}

function circleStrokes(): Stroke[] {
  const rand = createRandom(101);
  return [
    {
      d: trace(
        arc(
          { x: 110, y: 32 },
          { rx: 100, ry: 27 },
          { from: 150, to: 520 },
          { wobble: 0.035 },
          rand,
        ),
      ),
      width: 3,
    },
    {
      d: trace(
        arc(
          { x: 110, y: 32 },
          { rx: 95, ry: 24 },
          { from: 165, to: 480 },
          { wobble: 0.03 },
          rand,
        ),
      ),
      width: 1.5,
      opacity: 0.55,
    },
  ];
}

function boxStrokes(): Stroke[] {
  const rand = createRandom(127);
  const topLeft = { x: 12, y: 10 };
  const topRight = { x: 188, y: 10 };
  const bottomRight = { x: 188, y: 54 };
  const bottomLeft = { x: 12, y: 54 };

  // The long edges bow outward; the short ones just tremble.
  const outline = [
    ...stroke(topLeft, topRight, { sag: -3, steps: 8 }, rand),
    ...stroke(topRight, bottomRight, { steps: 4 }, rand),
    ...stroke(bottomRight, bottomLeft, { sag: 3, steps: 8 }, rand),
    ...stroke(bottomLeft, topLeft, { steps: 4 }, rand),
  ];

  return [{ d: trace(outline, true), width: 2.6 }];
}

function bracketStrokes(): Stroke[] {
  const rand = createRandom(149);
  return [
    {
      d: trace(
        arc(
          { x: 30, y: 30 },
          { rx: 24, ry: 34 },
          { from: 130, to: 230 },
          { steps: 14 },
          rand,
        ),
      ),
      width: 2.6,
    },
    {
      d: trace(
        arc(
          { x: 130, y: 30 },
          { rx: 24, ry: 34 },
          { from: 50, to: -50 },
          { steps: 14 },
          rand,
        ),
      ),
      width: 2.6,
    },
  ];
}

function highlightStrokes(): Stroke[] {
  const rand = createRandom(163);
  // A closed blob: along the top, down the right end, back along the bottom.
  const outline = [
    ...stroke({ x: 5, y: 6 }, { x: 165, y: 5 }, { sag: -2, steps: 10 }, rand),
    ...stroke({ x: 165, y: 5 }, { x: 165, y: 21 }, { steps: 3 }, rand),
    ...stroke({ x: 165, y: 21 }, { x: 5, y: 22 }, { sag: 2, steps: 10 }, rand),
    ...stroke({ x: 5, y: 22 }, { x: 5, y: 6 }, { steps: 3 }, rand),
  ];

  return [{ d: trace(outline, true), fill: true }];
}

type MarkDefinition = {
  wrapper: string;
  decoration: string;
  color: string;
  viewBox?: string;
  strokes?: Stroke[];
  /** Marks that are plain CSS rather than a drawing. */
  css?: string;
  /** Filled marks sit behind the glyphs instead of on top of them. */
  behindText?: boolean;
};

const marks = {
  wavy: {
    wrapper: "relative inline-block whitespace-nowrap",
    decoration:
      "pointer-events-none absolute bottom-[-0.4em] left-[-2%] h-[0.7em] w-[104%]",
    color: "text-action",
    viewBox: "0 0 140 14",
    strokes: wavyStrokes(),
  },
  underline: {
    wrapper: "relative inline-block whitespace-nowrap",
    decoration:
      "pointer-events-none absolute bottom-[-0.32em] left-[-1%] h-[0.5em] w-[102%]",
    color: "text-action",
    viewBox: "0 0 140 10",
    strokes: underlineStrokes(),
  },
  doubleUnderline: {
    wrapper: "relative inline-block whitespace-nowrap",
    decoration:
      "pointer-events-none absolute bottom-[-0.5em] left-[-1%] h-[0.7em] w-[102%]",
    color: "text-success",
    viewBox: "0 0 140 16",
    strokes: doubleUnderlineStrokes(),
  },
  dottedUnderline: {
    wrapper: "relative inline-block whitespace-nowrap",
    decoration:
      "pointer-events-none absolute bottom-[-0.35em] left-[-1%] block h-[0.55em] w-[102%]",
    color: "text-muted",
    css: cn(
      "bg-[radial-gradient(circle,currentColor_1.5px,transparent_1.5px)]",
      "bg-size-[0.5em_100%] bg-position-[0_100%] bg-repeat-x",
    ),
  },
  line: {
    wrapper: "relative inline-block whitespace-nowrap",
    decoration:
      "pointer-events-none absolute bottom-[-0.18em] left-[-1%] block h-[2px] w-[102%]",
    color: "text-muted",
    css: "rounded-full bg-current",
  },
  arrow: {
    wrapper: "relative inline-block whitespace-nowrap",
    decoration:
      "pointer-events-none absolute bottom-[-0.45em] left-[-1%] h-[0.8em] w-[106%]",
    color: "text-accent-2",
    viewBox: "0 0 150 18",
    strokes: arrowStrokes(),
  },
  highlight: {
    wrapper: "relative inline-block whitespace-nowrap",
    decoration:
      "pointer-events-none absolute inset-x-[-4%] bottom-[-0.08em] z-0 h-[1.15em] w-[108%]",
    color: "text-[color-mix(in_oklab,var(--led-amber)_45%,transparent)]",
    viewBox: "0 0 170 26",
    strokes: highlightStrokes(),
    behindText: true,
  },
  circle: {
    wrapper: "relative inline-block px-1 whitespace-nowrap",
    decoration:
      "pointer-events-none absolute inset-[-0.6em_-0.55em] h-[calc(100%+1.2em)] w-[calc(100%+1.1em)]",
    color: "text-accent-2",
    viewBox: "0 0 220 64",
    strokes: circleStrokes(),
  },
  box: {
    wrapper: "relative inline-block px-[0.4em] whitespace-nowrap",
    decoration:
      "pointer-events-none absolute inset-[-0.4em_-0.4em] h-[calc(100%+0.8em)] w-[calc(100%+0.8em)]",
    color: "text-action",
    viewBox: "0 0 200 64",
    strokes: boxStrokes(),
  },
  bracket: {
    wrapper: "relative inline-block px-[0.35em] whitespace-nowrap",
    decoration:
      "pointer-events-none absolute inset-y-[-0.25em] left-[-0.15em] h-[calc(100%+0.5em)] w-[calc(100%+0.3em)]",
    color: "text-muted",
    viewBox: "0 0 160 60",
    strokes: bracketStrokes(),
  },
  strikethrough: {
    wrapper: "relative inline-block whitespace-nowrap",
    decoration:
      "pointer-events-none absolute top-1/2 left-[-1%] h-[0.5em] w-[102%] -translate-y-1/2",
    color: "text-error",
    viewBox: "0 0 140 10",
    strokes: strikethroughStrokes(),
  },
  crossOut: {
    wrapper: "relative inline-block whitespace-nowrap",
    decoration:
      "pointer-events-none absolute top-1/2 left-[-2%] h-[1.4em] w-[104%] -translate-y-1/2",
    color: "text-error",
    viewBox: "0 0 140 40",
    strokes: crossOutStrokes(),
  },
} satisfies Record<string, MarkDefinition>;

export type AnnotationVariant = keyof typeof marks;

export interface AnnotatedTextProps {
  /** The words to annotate. Kept on a single line so the drawing lines up. */
  children: ReactNode;
  /** Which hand-drawn mark to draw. */
  variant?: AnnotationVariant;
  /** Tailwind text color class for the mark, e.g. "text-rose-400". */
  color?: string;
  /** Draw the annotation when it first enters the viewport. */
  animate?: boolean;
  /** Delay before drawing, in seconds. */
  delay?: number;
  /** Drawing duration, in seconds. */
  duration?: number;
  /** Additional classes applied to the wrapper. */
  className?: string;
  /** Classes for the mark itself, to adjust its placement for unusual line heights. */
  decorationClassName?: string;
}

export function AnnotatedText({
  children,
  variant = "wavy",
  color,
  className,
  decorationClassName,
  animate = true,
  delay = 0,
  duration = 0.65,
}: AnnotatedTextProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = ref.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!element || !animate || reducedMotion.matches) return;

    const drawings = element.querySelectorAll("[data-annotation-drawing]");
    const animations = Array.from(drawings, (drawing, index) => {
      const reveal =
        drawing.getAttribute("data-annotation-drawing") === "reveal";
      const opacity = Number(drawing.getAttribute("opacity") ?? 1);
      const animation = drawing.animate(
        reveal
          ? [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }]
          : [
              // A zero-length dash still paints a round cap. Keep it invisible
              // during the delay, then reveal it as the stroke begins moving.
              {
                strokeDasharray: "1",
                strokeDashoffset: "1",
                opacity: 0,
                offset: 0,
              },
              {
                strokeDasharray: "1",
                strokeDashoffset: "0.999",
                opacity,
                offset: 0.001,
              },
              {
                strokeDasharray: "1",
                strokeDashoffset: "0",
                opacity,
                offset: 1,
              },
            ],
        {
          duration: Math.max(0, duration) * 1000,
          delay: Math.max(0, delay) * 1000 + index * 160,
          easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
          fill: "backwards",
        },
      );
      animation.pause();
      return animation;
    });
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        animations.forEach((animation) => animation.play());
        observer.disconnect();
      },
      { threshold: 0.25 },
    );
    // Hold until the landing intro has lifted, so the marks are drawn where they can be seen.
    const root = document.documentElement;
    const intro = new MutationObserver(() => {
      if (root.getAttribute("data-intro") === "on") return;
      intro.disconnect();
      observer.observe(element);
    });
    if (root.getAttribute("data-intro") === "on") intro.observe(root, { attributes: true, attributeFilter: ["data-intro"] });
    else observer.observe(element);

    const finish = () => {
      if (!reducedMotion.matches) return;
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
    };
    reducedMotion.addEventListener("change", finish);
    return () => {
      intro.disconnect();
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
      reducedMotion.removeEventListener("change", finish);
    };
  }, [animate, delay, duration, variant]);

  const mark: MarkDefinition = marks[variant];
  const decorationClass = cn(mark.decoration, color ?? mark.color, decorationClassName);

  return (
    <span ref={ref} className={cn(mark.wrapper, className)}>
      {mark.behindText ? (
        // The mark is an opaque fill, so the words ride on top of it as ink.
        <span className="relative z-10">{children}</span>
      ) : (
        children
      )}

      {mark.css ? (
        <span
          aria-hidden="true"
          data-annotation-drawing="reveal"
          className={cn("block", decorationClass, mark.css)}
        />
      ) : (
        <svg
          className={cn(decorationClass, mark.behindText && "z-0")}
          viewBox={mark.viewBox}
          fill="none"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {mark.strokes?.map((line) => (
            <path
              key={line.d}
              d={line.d}
              pathLength={1}
              data-annotation-drawing={line.fill ? "reveal" : "stroke"}
              fill={line.fill ? "currentColor" : "none"}
              stroke={line.fill ? "none" : "currentColor"}
              strokeWidth={line.fill ? undefined : (line.width ?? 2.4)}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={line.opacity}
            />
          ))}
        </svg>
      )}
    </span>
  );
}
