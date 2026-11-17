/**
 * The color the page's paint shows under a point (COLOR_PICKER §8.7): what a click on the paint in
 * Tools takes. It follows the page's fragment shader (components/picker/paint-shader.ts) step by step
 * — the frame's uv by the page's layout (lib/paint-layout.ts: tiles, mirror, warp, flow), the frame's
 * brightness (Rec. 709), the paper lifted under the copy, the dark theme reading it upside down, and
 * the same 256-entry ramp the shader samples with linear filtering — so the color is worked out from
 * the frame and the ramp, not read off the screen, and every browser gets it. The still grain (zero
 * mean, a few percent) is left out: it is not the color.
 */

import type { CalmMap } from './paint-calm';
import { frameUv, type FrameLayout } from './paint-layout';
import { LUT_SIZE } from './picker-ramp';

/** A decoded picture's pixels, RGBA8, row 0 at the top. */
export interface Pixels {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}

export interface PaintSample {
  /** The long frame as the shader got it. */
  readonly frame: Pixels;
  /** Where it lies on the page and where the flow is. */
  readonly layout: FrameLayout;
  /** The paper under the copy, page coordinates; null for none. */
  readonly calm: CalmMap | null;
  /** The frame's brightness under the copy, at least (the renderer's LIFT). */
  readonly lift: number;
  /** The dark theme: the frame read upside down. */
  readonly invert: boolean;
  /** The ramp on screen, as the shader's lookup table (rampLut). */
  readonly lut: Uint8Array;
  /** Where the cursor's stirring carried the paint at this point from: a shift in CSS px (none when still). */
  readonly stirred?: { readonly x: number; readonly y: number };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const smoothstep = (low: number, high: number, value: number) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};
const hexPair = (value: number) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');

/** Rec. 709 weights on the stored (sRGB-encoded) values, as the shader takes them. */
const luminance = (data: ArrayLike<number>, at: number) => (0.2126 * data[at]! + 0.7152 * data[at + 1]! + 0.0722 * data[at + 2]!) / 255;

/**
 * The frame's brightness at uv: the mean over the 3 × 3 texels round the nearest one. The shader
 * reads a single filtered texel; the eye (and a click) takes a little area, and one texel of the
 * airbrush's own speckle is not its color.
 */
export function frameLuminance(frame: Pixels, u: number, v: number): number {
  const cx = clamp(Math.floor(u * frame.width), 0, frame.width - 1);
  const cy = clamp(Math.floor(v * frame.height), 0, frame.height - 1);
  let sum = 0;
  let count = 0;
  for (let y = Math.max(0, cy - 1); y <= Math.min(frame.height - 1, cy + 1); y += 1) {
    for (let x = Math.max(0, cx - 1); x <= Math.min(frame.width - 1, cx + 1); x += 1) {
      sum += luminance(frame.data, (y * frame.width + x) * 4);
      count += 1;
    }
  }
  return sum / count;
}

/** The calm map at a page point with linear filtering, as the shader's texture() reads it, 0–1. */
export function calmLinear(map: CalmMap, x: number, y: number): number {
  const fx = clamp(x / map.scale - 0.5, 0, map.width - 1);
  const fy = clamp(y / map.scale - 0.5, 0, map.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(map.width - 1, x0 + 1);
  const y1 = Math.min(map.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (column: number, row: number) => map.data[row * map.width + column]! / 255;
  const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * tx;
  const bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * tx;
  return top + (bottom - top) * ty;
}

/** The lookup table at t with linear filtering between texel centres, as the shader samples it: [r, g, b] 0–255. */
export function lutAt(lut: Uint8Array, t: number): readonly [number, number, number] {
  const position = clamp(t * LUT_SIZE - 0.5, 0, LUT_SIZE - 1);
  const low = Math.floor(position);
  const high = Math.min(LUT_SIZE - 1, low + 1);
  const mix = position - low;
  const channel = (offset: number) => lut[low * 4 + offset]! + (lut[high * 4 + offset]! - lut[low * 4 + offset]!) * mix;
  return [channel(0), channel(1), channel(2)];
}

/** The paint's color under a point of the page (CSS px from its top-left), as `#rrggbb`. */
export function paintColorAt(x: number, pageY: number, sample: PaintSample): string {
  // The paint flowed here from a little way off; the paper stays where the copy is.
  const [u, v] = frameUv(x + (sample.stirred?.x ?? 0), pageY + (sample.stirred?.y ?? 0), sample.layout);
  let bright = frameLuminance(sample.frame, u, v);
  if (sample.calm) {
    const calm = smoothstep(0, 1, calmLinear(sample.calm, x, pageY));
    bright += (Math.max(bright, sample.lift) - bright) * calm;
  }
  const [r, g, b] = lutAt(sample.lut, sample.invert ? 1 - bright : bright);
  return `#${hexPair(r)}${hexPair(g)}${hexPair(b)}`;
}

/**
 * A picture's pixels, read once through a 2D canvas; null where one cannot be had. The picture is
 * stretched over the canvas: a candidate picked from a `srcset` reports a natural size corrected by
 * its density (a 1280w frame in a 1440 px window is 1440 px wide), and drawn at its own size it would
 * leave the canvas' far side empty.
 */
export function readPixels(image: HTMLImageElement): Pixels | null {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width === 0 || height === 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  return { data: context.getImageData(0, 0, width, height).data, width, height };
}
