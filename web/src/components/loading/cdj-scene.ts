import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  BEATS_PER_SECOND,
  drawJogDisplay,
  drawScreen,
  drawTopPlate,
  makeWaveform,
  type DeckFonts,
  type DeckPalette,
  type PlateLayout,
} from "./deck-art";

/**
 * A procedural CDJ-style deck for the route loader: tilted screen with a beat-synced
 * waveform, a spinning platter around a jog display, a pulsing LED ring, a hot-cue pad
 * chase, transport buttons, and a tempo fader. The canvas is transparent so the page's
 * own background shows through; glows are additive planes rather than post-processing.
 */

export interface CdjSceneOptions {
  reducedMotion: boolean;
  dark: boolean;
  palette: DeckPalette;
  fonts: DeckFonts;
  onFirstFrame?: () => void;
}

export interface CdjScene {
  setDark(dark: boolean): void;
  dispose(): void;
}

// Deck dimensions in scene units: x across, y up, z toward the player.
const W = 3.2;
const D = 4.1;
const BODY_H = 0.3;
const TOP = BODY_H;

const LAYOUT: PlateLayout = {
  width: W,
  depth: D,
  padsZ: -0.48,
  padX: (i) => -1.12 + i * 0.32,
  faderX: 1.34,
  faderZ0: 0.05,
  faderZ1: 1.65,
  buttonsX: -1.22,
  cueZ: 1.12,
  playZ: 1.62,
  loopZ: 0.28,
  jogX: 0.08,
  jogZ: 0.82,
  jogR: 0.86,
};

const SCREEN = { width: 2.7, height: 1.18, tilt: 0.52, z: -1.38 };

function canvasTexture(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { canvas, ctx: canvas.getContext("2d")!, texture };
}

/** Soft radial (or ring-shaped) glow texture for additive planes. */
function glowTexture(ring = false) {
  const { ctx, texture } = canvasTexture(256, 256);
  const g = ctx.createRadialGradient(128, 128, ring ? 70 : 0, 128, 128, 128);
  if (ring) {
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.32, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
  } else {
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

function glowPlane(texture: THREE.Texture, color: string, w: number, h: number, opacity: number) {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
}

/** Brushed platter face: concentric grain, a bright index mark, and a darker hub. */
function platterTexture() {
  const size = 1024;
  const { ctx, texture } = canvasTexture(size, size);
  const c = size / 2;
  const base = ctx.createRadialGradient(c, c, 0, c, c, c);
  base.addColorStop(0, "#2a313b");
  base.addColorStop(0.55, "#1d232b");
  base.addColorStop(1, "#11151b");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let r = 40; r < c; r += 3) {
    ctx.strokeStyle = `rgba(255,255,255,${0.02 + 0.03 * Math.abs(Math.sin(r * 0.37))})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Anisotropic sheen so rotation reads as motion.
  const sheen = ctx.createConicGradient(0, c, c);
  sheen.addColorStop(0, "rgba(255,255,255,0.10)");
  sheen.addColorStop(0.12, "rgba(255,255,255,0)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0.08)");
  sheen.addColorStop(0.62, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(255,255,255,0.10)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, size, size);
  // Index mark.
  ctx.fillStyle = "#e9eef5";
  ctx.fillRect(c - 7, c * 0.06, 14, c * 0.2);
  return texture;
}

export function createCdjScene(canvas: HTMLCanvasElement, options: CdjSceneOptions): CdjScene | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    return null;
  }
  const { palette, fonts, reducedMotion } = options;
  let dark = options.dark;
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);

  // Lights: cool key from above, warm fill from the jog side, blue rim from behind.
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x0a0d12, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-3, 7, 4);
  scene.add(key);
  const rim = new THREE.PointLight(new THREE.Color(palette.blue), 9, 9, 1.6);
  rim.position.set(0, 1.4, -3.2);
  scene.add(rim);
  const warm = new THREE.PointLight(new THREE.Color(palette.orange), 2.2, 4, 2);
  warm.position.set(LAYOUT.jogX, 0.9, LAYOUT.jogZ);
  scene.add(warm);

  const deck = new THREE.Group();
  scene.add(deck);

  // Body and printed top plate.
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0b0f15, roughness: 0.45, metalness: 0.55 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(W, BODY_H, D, 5, 0.09), bodyMat);
  body.position.y = BODY_H / 2;
  deck.add(body);

  const plate = canvasTexture(1280, 1640);
  const plateMat = new THREE.MeshStandardMaterial({ map: plate.texture, roughness: 0.62, metalness: 0.35 });
  const plateMesh = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, D - 0.1), plateMat);
  plateMesh.rotation.x = -Math.PI / 2;
  plateMesh.position.y = TOP + 0.001;
  deck.add(plateMesh);
  const plateLayout = { ...LAYOUT, width: W - 0.1, depth: D - 0.1 };
  drawTopPlate(plate.ctx, 1280, 1640, palette, fonts, plateLayout);
  plate.texture.needsUpdate = true;

  // Tilted screen housing at the back.
  const housing = new THREE.Group();
  housing.position.set(0, TOP, SCREEN.z);
  housing.rotation.x = -SCREEN.tilt;
  deck.add(housing);
  const bezel = new THREE.Mesh(
    new RoundedBoxGeometry(SCREEN.width + 0.18, SCREEN.height + 0.18, 0.12, 4, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x080b10, roughness: 0.35, metalness: 0.6 }),
  );
  bezel.position.set(0, SCREEN.height / 2 + 0.06, 0);
  housing.add(bezel);
  const screen = canvasTexture(1024, 448);
  const screenMat = new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false });
  const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.width, SCREEN.height), screenMat);
  screenMesh.position.set(0, SCREEN.height / 2 + 0.06, 0.061);
  housing.add(screenMesh);
  // Wedge under the housing so it reads as one tilted block.
  const wedgeShape = new THREE.Shape();
  const wedgeDepth = Math.sin(SCREEN.tilt) * (SCREEN.height + 0.2);
  const wedgeRise = Math.cos(SCREEN.tilt) * (SCREEN.height + 0.2);
  // Shape x maps to -z after the quarter turn below, so positive x runs away from the player.
  wedgeShape.moveTo(0, 0);
  wedgeShape.lineTo(wedgeDepth, 0);
  wedgeShape.lineTo(wedgeDepth, wedgeRise);
  wedgeShape.closePath();
  const wedge = new THREE.Mesh(
    new THREE.ExtrudeGeometry(wedgeShape, { depth: SCREEN.width + 0.14, bevelEnabled: false }),
    new THREE.MeshStandardMaterial({ color: 0x0a0e14, roughness: 0.5, metalness: 0.5 }),
  );
  wedge.rotation.y = Math.PI / 2;
  wedge.position.set(-(SCREEN.width + 0.14) / 2, TOP, SCREEN.z - 0.06);
  deck.add(wedge);

  const glow = glowTexture();
  const ringGlow = glowTexture(true);
  const screenGlow = glowPlane(glow, palette.blue, SCREEN.width * 1.9, SCREEN.height * 2.3, 0.5);
  // Behind the bezel, so only the halo around its edge shows.
  screenGlow.position.set(0, SCREEN.height / 2 + 0.06, -0.08);
  housing.add(screenGlow);

  // Hot cue pads with an eight-step chase.
  const padGeo = new RoundedBoxGeometry(0.25, 0.07, 0.2, 3, 0.03);
  const pads = Array.from({ length: 8 }, (_, i) => {
    const color = new THREE.Color(i % 2 ? palette.blue : palette.orange);
    const mat = new THREE.MeshStandardMaterial({ color: 0x151b23, emissive: color, emissiveIntensity: 0.15, roughness: 0.4, metalness: 0.1 });
    const mesh = new THREE.Mesh(padGeo, mat);
    mesh.position.set(LAYOUT.padX(i), TOP + 0.035, LAYOUT.padsZ);
    deck.add(mesh);
    const halo = glowPlane(glow, i % 2 ? palette.blue : palette.orange, 0.62, 0.52, 0);
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(LAYOUT.padX(i), TOP + 0.075, LAYOUT.padsZ);
    deck.add(halo);
    return { mat, halo };
  });

  // Jog wheel: recess, platter, LED ring, and the stationary centre display.
  const jog = new THREE.Group();
  jog.position.set(LAYOUT.jogX, TOP, LAYOUT.jogZ);
  deck.add(jog);
  const recess = new THREE.Mesh(
    new THREE.CylinderGeometry(LAYOUT.jogR + 0.06, LAYOUT.jogR + 0.06, 0.04, 96),
    new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.8 }),
  );
  recess.position.y = 0.0;
  jog.add(recess);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(palette.orange), emissiveIntensity: 2.2, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(LAYOUT.jogR + 0.035, 0.012, 12, 160), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.03;
  jog.add(ring);
  const ringHalo = glowPlane(ringGlow, palette.orange, (LAYOUT.jogR + 0.3) * 2, (LAYOUT.jogR + 0.3) * 2, 0.55);
  ringHalo.rotation.x = -Math.PI / 2;
  ringHalo.position.y = 0.035;
  jog.add(ringHalo);

  const platterFace = platterTexture();
  const platter = new THREE.Mesh(new THREE.CylinderGeometry(LAYOUT.jogR, LAYOUT.jogR * 0.985, 0.1, 128), [
    new THREE.MeshStandardMaterial({ color: 0x3a424d, roughness: 0.3, metalness: 0.9 }),
    new THREE.MeshStandardMaterial({ map: platterFace, roughness: 0.42, metalness: 0.75 }),
    new THREE.MeshStandardMaterial({ color: 0x0b0e12 }),
  ]);
  platter.position.y = 0.07;
  jog.add(platter);

  const jogDisplay = canvasTexture(512, 512);
  const displayR = LAYOUT.jogR * 0.4;
  const display = new THREE.Mesh(new THREE.CircleGeometry(displayR, 96), new THREE.MeshBasicMaterial({ map: jogDisplay.texture, toneMapped: false }));
  display.rotation.x = -Math.PI / 2;
  display.position.y = 0.125;
  jog.add(display);
  const displayRim = new THREE.Mesh(
    new THREE.TorusGeometry(displayR + 0.012, 0.016, 12, 96),
    new THREE.MeshStandardMaterial({ color: 0x5a6472, roughness: 0.25, metalness: 1 }),
  );
  displayRim.rotation.x = Math.PI / 2;
  displayRim.position.y = 0.124;
  jog.add(displayRim);

  // Transport buttons: cue (orange, steady) and play (blue, on the beat).
  function roundButton(z: number, color: string) {
    const group = new THREE.Group();
    group.position.set(LAYOUT.buttonsX, TOP, z);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.16, 0.08, 64),
      new THREE.MeshStandardMaterial({ color: 0x1a2029, roughness: 0.35, metalness: 0.4 }),
    );
    cap.position.y = 0.04;
    group.add(cap);
    const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(color), emissiveIntensity: 2, toneMapped: false });
    const led = new THREE.Mesh(new THREE.TorusGeometry(0.168, 0.012, 10, 64), mat);
    led.rotation.x = Math.PI / 2;
    led.position.y = 0.045;
    group.add(led);
    const halo = glowPlane(ringGlow, color, 0.62, 0.62, 0.5);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.09;
    group.add(halo);
    deck.add(group);
    return { mat, halo };
  }
  const cue = roundButton(LAYOUT.cueZ, palette.orange);
  const play = roundButton(LAYOUT.playZ, palette.blue);

  // Loop buttons.
  const smallGeo = new RoundedBoxGeometry(0.2, 0.05, 0.13, 2, 0.02);
  const smallMat = new THREE.MeshStandardMaterial({ color: 0x1b222c, roughness: 0.4, metalness: 0.3 });
  [-0.11, 0.11].forEach((dz) => {
    const b = new THREE.Mesh(smallGeo, smallMat);
    b.position.set(LAYOUT.buttonsX, TOP + 0.025, LAYOUT.loopZ + 0.1 + dz);
    deck.add(b);
  });

  // Tempo fader: slot, cap, and centre LED.
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.02, LAYOUT.faderZ1 - LAYOUT.faderZ0), new THREE.MeshStandardMaterial({ color: 0x020305 }));
  slot.position.set(LAYOUT.faderX, TOP + 0.005, (LAYOUT.faderZ0 + LAYOUT.faderZ1) / 2);
  deck.add(slot);
  const faderCap = new THREE.Mesh(
    new RoundedBoxGeometry(0.26, 0.11, 0.13, 3, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x2b333e, roughness: 0.3, metalness: 0.7 }),
  );
  faderCap.position.set(LAYOUT.faderX, TOP + 0.06, LAYOUT.faderZ0 + (LAYOUT.faderZ1 - LAYOUT.faderZ0) * 0.47);
  deck.add(faderCap);
  const faderLine = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.004, 0.012),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.orange), toneMapped: false }),
  );
  faderLine.position.set(0, 0.056, 0);
  faderCap.add(faderLine);

  // Contact shadow so the deck sits on the page in light mode.
  const shadowTex = glowTexture();
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 1.45, D * 1.22),
    new THREE.MeshBasicMaterial({ map: shadowTex, color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, -0.01, -0.15);
  deck.add(shadow);

  const wave = makeWaveform();

  function applyTheme() {
    // Glows carry the dark booth; on the light page they are toned down to a tint.
    const g = dark ? 1 : 0.45;
    screenGlow.material.opacity = 0.5 * g;
    ringHalo.material.opacity = 0.55 * g;
    cue.halo.material.opacity = 0.5 * g;
    play.halo.material.opacity = 0.5 * g;
    shadow.material.opacity = dark ? 0.6 : 0.32;
    scene.environmentIntensity = dark ? 0.55 : 0.8;
    renderer.toneMappingExposure = dark ? 1.05 : 1.15;
  }
  applyTheme();

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the whole deck in frame on narrow (portrait) canvases.
    camera.fov = camera.aspect < 1 ? 30 / Math.max(0.62, camera.aspect) : 30;
    camera.updateProjectionMatrix();
  }
  resize();
  const observer = new ResizeObserver(() => {
    resize();
    if (reducedMotion) renderFrame(STILL_TIME);
  });
  observer.observe(canvas);

  const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 4);
  let lastTextureFrame = -1;

  function renderFrame(t: number) {
    const beat = t * BEATS_PER_SECOND;
    const phase = beat % 1;
    const kick = Math.exp(-phase * 5);

    // Camera: settle in over the first second, then a slow drift.
    const intro = reducedMotion ? 1 : ease(t / 1.1);
    const yaw = -0.32 + (reducedMotion ? 0 : Math.sin(t * 0.32) * 0.07) + (1 - intro) * 0.25;
    const elevation = 0.86 - (1 - intro) * 0.18;
    const distance = 10.2 + (1 - intro) * 2.2;
    camera.position.set(
      Math.sin(yaw) * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance,
      Math.cos(yaw) * Math.cos(elevation) * distance,
    );
    camera.lookAt(0, 0.42, -0.08);
    deck.position.y = (1 - intro) * -0.25;

    platter.rotation.y = -t * Math.PI * 2 * (33.3 / 60);
    const g = dark ? 1 : 0.45;
    ringMat.emissiveIntensity = 1.6 + kick * 1.6;
    ringHalo.material.opacity = (0.38 + kick * 0.3) * g;
    warm.intensity = 1.6 + kick * 1.8;
    play.mat.emissiveIntensity = 1.2 + kick * 1.8;
    play.halo.material.opacity = (0.3 + kick * 0.35) * g;
    const lit = Math.floor(beat) % 8;
    pads.forEach((p, i) => {
      const on = i === lit ? kick : i === (lit + 7) % 8 ? 0.25 * kick : 0;
      p.mat.emissiveIntensity = 0.05 + on * 2.6;
      p.halo.material.opacity = on * 0.7 * g;
    });
    faderCap.position.z = LAYOUT.faderZ0 + (LAYOUT.faderZ1 - LAYOUT.faderZ0) * (0.47 + (reducedMotion ? 0 : Math.sin(t * 0.4) * 0.015));

    // Screens redraw at most 30 times a second.
    const textureFrame = Math.floor(t * 30);
    if (textureFrame !== lastTextureFrame) {
      lastTextureFrame = textureFrame;
      drawScreen(screen.ctx, 1024, 448, beat, wave, palette, fonts);
      screen.texture.needsUpdate = true;
      drawJogDisplay(jogDisplay.ctx, 512, beat, palette, fonts);
      jogDisplay.texture.needsUpdate = true;
    }
    renderer.render(scene, camera);
  }

  // Reduced motion shows one composed frame: mid-track, on a downbeat.
  const STILL_TIME = 37.5 / BEATS_PER_SECOND;
  let frame = 0;
  let start = 0;
  let first = true;
  const tick = (now: number) => {
    if (!start) start = now;
    renderFrame((now - start) / 1000);
    if (first) {
      first = false;
      options.onFirstFrame?.();
    }
    frame = requestAnimationFrame(tick);
  };
  if (reducedMotion) {
    renderFrame(STILL_TIME);
    options.onFirstFrame?.();
  } else {
    frame = requestAnimationFrame(tick);
  }

  return {
    setDark(next) {
      dark = next;
      applyTheme();
      if (reducedMotion) renderFrame(STILL_TIME);
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const m of mats) {
          for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
          m.dispose();
        }
      });
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
