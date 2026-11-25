/**
 * Where the color picker landing's long frame lies on the page (COLOR_PICKER §8.2): one copy spans
 * the window's width from the top of the page down, every further copy is mirrored so each seam meets
 * its own edge, a slow warp the size of the page keeps the repeats from lining up, and the flow moves
 * it a few percent at rest. The page's fragment shader (components/picker/paint-shader.ts) does the
 * same math in GLSL; this copy is what tests check and what picks the color under a point.
 */

/** The frame's flow (§8.3): a 36 s loop over 3 % of the frame, drawn at 30 fps. */
export const FLOW = 0.03;
export const CYCLE_MS = 36_000;
export const FLOW_FPS = 30;
/** On a phone the frame is at least this many screens long: cropped at the sides, not squeezed into a strip. */
export const MIN_SCREENS = 2.5;

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** One copy of the frame on the page, CSS px: the window's width, or MIN_SCREENS screens long when that is longer. */
export function tileSize(viewport: Size, aspect: number): Size {
  const height = Math.max(viewport.width / aspect, viewport.height * MIN_SCREENS);
  return { width: height * aspect, height };
}

const fract = (value: number) => value - Math.floor(value);
const smoothstep = (low: number, high: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

/** The shader's `hash`: a value in [0, 1) per lattice point. */
export function hash(x: number, y: number): number {
  let qx = fract(x * 0.1031);
  let qy = fract(y * 0.1031);
  let qz = fract(x * 0.1031);
  const d = qx * (qy + 33.33) + qy * (qz + 33.33) + qz * (qx + 33.33);
  qx += d;
  qy += d;
  qz += d;
  return fract((qx + qy) * qz);
}

/** The shader's `noise`: value noise with a quintic fade, smooth everywhere. */
export function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const top = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * ux;
  const bottom = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * ux;
  return top + (bottom - top) * uy;
}

/** Folds a coordinate into [0, 1] by mirroring at every whole number: 1.2 reads 0.8, 2.2 reads 0.2. */
export function mirror(value: number): number {
  const m = ((value % 2) + 2) % 2;
  return m < 1 ? m : 2 - m;
}

/**
 * The page's warp before the mirror: none over the first screens, then a slow lean and stretch.
 * Continuous and increasing in v, so the frame never folds back on itself.
 */
export function warp(u: number, v: number): readonly [number, number] {
  const below = smoothstep(0.6, 1.4, v);
  return [u + (noise(v * 0.55, 2.3) - 0.5) * 0.35 * below, v + (noise(v * 0.4, 7.1) - 0.5) * 0.45 * below];
}

export interface FrameLayout {
  /** The window's width, CSS px. */
  readonly width: number;
  /** One copy of the frame, CSS px (tileSize). */
  readonly tile: Size;
  /** Flow cycle, [0, 1). */
  readonly phase: number;
  /** Flow amplitude in frame uv: FLOW, or 0 when the picture stands still. */
  readonly flow: number;
}

/** The frame's uv (0–1, v = 0 its top row) under a point of the page, CSS px from the page's top-left. */
export function frameUv(x: number, pageY: number, layout: FrameLayout): readonly [number, number] {
  const { width, tile, phase, flow } = layout;
  const [wu, wv] = warp(0.5 + (x - width * 0.5) / tile.width, pageY / tile.height);
  const u = mirror(wu);
  const v = mirror(wv);
  // Two low-frequency fields walked round a circle, so the cycle closes on itself.
  const angle = 2 * Math.PI * phase;
  const lx = Math.cos(angle) * 0.8;
  const ly = Math.sin(angle) * 0.8;
  const px = u * 1.7;
  const py = (pageY / tile.height) * 1.2;
  const dx = noise(px + lx, py + ly) + 0.5 * noise(px * 2.1 + 9.2 - lx, py * 2.1 + 3.1 - ly);
  const dy = noise(px + 4.7 + ly, py + 1.9 + lx) + 0.5 * noise(px * 2.1 + 1.3 - ly, py * 2.1 + 7.7 - lx);
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return [clamp(u + (dx / 1.5 - 0.5) * 2 * flow), clamp(v + (dy / 1.5 - 0.5) * 2 * flow)];
}
