"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Adapted from Componentry's Text Morph (componentry.dev/r/text-morph). This version plays
// through its words once and settles back on the first, so the motion ends within a few
// seconds (WCAG 2.2.2); it waits for the landing intro to lift, keeps its size from first
// paint, and stays on the first word under reduced motion.

export interface TextMorphProps {
  /** Words in order; the sequence ends back on the first. */
  words: string[];
  /** Time each word rests before the next morph begins, in milliseconds. */
  interval?: number;
  /** Duration of the fluid morph itself, in milliseconds. */
  morphDuration?: number;
  /** Wait before the first morph, in milliseconds, after the page is uncovered. */
  startDelay?: number;
  className?: string;
}

const MORPH_BLUR = 12;
const MORPH_THRESHOLD = 18;

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(value: number) {
  const progress = clamp(value);
  return progress * progress * (3 - 2 * progress);
}

function setLayerStyles(element: HTMLSpanElement, opacity: number, blur: number, scale: number) {
  element.style.opacity = opacity.toFixed(4);
  element.style.filter = blur > 0.01 ? `blur(${blur.toFixed(2)}px)` : "none";
  element.style.transform = `translateX(-50%) scale(${scale.toFixed(4)})`;
}

/** Resolves once the landing intro (html[data-intro="on"]) is no longer covering the page. */
function useUncovered() {
  const [uncovered, setUncovered] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const check = () => setUncovered(root.getAttribute("data-intro") !== "on");
    check();
    const observer = new MutationObserver(check);
    observer.observe(root, { attributes: true, attributeFilter: ["data-intro"] });
    return () => observer.disconnect();
  }, []);
  return uncovered;
}

/**
 * A word that melts into the next through a blur-and-threshold filter, then back. Screen
 * readers hear only the first word, which keeps the sentence stable for them.
 */
export function TextMorph({ words, interval = 900, morphDuration = 620, startDelay = 900, className }: TextMorphProps) {
  const values = useMemo(() => words.filter((word) => word.trim().length > 0), [words]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [done, setDone] = useState(values.length < 2);
  const morphsRef = useRef(0);
  const currentLayerRef = useRef<HTMLSpanElement>(null);
  const nextLayerRef = useRef<HTMLSpanElement>(null);
  const stageRef = useRef<HTMLSpanElement>(null);
  const holdTimerRef = useRef<number | undefined>(undefined);
  const frameRef = useRef<number | undefined>(undefined);
  const morphingRef = useRef(false);
  const uncovered = useUncovered();
  const [reducedMotion, setReducedMotion] = useState(false);
  const filterId = `text-morph-threshold-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const safeIndex = currentIndex % Math.max(1, values.length);
  const nextIndex = (safeIndex + 1) % Math.max(1, values.length);
  const currentWord = values[safeIndex] ?? "";
  const nextWord = values[nextIndex] ?? "";

  const measureStage = useCallback((target: "current" | "next", immediate = false) => {
    const stage = stageRef.current;
    const layer = target === "current" ? currentLayerRef.current : nextLayerRef.current;
    if (!stage || !layer) return;
    // offsetWidth/offsetHeight ignore transforms, so both layers are measured at rest.
    if (immediate) {
      const previous = stage.style.transition;
      stage.style.transition = "none";
      stage.style.width = `${layer.offsetWidth}px`;
      void stage.offsetWidth;
      stage.style.transition = previous;
      return;
    }
    stage.style.width = `${layer.offsetWidth}px`;
  }, []);

  useLayoutEffect(() => {
    const currentLayer = currentLayerRef.current;
    const nextLayer = nextLayerRef.current;
    const stage = stageRef.current;
    if (!currentLayer || !nextLayer || !stage) return;
    setLayerStyles(currentLayer, 1, 0, 1);
    setLayerStyles(nextLayer, 0, MORPH_BLUR, 0.992);
    stage.style.filter = "none";
    stage.style.transition = `width ${Math.max(160, morphDuration)}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    measureStage("current", true);
  }, [currentIndex, measureStage, morphDuration]);

  const beginMorph = useCallback(() => {
    const currentLayer = currentLayerRef.current;
    const nextLayer = nextLayerRef.current;
    const stage = stageRef.current;
    if (!currentLayer || !nextLayer || !stage || morphingRef.current) return;

    morphingRef.current = true;
    stage.style.filter = `url(#${filterId})`;
    measureStage("next");
    const startedAt = performance.now();

    const renderFrame = (now: number) => {
      const progress = clamp((now - startedAt) / morphDuration);
      // The incoming word starts early and the outgoing one lingers; their overlap gives the
      // threshold filter enough shared alpha to read as one fluid shape.
      const incoming = smoothstep(clamp(progress / 0.82));
      const outgoing = smoothstep(clamp((progress - 0.18) / 0.82));
      setLayerStyles(currentLayer, Math.pow(1 - outgoing, 0.55), MORPH_BLUR * outgoing, 1 - outgoing * 0.012);
      setLayerStyles(nextLayer, Math.pow(incoming, 0.55), MORPH_BLUR * (1 - incoming), 0.988 + incoming * 0.012);
      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(renderFrame);
        return;
      }
      stage.style.filter = "none";
      morphingRef.current = false;
      morphsRef.current += 1;
      if (morphsRef.current >= values.length) setDone(true);
      setCurrentIndex(nextIndex);
    };
    frameRef.current = window.requestAnimationFrame(renderFrame);
  }, [filterId, measureStage, morphDuration, nextIndex, values.length]);

  useEffect(() => {
    if (done || reducedMotion || !uncovered) return;
    const wait = morphsRef.current === 0 ? startDelay : interval;
    holdTimerRef.current = window.setTimeout(beginMorph, wait);
    return () => window.clearTimeout(holdTimerRef.current);
  }, [beginMorph, currentIndex, done, interval, reducedMotion, startDelay, uncovered]);

  useEffect(
    () => () => {
      window.clearTimeout(holdTimerRef.current);
      if (frameRef.current !== undefined) window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return (
    <span className={cn("relative inline-block max-w-full align-baseline", className)}>
      <span className="sr-only">{values[0]}</span>
      <svg aria-hidden="true" focusable="false" className="pointer-events-none absolute size-0 overflow-hidden">
        <defs>
          <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${MORPH_THRESHOLD} ${-MORPH_THRESHOLD * 0.46}`}
              result="thresholded"
            />
            <feComposite in="SourceGraphic" in2="thresholded" operator="atop" />
          </filter>
        </defs>
      </svg>
      <span ref={stageRef} aria-hidden="true" className="relative block max-w-full select-none">
        {/* In-flow copy of the word: gives the stage its size and baseline before scripts run. */}
        <span className="invisible block w-max whitespace-pre">{currentWord}</span>
        <span
          ref={currentLayerRef}
          className="absolute top-0 left-1/2 block w-max whitespace-pre"
          style={{ transform: "translateX(-50%)", transformOrigin: "center" }}
        >
          {currentWord}
        </span>
        <span
          ref={nextLayerRef}
          className="absolute top-0 left-1/2 block w-max whitespace-pre opacity-0"
          style={{ filter: `blur(${MORPH_BLUR}px)`, transform: "translateX(-50%) scale(0.992)", transformOrigin: "center" }}
        >
          {nextWord}
        </span>
      </span>
    </span>
  );
}
