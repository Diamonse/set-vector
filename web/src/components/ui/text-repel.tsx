"use client";

import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Adapted from Componentry's Text Repel (componentry.dev/r/text-repel). The text is read once
// by assistive technology, and touch and reduced motion leave the letters still.

function RepelLetter({
  letter,
  mouseX,
  mouseY,
  radius,
  strength,
}: {
  letter: string;
  mouseX: MotionValue<number>;
  mouseY: MotionValue<number>;
  radius: number;
  strength: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const origin = useRef({ x: 0, y: 0 });
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 180, damping: 14, mass: 0.4 });
  const springY = useSpring(y, { stiffness: 180, damping: 14, mass: 0.4 });
  // A slight tilt that follows the sideways push.
  const rotate = useTransform(springX, (v) => v * 0.3);

  useEffect(() => {
    const capture = () => {
      const el = ref.current;
      const box = el?.closest("[data-text-repel]")?.getBoundingClientRect();
      if (!el || !box) return;
      const r = el.getBoundingClientRect();
      origin.current = { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
    };
    const frame = requestAnimationFrame(capture);
    window.addEventListener("resize", capture);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", capture);
    };
  }, []);

  useEffect(() => {
    const update = () => {
      const dx = origin.current.x - mouseX.get();
      const dy = origin.current.y - mouseY.get();
      const distance = Math.hypot(dx, dy);
      if (distance > 0 && distance < radius) {
        const force = (1 - distance / radius) ** 2 * strength;
        const angle = Math.atan2(dy, dx);
        x.set(Math.cos(angle) * force);
        y.set(Math.sin(angle) * force);
      } else {
        x.set(0);
        y.set(0);
      }
    };
    const offX = mouseX.on("change", update);
    const offY = mouseY.on("change", update);
    return () => {
      offX();
      offY();
    };
  }, [mouseX, mouseY, radius, strength, x, y]);

  if (letter === " ") return <span className="inline-block whitespace-pre"> </span>;
  return (
    <motion.span ref={ref} className="inline-block whitespace-pre" style={{ x: springX, y: springY, rotate }}>
      {letter}
    </motion.span>
  );
}

/** Text whose characters shy away from the cursor and spring back when it leaves. */
export function TextRepel({ text, className, radius = 110, strength = 34 }: { text: string; className?: string; radius?: number; strength?: number }) {
  const mouseX = useMotionValue(-9999);
  const mouseY = useMotionValue(-9999);
  const [still, setStill] = useState(true);
  useEffect(() => setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);

  return (
    <span
      data-text-repel
      className={cn("inline-flex cursor-default select-none", className)}
      onPointerMove={(e) => {
        if (still || e.pointerType === "touch") return;
        const box = e.currentTarget.getBoundingClientRect();
        mouseX.set(e.clientX - box.left);
        mouseY.set(e.clientY - box.top);
      }}
      onPointerLeave={() => {
        mouseX.set(-9999);
        mouseY.set(-9999);
      }}
    >
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-flex">
        {text.split("").map((letter, i) => (
          <RepelLetter key={i} letter={letter} mouseX={mouseX} mouseY={mouseY} radius={radius} strength={strength} />
        ))}
      </span>
    </span>
  );
}
