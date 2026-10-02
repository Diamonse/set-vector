"use client";

import { motion, stagger, useAnimate } from "framer-motion";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// Adapted from Componentry's Letter Cascade (componentry.dev/r/letter-cascade). It plays when
// its surrounding link (or itself) is activated, by mouse or keyboard, and does nothing under
// reduced motion. The letters are hidden from assistive technology; the text is read once.

/**
 * Text whose letters tip back and restack from below in a wave, like a split-flap row
 * resetting. Decorative: the words read the same before and after.
 */
export function LetterCascade({ text, className, staggerDuration = 0.035 }: { text: string; className?: string; staggerDuration?: number }) {
  const [scope, animate] = useAnimate<HTMLSpanElement>();
  const running = useRef(false);

  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    const target = root.closest("a, button") ?? root;
    const play = async () => {
      if (running.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      running.current = true;
      const spring = { type: "spring" as const, stiffness: 240, damping: 17, delay: stagger(staggerDuration) };
      await Promise.all([
        animate(".cascade-front", { rotateX: 90, opacity: 0, y: -6, filter: "blur(4px)" }, spring),
        animate(".cascade-echo", { rotateX: 0, opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }, spring),
      ]);
      // Swap back without motion: the echo now shows what the front showed.
      await Promise.all([
        animate(".cascade-front", { rotateX: 0, opacity: 1, y: 0, filter: "blur(0px)" }, { duration: 0 }),
        animate(".cascade-echo", { rotateX: -90, opacity: 0, y: 6, scale: 0.8, filter: "blur(4px)" }, { duration: 0 }),
      ]);
      running.current = false;
    };
    target.addEventListener("click", play);
    return () => target.removeEventListener("click", play);
  }, [animate, scope, staggerDuration]);

  return (
    <span ref={scope} className={cn("inline-flex", className)}>
      <span className="sr-only">{text}</span>
      {text.split("").map((letter, i) => (
        <span key={i} aria-hidden className="relative inline-flex whitespace-pre [perspective:500px]">
          <motion.span className="cascade-front inline-block origin-bottom [backface-visibility:hidden]" style={{ rotateX: 0, y: 0 }}>
            {letter}
          </motion.span>
          <motion.span
            className="cascade-echo absolute inset-0 inline-block origin-top [backface-visibility:hidden]"
            style={{ rotateX: -90, y: 6, scale: 0.8, opacity: 0, filter: "blur(4px)" }}
          >
            {letter}
          </motion.span>
        </span>
      ))}
    </span>
  );
}
