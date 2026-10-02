"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Adapted from Componentry's Kinetic Text Reveal (componentry.dev/r/kinetic-text-reveal). The
// motion runs as a CSS animation (.kinetic-segment in globals.css) instead of framer-motion, so
// the server and client render the same markup and the text never waits on hydration to appear.

type SplitMode = "words" | "characters" | "lines";
type RevealDirection = "up" | "down" | "left" | "right";
type StaggerOrigin = "start" | "end" | "center" | "edges" | "random" | number;

export interface KineticTextRevealRef {
  /** Starts or replays the reveal animation. */
  play: () => void;
  /** Moves the text back to its hidden state. */
  reset: () => void;
}

interface KineticTextRevealProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Text content to reveal. */
  text: string;
  /** CSS classes applied to each animated text segment. */
  segmentClassName?: string;
  /** CSS classes applied to each clipping wrapper. */
  maskClassName?: string;
  /** How the text is segmented before animation. */
  splitBy?: SplitMode;
  /** Direction each segment travels from. */
  direction?: RevealDirection;
  /** Distance each segment travels in pixels. */
  distance?: number;
  /** Delay between animated segments in seconds. */
  stagger?: number;
  /** Where the stagger wave begins. */
  staggerFrom?: StaggerOrigin;
  /** Duration of each segment's reveal in seconds. */
  duration?: number;
  /** Adds blur while segments are hidden. */
  blur?: boolean;
  /** Plays from first paint, when scrolled into view, or only through the ref. */
  trigger?: "mount" | "inView" | "manual";
  /** Delay before the reveal begins, in seconds. */
  delay?: number;
  /** Called when the reveal begins. */
  onRevealStart?: () => void;
  /** Called after the last segment completes. */
  onRevealComplete?: () => void;
}

interface Segment {
  value: string;
  animated: boolean;
  index: number;
}

function splitIntoGraphemes(value: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    return Array.from(segmenter.segment(value), ({ segment }) => segment);
  }
  return Array.from(value);
}

function getSegments(text: string, splitBy: SplitMode): Segment[] {
  let animatedIndex = 0;
  const parts = splitBy === "lines" ? text.split("\n") : splitBy === "characters" ? splitIntoGraphemes(text) : text.split(/(\s+)/);
  return parts.map((value) => {
    const animated = splitBy === "lines" ? value.length > 0 : value.length > 0 && !/^\s+$/.test(value);
    return { value, animated, index: animated ? animatedIndex++ : -1 };
  });
}

function getDelay(index: number, total: number, stagger: number, staggerFrom: StaggerOrigin) {
  if (typeof staggerFrom === "number") return Math.abs(staggerFrom - index) * stagger;
  if (staggerFrom === "end") return (total - 1 - index) * stagger;
  if (staggerFrom === "center") return Math.abs((total - 1) / 2 - index) * stagger;
  if (staggerFrom === "edges") return Math.min(index, total - 1 - index) * stagger;
  if (staggerFrom === "random") {
    const seeded = Math.abs(Math.sin(index * 12.9898) * 43758.5453) % 1;
    return Math.floor(seeded * total) * stagger;
  }
  return index * stagger;
}

function getOffset(direction: RevealDirection, distance: number) {
  if (direction === "down") return { x: 0, y: -distance };
  if (direction === "left") return { x: distance, y: 0 };
  if (direction === "right") return { x: -distance, y: 0 };
  return { x: 0, y: distance };
}

/**
 * Reveals text segment by segment, each rising out of its own clipping mask. The words flow
 * inline, so several reveals can sit in one heading (to colour a word) and wrap as normal
 * text. Screen readers get the whole string once; the animated copies are hidden from them.
 */
export const KineticTextReveal = forwardRef<KineticTextRevealRef, KineticTextRevealProps>(
  (
    {
      text,
      className,
      style,
      segmentClassName,
      maskClassName,
      splitBy = "words",
      direction = "up",
      distance = 20,
      stagger = 0.075,
      staggerFrom = "start",
      duration = 0.72,
      blur = true,
      trigger = "mount",
      delay = 0,
      onRevealStart,
      onRevealComplete,
      ...props
    },
    ref,
  ) => {
    const rootRef = useRef<HTMLSpanElement>(null);
    // Changing the run remounts the segments, which restarts their CSS animation.
    const [run, setRun] = useState(0);
    const [waiting, setWaiting] = useState(trigger !== "mount");

    const segments = useMemo(() => getSegments(text, splitBy), [text, splitBy]);
    const animatedTotal = segments.filter((segment) => segment.animated).length;

    useImperativeHandle(ref, () => ({
      play: () => {
        setRun((current) => current + 1);
        setWaiting(false);
      },
      reset: () => {
        setRun((current) => current + 1);
        setWaiting(true);
      },
    }));

    useEffect(() => {
      const el = rootRef.current;
      if (trigger !== "inView" || !el) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) return;
          setWaiting(false);
          observer.disconnect();
        },
        { rootMargin: "0px 0px -12% 0px" },
      );
      observer.observe(el);
      return () => observer.disconnect();
    }, [trigger]);

    const offset = getOffset(direction, distance);
    const rootStyle = {
      "--kinetic-x": `${offset.x}px`,
      "--kinetic-y": `${offset.y}px`,
      "--kinetic-blur": blur ? "6px" : "0px",
      "--kinetic-duration": `${duration}s`,
      ...style,
    } as CSSProperties;

    return (
      <span
        ref={rootRef}
        data-kinetic={waiting ? "waiting" : "playing"}
        className={cn(splitBy === "lines" ? "inline-flex flex-col items-start" : "inline", className)}
        style={rootStyle}
        {...props}
      >
        <span className="sr-only">{text}</span>
        {segments.map((segment, index) => {
          if (!segment.animated) {
            return (
              <span key={`${run}-${index}`} aria-hidden="true">
                {segment.value}
              </span>
            );
          }
          const first = segment.index === 0;
          const last = segment.index === animatedTotal - 1;
          return (
            // Padding cancelled by negative margins lets glyphs overhang tight display line heights
            // without being clipped, while each mask still takes exactly one line's height.
            <span
              key={`${run}-${index}`}
              className={cn("-my-[0.12em] inline-block overflow-hidden py-[0.12em] align-bottom", maskClassName)}
              aria-hidden="true"
            >
              <span
                className={cn("kinetic-segment", segmentClassName)}
                style={{ "--kinetic-delay": `${delay + getDelay(segment.index, animatedTotal, stagger, staggerFrom)}s` } as CSSProperties}
                onAnimationStart={first ? onRevealStart : undefined}
                onAnimationEnd={last ? onRevealComplete : undefined}
              >
                {segment.value}
              </span>
            </span>
          );
        })}
      </span>
    );
  },
);

KineticTextReveal.displayName = "KineticTextReveal";
