"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// Adapted from Componentry's Pixel Canvas (componentry.dev/r/pixel-canvas). It listens to its
// parent, so it can sit behind a pad's content, and it only draws while the glow is changing:
// a resting pointer or an idle page runs no animation frames. Touch and
// reduced motion leave it dark.

interface Pixel {
  x: number;
  y: number;
  intensity: number;
}

/**
 * An LED matrix behind a pad that lights under the pointer and fades out, like a backlit
 * hot-cue pad. Place it as the first child of an element with `isolate` and `relative`; it
 * draws behind the element's content. Colours run from `colors[0]` (dim) to the last (bright).
 */
export function PixelCanvas({
  cell = 6,
  radius = 70,
  decay = 0.06,
  colors = ["#ff8a3d", "#ffb53d"],
  className,
}: {
  /** Pixel pitch in CSS pixels. */
  cell?: number;
  /** Pointer influence radius in CSS pixels. */
  radius?: number;
  /** Fraction of the remaining glow lost per frame once the pointer moves on. */
  decay?: number;
  colors?: [string, string];
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dim, bright] = colors;

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let pixels: Pixel[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    const pointer = { x: -1e4, y: -1e4, inside: false };

    const layout = () => {
      const rect = host.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      // setTransform rather than scale, so repeated layouts do not compound the ratio.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const old = new Map(pixels.map((p) => [`${p.x},${p.y}`, p.intensity]));
      pixels = [];
      for (let x = 0; x < width; x += cell) for (let y = 0; y < height; y += cell) pixels.push({ x, y, intensity: old.get(`${x},${y}`) ?? 0 });
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      let changing = false;
      for (const p of pixels) {
        const dx = pointer.x - (p.x + cell / 2);
        const dy = pointer.y - (p.y + cell / 2);
        const d = Math.hypot(dx, dy);
        const target = pointer.inside && d < radius ? (1 - d / radius) ** 1.5 : 0;
        const step = (target - p.intensity) * (target > p.intensity ? 0.35 : decay);
        p.intensity += step;
        if (Math.abs(step) > 0.002) changing = true;
        if (p.intensity < 0.01) continue;
        ctx.globalAlpha = p.intensity * 0.55;
        ctx.fillStyle = p.intensity > 0.6 ? bright : dim;
        ctx.fillRect(p.x, p.y, cell - 1.5, cell - 1.5);
      }
      ctx.globalAlpha = 1;
      // Stop once the glow has settled; the canvas keeps the last frame, and a move wakes it.
      frame = changing ? requestAnimationFrame(draw) : 0;
    };

    const wake = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const rect = host.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.inside = true;
      wake();
    };
    const onLeave = () => {
      pointer.inside = false;
      wake();
    };

    layout();
    const observer = new ResizeObserver(layout);
    observer.observe(host);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, [cell, radius, decay, dim, bright]);

  return <canvas ref={canvasRef} aria-hidden className={cn("pointer-events-none absolute inset-0 -z-10 size-full rounded-[inherit]", className)} />;
}
