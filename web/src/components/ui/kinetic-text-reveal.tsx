"use client";

import { motion, useInView, useReducedMotion, type Transition, type Variants } from "framer-motion";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Adapted from Componentry's Kinetic Text Reveal (componentry.dev/r/kinetic-text-reveal).

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
  /** Animation transition for each segment. */
  transition?: Transition;
  /** Adds blur while segments are hidden. */
  blur?: boolean;
  /** Plays after mount, when scrolled into view, or only through the ref. */
  trigger?: "mount" | "inView" | "manual";
  /** Delay before an automatic reveal begins, in seconds. */
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
      segmentClassName,
      maskClassName,
      splitBy = "words",
      direction = "up",
      distance = 20,
      stagger = 0.075,
      staggerFrom = "start",
      transition = { duration: 0.72, ease: [0.22, 1, 0.36, 1] },
      blur = true,
      trigger = "mount",
      delay = 0,
      onRevealStart,
      onRevealComplete,
      ...props
    },
    ref,
  ) => {
    const shouldReduceMotion = useReducedMotion();
    const rootRef = useRef<HTMLSpanElement>(null);
    const inView = useInView(rootRef, { once: true, margin: "0px 0px -12% 0px" });
    const [run, setRun] = useState(0);
    const [visible, setVisible] = useState(false);

    const segments = useMemo(() => getSegments(text, splitBy), [text, splitBy]);
    const animatedTotal = segments.filter((segment) => segment.animated).length;

    useImperativeHandle(ref, () => ({
      play: () => {
        setVisible(false);
        requestAnimationFrame(() => {
          setRun((current) => current + 1);
          setVisible(true);
          onRevealStart?.();
        });
      },
      reset: () => setVisible(false),
    }));

    const armed = trigger === "mount" || (trigger === "inView" && inView);
    useEffect(() => {
      if (!armed) return;
      const timeout = window.setTimeout(() => {
        setRun((current) => current + 1);
        setVisible(true);
        onRevealStart?.();
      }, delay * 1000);
      return () => window.clearTimeout(timeout);
    }, [armed, delay, text, onRevealStart]);

    const offset = getOffset(direction, distance);
    const variants: Variants = {
      hidden: shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: offset.x, y: offset.y, filter: blur ? "blur(6px)" : "blur(0px)" },
      visible: (index: number) => ({
        opacity: 1,
        x: 0,
        y: 0,
        filter: "blur(0px)",
        transition: shouldReduceMotion ? { duration: 0.2 } : { ...transition, delay: getDelay(index, animatedTotal, stagger, staggerFrom) },
      }),
    };

    return (
      <span ref={rootRef} className={cn(splitBy === "lines" ? "inline-flex flex-col items-start" : "inline", className)} {...props}>
        <span className="sr-only">{text}</span>
        {segments.map((segment, index) => {
          if (!segment.animated) {
            return (
              <span key={`${run}-${index}`} aria-hidden="true">
                {segment.value}
              </span>
            );
          }
          return (
            // Padding cancelled by negative margins lets glyphs overhang tight display line heights
            // without being clipped, while each mask still takes exactly one line's height.
            <span
              key={`${run}-${index}`}
              className={cn("-my-[0.12em] inline-block overflow-hidden py-[0.12em] align-bottom", maskClassName)}
              aria-hidden="true"
            >
              <motion.span
                custom={segment.index}
                variants={variants}
                initial="hidden"
                animate={visible ? "visible" : "hidden"}
                className={cn("inline-block will-change-transform", segmentClassName)}
                onAnimationComplete={segment.index === animatedTotal - 1 ? onRevealComplete : undefined}
              >
                {segment.value}
              </motion.span>
            </span>
          );
        })}
      </span>
    );
  },
);

KineticTextReveal.displayName = "KineticTextReveal";
