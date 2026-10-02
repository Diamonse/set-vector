import type { PlateLayout } from "./deck-art";

/**
 * Deck geometry and the loader camera, shared by the 3D scene and the SVG fallback so both
 * show the same deck from the same viewpoint. Scene units: x across, y up, z toward the player.
 */

export const DECK_W = 3.2;
export const DECK_D = 4.1;
export const BODY_H = 0.3;
export const TOP = BODY_H;

export const LAYOUT: PlateLayout = {
  width: DECK_W,
  depth: DECK_D,
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

export const SCREEN = { width: 2.7, height: 1.18, tilt: 0.52, z: -1.38, lift: 0.06 };

/** Stage aspect ratios: landscape from the sm breakpoint up, portrait on phones. */
export const STAGE_ASPECT = { wide: 5 / 4, narrow: 4 / 5 };

export type Vec3 = [number, number, number];

export interface CameraPose {
  eye: Vec3;
  target: Vec3;
  /** Vertical field of view in degrees. */
  fov: number;
}

const TARGET: Vec3 = [0, 0.36, -0.06];
const DISTANCE = 9.7;
const ELEVATION = 0.86;
const YAW = -0.32;

/** The camera at time `t`; `drift` adds the slow sway. At t = 0 it is the resting pose. */
export function cameraPose(aspect: number, t = 0, drift = false): CameraPose {
  const yaw = YAW + (drift ? Math.sin(t * 0.32) * 0.07 : 0);
  // Portrait stages widen the vertical view so the deck's width still fits.
  const fov = aspect >= 1 ? 30 : 30 * Math.min(1.6, 1.12 / aspect);
  return {
    eye: [Math.sin(yaw) * Math.cos(ELEVATION) * DISTANCE, Math.sin(ELEVATION) * DISTANCE, Math.cos(yaw) * Math.cos(ELEVATION) * DISTANCE],
    target: TARGET,
    fov,
  };
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Perspective projection matching three.js PerspectiveCamera.lookAt: maps a scene point to
 * pixel coordinates on a `width` x `height` stage.
 */
export function projector(pose: CameraPose, width: number, height: number) {
  const z = norm(sub(pose.eye, pose.target));
  const x = norm(cross([0, 1, 0], z));
  const y = cross(z, x);
  const f = 1 / Math.tan(((pose.fov / 2) * Math.PI) / 180);
  const aspect = width / height;
  return (p: Vec3): [number, number] => {
    const d = sub(p, pose.eye);
    const cz = -dot(d, z);
    const nx = (dot(d, x) / cz) * (f / aspect);
    const ny = (dot(d, y) / cz) * f;
    return [((nx + 1) / 2) * width, ((1 - ny) / 2) * height];
  };
}
