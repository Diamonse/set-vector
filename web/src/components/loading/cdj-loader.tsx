"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { makeWaveform, type DeckFonts, type DeckPalette } from "./deck-art";
import { BODY_H, cameraPose, DECK_D, DECK_W, LAYOUT, projector, SCREEN, STAGE_ASPECT, TOP, type Vec3 } from "./deck-layout";
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
 * Route loader: a CDJ playing on a beat while the next page loads. A vector deck drawn from
 * the same camera shows at once; the 3D deck fades in over it on its first frame, and the
 * vector deck leaves only once the 3D one is fully visible. Without WebGL the vector deck
 * stays. Reduced motion gets a single still frame.
 */
export function CdjLoader({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);
  // Filled after mount so screen readers announce it; live regions that mount already
  // filled are often skipped.
  const [status, setStatus] = useState("");

  useEffect(() => {
    setStatus("Cueing up the page…");
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
    <div className={cn("flex w-full flex-col items-center gap-3", className)}>
      <div className="relative aspect-[4/5] w-full max-w-[440px] sm:aspect-[5/4] sm:max-w-[760px]">
        {/* Booth light behind the deck: blue-black glow in dark mode, a faint tint in light. */}
        <div
          aria-hidden
          className="absolute inset-[10%] rounded-full bg-[radial-gradient(closest-side,var(--glow-b),transparent),radial-gradient(40%_35%_at_55%_60%,var(--glow-a),transparent)] blur-2xl"
        />
        <div aria-hidden className={cn("absolute inset-0 transition-opacity", live ? "opacity-0 delay-300 duration-150" : "opacity-100")}>
          <DeckVector aspect={STAGE_ASPECT.narrow} className="size-full sm:hidden" />
          <DeckVector aspect={STAGE_ASPECT.wide} className="hidden size-full sm:block" />
        </div>
        <canvas
          ref={canvasRef}
          aria-hidden
          className={cn(
            "absolute inset-0 size-full transition-opacity duration-300",
            live ? "opacity-100" : "opacity-0",
          )}
        />
      </div>
      <p role="status" className="min-h-[1.4em] text-ui text-muted">
        {status}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Vector deck: the 3D deck's resting frame, projected with the same camera, in SVG.
// Coordinates are rounded so server and client print identical attributes.

const r2 = (n: number) => Math.round(n * 100) / 100;
const BEAT = 60 / 124;
/** Screen art units: a 1000 x 440 box; the zoomed waveform shows four bars of 236 units. */
const BAR_UNITS = 236;

/** One bar of the demo waveform (blue lows, orange mids, white highs), looped on the screen. */
const LOOP = makeWaveform(7, 64)
  .slice(5 * 4 * 16, 6 * 4 * 16)
  .filter((_, i) => i % 2 === 0)
  .map((s, i, all) => ({ x: r2((i * BAR_UNITS) / all.length), low: r2(s.low * 96), mid: r2(s.mid * 60), high: r2(s.high * 30) }));

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function buildVector(aspect: number) {
  const VW = 500;
  const VH = r2(VW / aspect);
  const project = projector(cameraPose(aspect), VW, VH);
  const poly = (ps: Vec3[]) => ps.map((p) => project(p).map(r2).join(",")).join(" ");
  /** SVG matrix mapping local (u, v) to the stage, from three points: origin, origin + u, origin + v. */
  const frame = (o: Vec3, u: Vec3, v: Vec3) => {
    const [ox, oy] = project(o);
    const [ux, uy] = project([o[0] + u[0], o[1] + u[1], o[2] + u[2]]);
    const [vx, vy] = project([o[0] + v[0], o[1] + v[1], o[2] + v[2]]);
    return `matrix(${[ux - ox, uy - oy, vx - ox, vy - oy, ox, oy].map((n) => n.toFixed(3)).join(" ")})`;
  };
  /** Local frame on the top plate at (x, z): u along x, v along z, both in scene units. */
  const onPlate = (x: number, z: number, lift = 0) => frame([x, TOP + lift, z], [1, 0, 0], [0, 0, 1]);

  const hw = DECK_W / 2;
  const hd = DECK_D / 2;
  // A point on the tilted screen housing: (x, y) along its face, z out of it.
  const tilt = (x: number, y: number, z = 0.061): Vec3 => [
    x,
    TOP + y * Math.cos(SCREEN.tilt) + z * Math.sin(SCREEN.tilt),
    SCREEN.z - y * Math.sin(SCREEN.tilt) + z * Math.cos(SCREEN.tilt),
  ];
  const sw = SCREEN.width / 2;
  const sTop = SCREEN.lift + SCREEN.height;
  const wedgeRun = Math.sin(SCREEN.tilt) * (SCREEN.height + 0.2);
  const wedgeRise = Math.cos(SCREEN.tilt) * (SCREEN.height + 0.2);
  const wx = -(SCREEN.width + 0.14) / 2;

  return {
    VW,
    VH,
    shadow: frame([0.28, 0, -0.3], [1, 0, 0], [0, 0, 1]),
    left: poly([
      [-hw, 0, -hd],
      [-hw, 0, hd],
      [-hw, BODY_H, hd],
      [-hw, BODY_H, -hd],
    ]),
    front: poly([
      [-hw, 0, hd],
      [hw, 0, hd],
      [hw, BODY_H, hd],
      [-hw, BODY_H, hd],
    ]),
    top: poly([
      [-hw, TOP, -hd],
      [hw, TOP, -hd],
      [hw, TOP, hd],
      [-hw, TOP, hd],
    ]),
    wedge: poly([
      [wx, TOP, SCREEN.z],
      [wx, TOP, SCREEN.z - wedgeRun],
      [wx, TOP + wedgeRise, SCREEN.z - wedgeRun],
    ]),
    bezel: poly([
      tilt(-sw - 0.09, SCREEN.lift - 0.09, 0.06),
      tilt(sw + 0.09, SCREEN.lift - 0.09, 0.06),
      tilt(sw + 0.09, sTop + 0.09, 0.06),
      tilt(-sw - 0.09, sTop + 0.09, 0.06),
    ]),
    screen: frame(tilt(-sw, sTop), [SCREEN.width / 1000, 0, 0], sub(tilt(-sw, sTop - SCREEN.height / 440), tilt(-sw, sTop))),
    pads: Array.from({ length: 8 }, (_, i) => onPlate(LAYOUT.padX(i), LAYOUT.padsZ, 0.07)),
    jog: onPlate(LAYOUT.jogX, LAYOUT.jogZ, 0.1),
    cue: onPlate(LAYOUT.buttonsX, LAYOUT.cueZ, 0.08),
    play: onPlate(LAYOUT.buttonsX, LAYOUT.playZ, 0.08),
    loop: onPlate(LAYOUT.buttonsX, LAYOUT.loopZ + 0.1, 0.05),
    fader: onPlate(LAYOUT.faderX, (LAYOUT.faderZ0 + LAYOUT.faderZ1) / 2),
  };
}

const VECTORS = new Map([STAGE_ASPECT.narrow, STAGE_ASPECT.wide].map((a) => [a, buildVector(a)]));

const ORANGE = "var(--action-on-dark)";
const BLUE = "var(--electric)";
const SOFT_BLUE = "var(--data-rhythm-dark)";

/** Flat vector deck: the instant and no-WebGL version of the loader, beat-locked like the 3D one. */
function DeckVector({ aspect, className }: { aspect: number; className?: string }) {
  const v = VECTORS.get(aspect)!;
  const id = aspect > 1 ? "w" : "n";
  const jogR = LAYOUT.jogR;
  const faderLen = LAYOUT.faderZ1 - LAYOUT.faderZ0;
  const capY = r2(-faderLen / 2 + faderLen * 0.47);
  return (
    <svg viewBox={`0 0 ${v.VW} ${v.VH}`} aria-hidden className={className}>
      <defs>
        <filter id={`deck-glow-${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id={`deck-shadow-${id}`}>
          <stop offset="0" stopColor="#000" stopOpacity="0.35" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`deck-platter-${id}`}>
          <stop offset="0" stopColor="#2d2e32" />
          <stop offset="0.55" stopColor="#202124" />
          <stop offset="1" stopColor="#141518" />
        </radialGradient>
        <clipPath id={`deck-wave-${id}`}>
          <rect x="28" y="96" width="944" height="216" />
        </clipPath>
      </defs>

      <g transform={v.shadow}>
        <ellipse rx={r2(DECK_W * 0.65)} ry={r2(DECK_D * 0.55)} fill={`url(#deck-shadow-${id})`} />
      </g>
      <polygon points={v.left} fill="#0d0e10" />
      <polygon points={v.front} fill="#101113" />
      <polygon points={v.top} fill="#18191c" stroke="#26272b" strokeWidth="1" />
      <polygon points={v.wedge} fill="#121315" />
      <polygon points={v.bezel} fill="#0c0c0e" />

      <g transform={v.screen}>
        <rect width="1000" height="440" fill="#04070c" />
        <rect x="28" y="24" width="44" height="44" rx="6" fill={ORANGE} />
        <text x="104" y="58" fill="#e9eef5" fontSize="34" fontWeight="600" className="font-sans">
          Cueing up
        </text>
        <text x="972" y="62" textAnchor="end" fill={ORANGE} fontSize="44" fontWeight="600" className="font-mono">
          124.0
        </text>
        <rect x="470" y="28" width="62" height="34" rx="17" fill="none" stroke={BLUE} strokeWidth="2.5" />
        <text x="501" y="53" textAnchor="middle" fill={SOFT_BLUE} fontSize="22" fontWeight="700" className="font-mono">
          8A
        </text>
        <g clipPath={`url(#deck-wave-${id})`}>
          <rect x="28" y="96" width="944" height="216" fill="#070b12" />
          <g className="deck-scroll">
            {[0, 1, 2, 3, 4].map((rep) => (
              <g key={rep} transform={`translate(${28 + rep * BAR_UNITS} 204)`}>
                {[0, 1, 2, 3].map((b) => (
                  <rect
                    key={b}
                    x={b * (BAR_UNITS / 4)}
                    y="-104"
                    width={b === 0 ? 2 : 1}
                    height="208"
                    fill={b === 0 ? SOFT_BLUE : "#1a2330"}
                    opacity={b === 0 ? 0.6 : 1}
                  />
                ))}
                {LOOP.map((s, i) => (
                  <g key={i}>
                    <rect x={s.x} y={-s.low} width="3.4" height={r2(s.low * 2)} fill={BLUE} />
                    <rect x={s.x} y={-s.mid} width="3.4" height={r2(s.mid * 2)} fill={ORANGE} />
                    <rect x={s.x} y={-s.high} width="3.4" height={r2(s.high * 2)} fill="#e9eef5" />
                  </g>
                ))}
              </g>
            ))}
          </g>
        </g>
        <rect x="404" y="96" width="4" height="216" fill="#fff" filter={`url(#deck-glow-${id})`} />
        <rect x="28" y="344" width="944" height="64" fill="#070b12" />
        <rect x="28" y="370" width="380" height="12" fill="#7e8a9b" opacity="0.45" />
        <rect x="408" y="368" width="564" height="16" fill={SOFT_BLUE} opacity="0.8" />
        <rect x="406" y="340" width="4" height="72" fill={ORANGE} />
      </g>

      {v.pads.map((m, i) => (
        <g key={i} transform={m}>
          <rect x="-0.125" y="-0.1" width="0.25" height="0.2" rx="0.03" fill="#1a1b1e" />
          <rect
            x="-0.125"
            y="-0.1"
            width="0.25"
            height="0.2"
            rx="0.03"
            fill={i % 2 ? BLUE : ORANGE}
            className="deck-pad"
            style={{ animationDelay: `${r2(i * BEAT)}s` }}
          />
        </g>
      ))}

      <g transform={v.jog}>
        <circle r={r2(jogR + 0.06)} fill="#050506" />
        <circle r={r2(jogR + 0.035)} fill="none" stroke={ORANGE} strokeWidth="0.026" className="deck-kick" filter={`url(#deck-glow-${id})`} />
        <circle r={jogR} fill={`url(#deck-platter-${id})`} />
        <g className="deck-spin">
          <circle r={jogR} fill="none" />
          <rect x="-0.012" y={r2(-jogR * 0.94)} width="0.024" height="0.17" fill="#e9eef5" />
        </g>
        <circle r={r2(jogR * 0.4)} fill="#04070c" stroke="#5d5e64" strokeWidth="0.03" />
        {[0.45, 0.8, 0.6, 1].map((h, i) => (
          <rect key={i} x={r2(-0.075 + i * 0.045)} y={r2(0.09 - h * 0.17)} width="0.026" height={r2(h * 0.17)} rx="0.013" fill={ORANGE} />
        ))}
      </g>

      <g transform={v.cue}>
        <circle r="0.15" fill="#1d1e22" />
        <circle r="0.168" fill="none" stroke={ORANGE} strokeWidth="0.024" filter={`url(#deck-glow-${id})`} />
      </g>
      <g transform={v.play}>
        <circle r="0.15" fill="#1d1e22" />
        <circle r="0.168" fill="none" stroke={BLUE} strokeWidth="0.024" className="deck-kick" filter={`url(#deck-glow-${id})`} />
      </g>

      <g transform={v.loop}>
        <rect x="-0.1" y="-0.175" width="0.2" height="0.13" rx="0.02" fill="#1e1f23" />
        <rect x="-0.1" y="0.045" width="0.2" height="0.13" rx="0.02" fill="#1e1f23" />
      </g>

      <g transform={v.fader}>
        <rect x="-0.0225" y={r2(-faderLen / 2)} width="0.045" height={r2(faderLen)} fill="#020305" />
        <rect x="-0.13" y={r2(capY - 0.065)} width="0.26" height="0.13" rx="0.03" fill="#2e2f34" />
        <rect x="-0.1" y={r2(capY - 0.006)} width="0.2" height="0.012" fill={ORANGE} />
      </g>
    </svg>
  );
}
