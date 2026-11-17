/**
 * The color picker's paint inside one section of another page (components/picker/paint-section.tsx):
 * the same frame, warp, flow, ramp, paper and grain as on the color picker landing, laid out in the
 * section's own coordinates — its top-left corner is the "page" origin the shader and
 * lib/paint-layout.ts work in — and fading out above and below the section along a ragged airbrush
 * edge, so what lies under the page (the kit's sky) runs into the paint and out of it again. The
 * fragment shader does the same math in GLSL; this copy is what tests check and what draws the still
 * frame where there is no WebGL 2.
 */

import type { CalmMap } from './paint-calm';
import { mirror, noise, tileSize, warp, type Size } from './paint-layout';
import { calmLinear, frameLuminance, lutAt, type Pixels } from './paint-sample';

/** A section's paint, CSS px: the band it fades in over at its top, its height, the band it fades out over at its bottom. */
export interface SectionEdges {
  readonly top: number;
  readonly height: number;
  readonly bottom: number;
}

/** Share of a band the airbrush edge wanders over: the rest is a plain smoothstep. */
export const EDGE_RAGGED = 0.45;
/** The edge's noise scale, CSS px: a wander every couple of hundred px across. */
const EDGE_SCALE = 220;
/** Largest value of `fbm` (four octaves of value noise, halving): the ragged shift is normalised by it. */
const FBM_MAX = 0.9375;

const smoothstep = (low: number, high: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

/** The shader's `fbm`: four octaves of `noise`, 0 to FBM_MAX. */
export function fbm(x: number, y: number): number {
  let value = 0;
  let amplitude = 0.5;
  let px = x;
  let py = y;
  for (let octave = 0; octave < 4; octave += 1) {
    value += amplitude * noise(px, py);
    px = px * 2.03 + 17.1;
    py = py * 2.03 + 17.1;
    amplitude *= 0.5;
  }
  return value;
}

/**
 * How opaque the paint is at a point of the section (CSS px from its top-left), 0–1: 0 above and
 * below it, 1 between its bands, and a smooth rise over each band whose start wanders with the
 * noise — the airbrush edge. Never above 0 outside the section, so the paint cannot spill over the
 * sections next to it.
 */
export function edgeAlpha(x: number, y: number, edges: SectionEdges): number {
  const { top, height, bottom } = edges;
  if (height <= 0) return 1;
  if (y <= 0 || y >= height) return 0;
  const ragged = (fbm(x / EDGE_SCALE, y / EDGE_SCALE) / FBM_MAX) * EDGE_RAGGED;
  const rise = smoothstep(0, top * (1 - EDGE_RAGGED), y - ragged * top);
  const fall = 1 - smoothstep(height - bottom * (1 - EDGE_RAGGED), height, y + ragged * bottom);
  return rise * fall;
}

/**
 * The bands for a section of `height` CSS px: the ones the page asks for, shrunk evenly when the
 * section is too short to hold both and some paint between them; never 0 (the shader's smoothstep
 * needs a width).
 */
export function sectionEdges(height: number, top: number, bottom: number): SectionEdges {
  const room = Math.max(0, height * 0.8);
  const fit = top + bottom > room && top + bottom > 0 ? room / (top + bottom) : 1;
  return { top: Math.max(1, top * fit), height: Math.max(0, height), bottom: Math.max(1, bottom * fit) };
}

/** The section's coordinate of the window's top row: what the shader takes as the scroll of a canvas fixed to the window. */
export const sectionScroll = (scrollY: number, sectionTop: number): number => scrollY - sectionTop;

/** What a still frame of the section's paint is drawn from. */
export interface StillSample {
  /** The long frame's pixels. */
  readonly frame: Pixels;
  /** The section, CSS px (its width is the window's: the frame spans it). */
  readonly size: Size;
  /** The window's height, CSS px: on a phone the frame is MIN_SCREENS screens long (tileSize). */
  readonly windowHeight: number;
  /** The paper under the section's copy, section coordinates; null for none. */
  readonly calm: CalmMap | null;
  /** The frame's brightness under the copy, at least (the renderer's LIFT). */
  readonly lift: number;
  /** The dark theme: the frame read upside down. */
  readonly invert: boolean;
  /** The ramp, as the shader's lookup table. */
  readonly lut: Uint8Array;
  readonly edges: SectionEdges;
}

/**
 * The paint standing still (no flow, no stirring, no grain) at `scale` device px per CSS px, as
 * straight RGBA8 rows: what the shader draws with the flow stopped, worked out on the CPU for a
 * browser without WebGL 2. Each pixel takes the point at its centre.
 */
export function stillPaint(sample: StillSample, scale: number): { readonly data: Uint8ClampedArray<ArrayBuffer>; readonly width: number; readonly height: number } {
  const { frame, size, calm, lift, invert, lut, edges } = sample;
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  const data = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  const tile = tileSize({ width: size.width, height: sample.windowHeight }, frame.width / frame.height);
  for (let row = 0; row < height; row += 1) {
    const y = (row + 0.5) / scale;
    // The warp leans and stretches whole rows: worked out once per row.
    const [shift, wv] = warp(0, y / tile.height);
    const v = mirror(wv);
    for (let column = 0; column < width; column += 1) {
      const x = (column + 0.5) / scale;
      const at = (row * width + column) * 4;
      const alpha = edgeAlpha(x, y, edges);
      if (alpha <= 0) continue;
      const u = mirror(0.5 + (x - size.width * 0.5) / tile.width + shift);
      let bright = frameLuminance(frame, u, v);
      if (calm) {
        const lifted = smoothstep(0, 1, calmLinear(calm, x, y));
        bright += (Math.max(bright, lift) - bright) * lifted;
      }
      const [r, g, b] = lutAt(lut, invert ? 1 - bright : bright);
      data[at] = r;
      data[at + 1] = g;
      data[at + 2] = b;
      data[at + 3] = alpha * 255;
    }
  }
  return { data, width, height };
}
