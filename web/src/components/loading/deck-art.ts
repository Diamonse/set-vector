/**
 * 2D artwork for the CDJ loader: the deck screen, the jog display, and the printed top
 * plate. Drawn into canvases that the 3D scene uses as textures; nothing here needs WebGL.
 * The track is synthetic demonstration data, not a real analysis.
 */

export const BPM = 124;
export const BEATS_PER_SECOND = BPM / 60;
/** Length of the looping demo track in beats (64 bars). */
export const TRACK_BEATS = 256;
const SAMPLES_PER_BEAT = 16;

export interface DeckPalette {
  orange: string;
  blue: string;
  softBlue: string;
}

export interface DeckFonts {
  sans: string;
  mono: string;
  display: string;
}

const SCREEN_BG = "#04070c";
const SCREEN_INK = "#e9eef5";
const SCREEN_MUTED = "#7e8a9b";
const SCREEN_RULE = "#1a2330";

export interface WaveSample {
  low: number;
  mid: number;
  high: number;
}

/** Small deterministic PRNG so the waveform is identical on every render. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A three-band waveform for a four-on-the-floor track: kicks on every beat, a breakdown
 * in bars 33 to 40, and phrase-level energy changes. Values are 0 to 1.
 */
export function makeWaveform(seed = 7, beats = TRACK_BEATS): WaveSample[] {
  const rand = mulberry32(seed);
  const out: WaveSample[] = [];
  for (let i = 0; i < beats * SAMPLES_PER_BEAT; i++) {
    const beat = i / SAMPLES_PER_BEAT;
    const phase = beat % 1;
    const bar = Math.floor(beat / 4);
    const phrase = Math.floor(bar / 8);
    const breakdown = bar >= 32 && bar < 40;
    const intro = bar < 4 ? 0.55 + bar * 0.1 : 1;
    const energy = (breakdown ? 0.35 : 0.8 + 0.2 * Math.sin(phrase * 1.3)) * intro;
    const kick = breakdown ? 0 : Math.exp(-phase * 7);
    const offbeat = Math.exp(-Math.abs(phase - 0.5) * 18);
    const noise = rand();
    out.push({
      low: Math.min(1, 0.12 + kick * 0.85 * energy + noise * 0.06),
      mid: Math.min(1, (0.22 + 0.3 * Math.abs(Math.sin(beat * 0.9 + seed))) * (breakdown ? 1.25 : energy) + noise * 0.1),
      high: Math.min(1, (0.08 + offbeat * 0.35 + noise * 0.22) * (breakdown ? 0.7 : energy)),
    });
  }
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function withGlow(ctx: CanvasRenderingContext2D, color: string, blur: number, draw: () => void) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  draw();
  ctx.restore();
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

/**
 * The main deck screen at playhead position `beat` (fractional beats into the track).
 * Layout follows a CDJ: track header, zoomed waveform with beat grid around a fixed
 * playhead, and a full-track overview with cue markers.
 */
export function drawScreen(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  beat: number,
  wave: WaveSample[],
  palette: DeckPalette,
  fonts: DeckFonts,
) {
  const pad = w * 0.028;
  ctx.fillStyle = SCREEN_BG;
  ctx.fillRect(0, 0, w, h);

  // Header: deck number, title, tempo, key, and elapsed time.
  const headerH = h * 0.2;
  ctx.fillStyle = palette.orange;
  roundRect(ctx, pad, pad, headerH * 0.62, headerH * 0.62, 6);
  ctx.fill();
  ctx.fillStyle = SCREEN_BG;
  ctx.font = `700 ${headerH * 0.4}px ${fonts.mono}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("1", pad + headerH * 0.31, pad + headerH * 0.33);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = SCREEN_INK;
  ctx.font = `600 ${headerH * 0.34}px ${fonts.sans}`;
  ctx.fillText("Cueing up", pad + headerH * 0.85, pad + headerH * 0.34);
  ctx.fillStyle = SCREEN_MUTED;
  ctx.font = `500 ${headerH * 0.24}px ${fonts.sans}`;
  ctx.fillText("SetVector · demo track", pad + headerH * 0.85, pad + headerH * 0.68);

  const seconds = beat / BEATS_PER_SECOND;
  ctx.textAlign = "right";
  withGlow(ctx, palette.orange, 14, () => {
    ctx.fillStyle = palette.orange;
    ctx.font = `600 ${headerH * 0.5}px ${fonts.mono}`;
    ctx.fillText(BPM.toFixed(1), w - pad - headerH * 0.75, pad + headerH * 0.48);
  });
  ctx.fillStyle = SCREEN_MUTED;
  ctx.font = `600 ${headerH * 0.18}px ${fonts.mono}`;
  ctx.fillText("BPM", w - pad, pad + headerH * 0.47);

  // Key chip, elapsed clock, and a four-beat counter.
  const keyX = w * 0.47;
  ctx.strokeStyle = palette.blue;
  ctx.lineWidth = 2;
  roundRect(ctx, keyX, pad + headerH * 0.08, headerH * 0.7, headerH * 0.4, headerH * 0.2);
  ctx.stroke();
  ctx.fillStyle = palette.softBlue;
  ctx.font = `700 ${headerH * 0.24}px ${fonts.mono}`;
  ctx.textAlign = "center";
  ctx.fillText("8A", keyX + headerH * 0.35, pad + headerH * 0.37);
  ctx.textAlign = "left";
  ctx.fillStyle = SCREEN_INK;
  ctx.font = `500 ${headerH * 0.26}px ${fonts.mono}`;
  ctx.fillText(formatClock(seconds), keyX + headerH * 0.85, pad + headerH * 0.38);
  const inBar = Math.floor(beat) % 4;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i === inBar ? (i === 0 ? palette.orange : palette.blue) : SCREEN_RULE;
    ctx.fillRect(keyX + i * headerH * 0.2, pad + headerH * 0.6, headerH * 0.15, headerH * 0.12);
  }

  // Zoomed waveform: 16 beats across, playhead fixed at 40% like a CDJ.
  const zTop = pad + headerH;
  const zH = h * 0.5;
  const mid = zTop + zH / 2;
  const pxPerBeat = (w - pad * 2) / 16;
  const playX = pad + (w - pad * 2) * 0.4;
  ctx.fillStyle = "#070b12";
  ctx.fillRect(pad, zTop, w - pad * 2, zH);

  // Phrase band along the top.
  for (let x = pad; x < w - pad; x += 2) {
    const b = beat + (x - playX) / pxPerBeat;
    if (b < 0 || b >= TRACK_BEATS) continue;
    const phrase = Math.floor(b / 32);
    ctx.fillStyle = phrase === 4 ? palette.softBlue : phrase % 2 ? palette.blue : palette.orange;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x, zTop, 2, zH * 0.035);
  }
  ctx.globalAlpha = 1;

  // Beat grid.
  const firstBeat = Math.ceil(beat - (playX - pad) / pxPerBeat);
  for (let b = firstBeat; b < beat + (w - pad - playX) / pxPerBeat; b++) {
    if (b < 0) continue;
    const x = playX + (b - beat) * pxPerBeat;
    const downbeat = b % 4 === 0;
    ctx.fillStyle = downbeat ? palette.softBlue : SCREEN_RULE;
    ctx.globalAlpha = downbeat ? 0.55 : 1;
    ctx.fillRect(Math.round(x), zTop + zH * 0.05, downbeat ? 2 : 1, zH * 0.95);
  }
  ctx.globalAlpha = 1;

  // Waveform columns: blue lows, orange mids, white highs, mirrored about the centre line.
  const amp = zH * 0.44;
  for (let x = pad; x < w - pad; x += 2) {
    const b = beat + (x - playX) / pxPerBeat;
    if (b < 0) continue;
    const s = wave[Math.floor((b % TRACK_BEATS) * SAMPLES_PER_BEAT)]!;
    const played = x < playX;
    ctx.globalAlpha = played ? 0.55 : 1;
    ctx.fillStyle = palette.blue;
    ctx.fillRect(x, mid - s.low * amp, 2, s.low * amp * 2);
    ctx.fillStyle = palette.orange;
    ctx.fillRect(x, mid - s.mid * amp * 0.62, 2, s.mid * amp * 1.24);
    ctx.fillStyle = SCREEN_INK;
    ctx.fillRect(x, mid - s.high * amp * 0.32, 2, s.high * amp * 0.64);
  }
  ctx.globalAlpha = 1;

  // Playhead.
  withGlow(ctx, palette.orange, 18, () => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(playX - 1.5, zTop, 3, zH);
  });
  ctx.fillStyle = palette.orange;
  ctx.beginPath();
  ctx.moveTo(playX - 9, zTop);
  ctx.lineTo(playX + 9, zTop);
  ctx.lineTo(playX, zTop + 12);
  ctx.closePath();
  ctx.fill();

  // Overview: the whole track, played part dimmed, cue markers A to D.
  const oTop = zTop + zH + h * 0.06;
  const oH = h - oTop - pad;
  const oW = w - pad * 2;
  const oMid = oTop + oH / 2;
  const progress = (beat % TRACK_BEATS) / TRACK_BEATS;
  for (let x = 0; x < oW; x += 2) {
    const b = (x / oW) * TRACK_BEATS;
    let peak = 0;
    for (let k = 0; k < 8; k++) peak = Math.max(peak, wave[Math.floor(b * SAMPLES_PER_BEAT) + k]?.low ?? 0);
    const played = x / oW < progress;
    ctx.fillStyle = played ? SCREEN_MUTED : palette.softBlue;
    ctx.globalAlpha = played ? 0.45 : 0.85;
    ctx.fillRect(pad + x, oMid - peak * oH * 0.42, 2, peak * oH * 0.84);
  }
  ctx.globalAlpha = 1;
  ["A", "B", "C", "D"].forEach((label, i) => {
    const x = pad + ((i * 64) / TRACK_BEATS) * oW;
    ctx.fillStyle = i % 2 ? palette.blue : palette.orange;
    ctx.beginPath();
    ctx.moveTo(x, oTop - 2);
    ctx.lineTo(x + 14, oTop - 2);
    ctx.lineTo(x, oTop + 12);
    ctx.closePath();
    ctx.fill();
    ctx.font = `700 ${oH * 0.2}px ${fonts.mono}`;
    ctx.textAlign = "left";
    ctx.fillText(label, x + 4, oTop + oH * 0.98);
  });
  withGlow(ctx, palette.orange, 12, () => {
    ctx.fillStyle = palette.orange;
    ctx.fillRect(pad + progress * oW - 1.5, oTop - 4, 3, oH + 6);
  });
}

/**
 * The circular display in the centre of the jog wheel: a rotating position marker, a
 * tick ring, and the SetVector level-meter mark pulsing on the beat.
 */
export function drawJogDisplay(ctx: CanvasRenderingContext2D, size: number, beat: number, palette: DeckPalette, fonts: DeckFonts) {
  const c = size / 2;
  const r = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.clip();
  const bg = ctx.createRadialGradient(c, c, 0, c, c, r);
  bg.addColorStop(0, "#0c1422");
  bg.addColorStop(1, SCREEN_BG);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // Tick ring.
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const long = i % 5 === 0;
    ctx.strokeStyle = long ? palette.softBlue : SCREEN_RULE;
    ctx.lineWidth = long ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r * 0.9, c + Math.sin(a) * r * 0.9);
    ctx.lineTo(c + Math.cos(a) * r * (long ? 0.78 : 0.83), c + Math.sin(a) * r * (long ? 0.78 : 0.83));
    ctx.stroke();
  }

  // Position marker: one revolution per bar, with a fading trail.
  const angle = ((beat % 4) / 4) * Math.PI * 2 - Math.PI / 2;
  const trail = ctx.createConicGradient(angle - Math.PI * 0.9, c, c);
  trail.addColorStop(0, "rgba(0,0,0,0)");
  trail.addColorStop(0.25, palette.orange);
  trail.addColorStop(0.2501, "rgba(0,0,0,0)");
  ctx.strokeStyle = trail;
  ctx.lineWidth = r * 0.07;
  ctx.beginPath();
  ctx.arc(c, c, r * 0.95, angle - Math.PI * 0.9 + 0.01, angle);
  ctx.stroke();
  withGlow(ctx, palette.orange, 20, () => {
    ctx.fillStyle = palette.orange;
    ctx.beginPath();
    ctx.arc(c + Math.cos(angle) * r * 0.95, c + Math.sin(angle) * r * 0.95, r * 0.06, 0, Math.PI * 2);
    ctx.fill();
  });

  // Level-meter mark: four bars rising, nudged by the kick.
  const kick = Math.exp(-(beat % 1) * 6);
  const bars = [0.45, 0.8, 0.6, 1];
  const barW = r * 0.09;
  const gap = r * 0.06;
  const total = bars.length * barW + (bars.length - 1) * gap;
  const base = c + r * 0.2;
  withGlow(ctx, palette.orange, 16, () => {
    bars.forEach((v, i) => {
      const hgt = r * 0.5 * v * (0.75 + 0.25 * (i % 2 ? kick : 1 - kick * 0.5));
      ctx.fillStyle = palette.orange;
      roundRect(ctx, c - total / 2 + i * (barW + gap), base - hgt, barW, hgt, barW / 2);
      ctx.fill();
    });
  });
  ctx.fillStyle = palette.softBlue;
  ctx.font = `600 ${r * 0.13}px ${fonts.mono}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${BPM.toFixed(1)}`, c, c + r * 0.42);
  ctx.restore();
}

/** Printed legends and panel lines on the top plate, in plate UV space (x right, y toward the player). */
export function drawTopPlate(ctx: CanvasRenderingContext2D, w: number, h: number, palette: DeckPalette, fonts: DeckFonts, layout: PlateLayout) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#1c1d20");
  g.addColorStop(1, "#141517");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Fine brushed texture.
  const rand = mulberry32(3);
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rand() > 0.5 ? "#ffffff" : "#000000";
    ctx.fillRect(rand() * w, rand() * h, rand() * w * 0.3, 1);
  }
  ctx.globalAlpha = 1;

  const u = (x: number) => ((x + layout.width / 2) / layout.width) * w;
  const v = (z: number) => ((z + layout.depth / 2) / layout.depth) * h;
  const label = (text: string, x: number, z: number, size = 26, color = "#8794a6", align: CanvasTextAlign = "center") => {
    ctx.fillStyle = color;
    ctx.font = `600 ${size}px ${fonts.mono}`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(text, u(x), v(z));
  };

  // Panel divisions.
  ctx.strokeStyle = "#2a2b2f";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(u(-layout.width / 2 + 0.12), v(layout.padsZ - 0.28));
  ctx.lineTo(u(layout.width / 2 - 0.12), v(layout.padsZ - 0.28));
  ctx.stroke();

  label("HOT CUE", -layout.width / 2 + 0.2, layout.padsZ - 0.18, 24, "#8794a6", "left");
  ["A", "B", "C", "D", "E", "F", "G", "H"].forEach((l, i) => label(l, layout.padX(i), layout.padsZ + 0.16, 20, "#5f6b7c"));

  // Tempo scale.
  label("TEMPO", layout.faderX, layout.faderZ0 - 0.14, 22);
  for (let i = 0; i <= 16; i++) {
    const z = layout.faderZ0 + ((layout.faderZ1 - layout.faderZ0) * i) / 16;
    ctx.fillStyle = i === 8 ? palette.orange : "#4a5565";
    ctx.fillRect(u(layout.faderX - 0.16), v(z) - 1.5, i % 4 === 0 ? 22 : 12, 3);
  }
  label("±8", layout.faderX, layout.faderZ1 + 0.13, 20, "#5f6b7c");

  label("CUE", layout.buttonsX, layout.cueZ - 0.27, 22);
  label("PLAY", layout.buttonsX, layout.playZ - 0.27, 22);
  label("LOOP", layout.buttonsX, layout.loopZ - 0.16, 20, "#5f6b7c");

  // Jog surround ring print.
  ctx.strokeStyle = "#26272b";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(u(layout.jogX), v(layout.jogZ), (layout.jogR + 0.1) / layout.width * w, (layout.jogR + 0.1) / layout.depth * h, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Wordmark, front right.
  ctx.fillStyle = "#c9d2de";
  ctx.font = `700 30px ${fonts.display}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const right = u(layout.width / 2 - 0.12);
  const baseline = v(layout.depth / 2 - 0.16);
  ctx.fillText("SetVector", right, baseline);
  const markLeft = right - ctx.measureText("SetVector").width - 46;
  [0.45, 0.8, 0.6, 1].forEach((b, i) => {
    ctx.fillStyle = palette.orange;
    const bh = 26 * b;
    ctx.fillRect(markLeft + i * 9, baseline + 13 - bh, 5, bh);
  });
}

export interface PlateLayout {
  width: number;
  depth: number;
  padsZ: number;
  padX: (i: number) => number;
  faderX: number;
  faderZ0: number;
  faderZ1: number;
  buttonsX: number;
  cueZ: number;
  playZ: number;
  loopZ: number;
  jogX: number;
  jogZ: number;
  jogR: number;
}
