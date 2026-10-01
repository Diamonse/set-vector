"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { makeWaveform, type DeckFonts, type DeckPalette } from "./deck-art";
import type { CdjScene } from "./cdj-scene";

/** Loads the 3D deck module; also used to warm the cache before the first navigation. */
export const loadCdjScene = () => import("./cdj-scene");

function isDark() {
  const theme = document.documentElement.getAttribute("data-theme");
  if (theme) return theme === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readTokens(): { palette: DeckPalette; fonts: DeckFonts } {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    palette: {
      orange: token("--action-on-dark", "#ff9a52"),
      blue: token("--electric", "#2f8fff"),
      softBlue: token("--data-rhythm-dark", "#78b8ff"),
    },
    fonts: {
      sans: `${token("--font-instrument", "system-ui")}, system-ui, sans-serif`,
      mono: `${token("--font-jetbrains", "ui-monospace")}, ui-monospace, monospace`,
      display: `${token("--font-unbounded", "system-ui")}, system-ui, sans-serif`,
    },
  };
}

/**
 * Route loader: a CDJ playing on a beat while the next page loads. A flat vector deck
 * shows at once; the 3D deck replaces it as soon as its module and first frame are ready.
 * Without WebGL the vector deck stays. Reduced motion gets a single still frame.
 */
export function CdjLoader({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let scene: CdjScene | null = null;
    let cancelled = false;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = () => scene?.setDark(isDark());
    const observer = new MutationObserver(onTheme);

    void (async () => {
      const [{ createCdjScene }] = await Promise.all([loadCdjScene(), document.fonts?.ready]);
      if (cancelled) return;
      scene = createCdjScene(canvas, {
        ...readTokens(),
        dark: isDark(),
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        onFirstFrame: () => {
          if (!cancelled) setLive(true);
        },
      });
      if (!scene) return;
      media.addEventListener("change", onTheme);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    })();

    return () => {
      cancelled = true;
      media.removeEventListener("change", onTheme);
      observer.disconnect();
      scene?.dispose();
    };
  }, []);

  return (
    <div className={cn("relative mx-auto aspect-[4/3] w-full max-w-[720px]", className)}>
      {/* Booth light behind the deck: blue-black glow in dark mode, a faint tint in light. */}
      <div
        aria-hidden
        className="absolute inset-[8%] rounded-full bg-[radial-gradient(closest-side,var(--glow-b),transparent),radial-gradient(40%_35%_at_55%_65%,var(--glow-a),transparent)] blur-2xl"
      />
      <DeckVector className={cn("absolute inset-0 m-auto h-[82%] transition-opacity duration-200", live && "opacity-0")} />
      <canvas
        ref={canvasRef}
        aria-hidden
        className={cn("absolute inset-0 size-full opacity-0 transition-opacity delay-100 duration-700", live && "opacity-100")}
      />
    </div>
  );
}

// Rounded so server and client print identical SVG attributes.
const r2 = (n: number) => Math.round(n * 100) / 100;
const WAVE = makeWaveform(7, 64)
  .filter((_, i) => i % 8 === 0)
  .map((s) => ({ low: r2(s.low * 30), mid: r2(s.mid * 18) }));

/** Flat top-down deck in SVG: the instant and no-WebGL version of the loader. */
function DeckVector({ className }: { className?: string }) {
  const bars = WAVE.slice(0, 96);
  return (
    <svg viewBox="0 0 320 410" aria-hidden className={className}>
      <defs>
        <filter id="deck-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="deck-platter">
          <stop offset="0" stopColor="#2a313b" />
          <stop offset="1" stopColor="#12161c" />
        </radialGradient>
      </defs>
      <rect x="4" y="4" width="312" height="402" rx="14" fill="#0e131a" stroke="#1f2833" strokeWidth="2" />
      {/* Screen */}
      <rect x="22" y="20" width="276" height="112" rx="6" fill="#04070c" stroke="#1a2330" />
      <g transform="translate(30 76)">
        {bars.map((s, i) => (
          <g key={i}>
            <rect x={r2(i * 2.75)} y={-s.low} width="2" height={r2(s.low * 2)} className="fill-electric" opacity={i < 38 ? 0.55 : 1} />
            <rect x={r2(i * 2.75)} y={-s.mid} width="2" height={r2(s.mid * 2)} className="fill-[var(--action-on-dark)]" opacity={i < 38 ? 0.55 : 1} />
          </g>
        ))}
        <rect x={38 * 2.75 - 1} y="-40" width="2.5" height="80" fill="#fff" filter="url(#deck-glow)" />
      </g>
      <text x="32" y="38" className="fill-[var(--action-on-dark)] font-mono" fontSize="11" fontWeight="700">
        124.0 BPM
      </text>
      <text x="288" y="38" textAnchor="end" className="fill-[var(--data-rhythm-dark)] font-mono" fontSize="11" fontWeight="700">
        8A
      </text>
      {/* Hot cue pads */}
      {Array.from({ length: 8 }, (_, i) => (
        <rect
          key={i}
          x={30 + i * 33}
          y="150"
          width="26"
          height="16"
          rx="3"
          className={cn(i % 2 ? "fill-electric" : "fill-[var(--action-on-dark)]", "motion-safe:animate-pulse")}
          opacity="0.35"
          style={{ animationDelay: `${i * 0.12}s` }}
        />
      ))}
      {/* Jog wheel */}
      <circle cx="166" cy="282" r="96" fill="none" className="stroke-[var(--action-on-dark)]" strokeWidth="2.5" filter="url(#deck-glow)" />
      <circle cx="166" cy="282" r="90" fill="url(#deck-platter)" />
      <g className="origin-[166px_282px] motion-safe:animate-[spin_1.8s_linear_infinite]">
        <rect x="164" y="196" width="4" height="22" rx="2" fill="#e9eef5" />
      </g>
      <circle cx="166" cy="282" r="36" fill="#04070c" stroke="#5a6472" strokeWidth="2" />
      {[0.45, 0.8, 0.6, 1].map((h, i) => (
        <rect key={i} x={154 + i * 7} y={290 - h * 18} width="4" height={h * 18} rx="2" className="fill-[var(--action-on-dark)]" />
      ))}
      {/* Cue, play, and tempo fader */}
      <circle cx="34" cy="330" r="15" fill="#1a2029" className="stroke-[var(--action-on-dark)]" strokeWidth="2" />
      <circle cx="34" cy="374" r="15" fill="#1a2029" className="stroke-electric" strokeWidth="2" />
      <rect x="295" y="200" width="4" height="170" rx="2" fill="#020305" />
      <rect x="285" y="276" width="24" height="12" rx="3" fill="#2b333e" />
    </svg>
  );
}
