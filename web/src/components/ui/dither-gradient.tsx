"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// Adapted from Componentry's Dither Gradient (componentry.dev/r/dither-gradient). It renders at
// a third of the display resolution and scales up without smoothing, so each dot is a visible
// LCD cell and a frame costs a ninth of the work; the gradient drifts for a few seconds, then
// holds (WCAG 2.2.2), and reduced motion draws a single frame.

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function rgb(hex: string) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [0, 0, 0];
}

/**
 * An ordered-dither gradient, like the idle pattern on a deck screen. Fills its positioned
 * parent; decorative.
 */
export function DitherGradient({
  colors = ["#05080d", "#121a26", "#3a1d0b"],
  cell = 3,
  angle = 35,
  intensity = 0.16,
  runSeconds = 4,
  className,
}: {
  /** From, middle, and to colours, as #rrggbb. */
  colors?: [string, string, string];
  /** CSS pixels per dither cell. */
  cell?: number;
  angle?: number;
  intensity?: number;
  /** How long the gradient drifts before holding still. */
  runSeconds?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [c0, c1, c2] = colors;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const [from, mid, to] = [rgb(c0), rgb(c1), rgb(c2)];
    const rad = (angle * Math.PI) / 180;
    const smooth = (t: number) => t * t * (3 - 2 * t);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const size = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width / cell));
      canvas.height = Math.max(1, Math.round(r.height / cell));
    };
    const draw = (time: number) => {
      const { width, height } = canvas;
      const image = ctx.createImageData(width, height);
      const data = image.data;
      const drift = Math.sin(time * 0.0009) * 0.12;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const pos = Math.max(0, Math.min(1, ((x / width) * Math.cos(rad) + (y / height) * Math.sin(rad)) * 0.8 + 0.1 + drift));
          const [a, b, t] = pos < 0.5 ? [from, mid, smooth(pos * 2)] : [mid, to, smooth((pos - 0.5) * 2)];
          const threshold = (BAYER[y % 4]![x % 4]! / 16 - 0.5) * intensity * 180;
          const i = (y * width + x) * 4;
          for (let ch = 0; ch < 3; ch++) data[i + ch] = Math.min(255, Math.max(0, a[ch]! + (b[ch]! - a[ch]!) * t + threshold));
          data[i + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    };

    size();
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      draw(now - started);
      if (!still && now - started < runSeconds * 1000) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const observer = new ResizeObserver(() => {
      size();
      draw(performance.now() - started);
    });
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [c0, c1, c2, cell, angle, intensity, runSeconds]);

  return <canvas ref={canvasRef} aria-hidden className={cn("pointer-events-none absolute inset-0 size-full [image-rendering:pixelated]", className)} />;
}
