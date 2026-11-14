/**
 * The paper under the copy (COLOR_PICKER §8.2): a soft map of where the lines of text sit on the
 * color picker landing, by their line boxes rather than their blocks, so the paint keeps every gap
 * between paragraphs. The page's shader lifts the frame's paper toward the ramp's end where the map
 * is high. Built on the CPU (no 2D canvas), so tests can feed it line boxes.
 */

/** A rectangle in CSS px from the page's top-left corner. */
export interface PageRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CalmMap {
  /** One byte per texel, row 0 at the page's top: 255 lifts the paper fully. */
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** CSS px per texel. */
  readonly scale: number;
}

/** The copy whose lines get paper under them: the hero's, the sections' and the footer's. */
export const CALM_TEXT = '.cp-hero-copy, .cp-section :is(h2, h3, p, th, td, summary, label, .cp-copy-text), .docs-footer';

/** The header's controls: the paper is lifted under each of them, not in a strip across the window. */
export const CALM_HEADER = '.site-header :is(a, button)';
/** How far the paper under a box reaches past it, CSS px, at most: a map this much taller than the header holds all of it. */
export const CALM_REACH = 240;

/** CSS px per texel, at least; a very long page takes coarser texels to stay within MAX_TEXELS rows. */
const SCALE = 6;
const MAX_TEXELS = 4096;
/** Paper reaches this far past a line at full lift (CSS px), then fades over about as much again. */
const PAD = 32;
/** The fade: three box blurs each way of this radius (CSS px) come close to a gaussian. */
const BLUR = 64;
/** Lift of the blurred field: the core under a line stays at full lift after the blur. */
const GAIN = 2.2;

/** The line boxes of the text inside `elements`, in page coordinates; hidden and visually hidden text has none. */
export function lineRects(elements: Iterable<Element>, scrollX: number, scrollY: number): PageRect[] {
  const rects: PageRect[] = [];
  for (const element of elements) {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        // sr-only text is clipped to a pixel.
        if (box.width > 1 && box.height > 1) rects.push({ x: box.left + scrollX, y: box.top + scrollY, width: box.width, height: box.height });
      }
    }
  }
  return rects;
}

/** The boxes of `elements` that are shown, shifted by the scroll (pass 0, 0 for window coordinates). */
export function boxRects(elements: Iterable<Element>, scrollX: number, scrollY: number): PageRect[] {
  const rects: PageRect[] = [];
  for (const element of elements) {
    const box = element.getBoundingClientRect();
    if (box.width > 1 && box.height > 1) rects.push({ x: box.left + scrollX, y: box.top + scrollY, width: box.width, height: box.height });
  }
  return rects;
}

/** One box blur along rows (step 1, stride = width) or columns (step = width, stride 1), in place. */
function boxBlur(field: Float32Array, length: number, lines: number, radius: number, step: number, stride: number) {
  const line = new Float32Array(length);
  const at = (index: number) => line[Math.min(length - 1, Math.max(0, index))]!;
  for (let l = 0; l < lines; l += 1) {
    const base = l * stride;
    for (let i = 0; i < length; i += 1) line[i] = field[base + i * step]!;
    let sum = 0;
    for (let i = -radius; i <= radius; i += 1) sum += at(i);
    for (let i = 0; i < length; i += 1) {
      field[base + i * step] = sum / (2 * radius + 1);
      sum += at(i + radius + 1) - at(i - radius);
    }
  }
}

/** The map for a page of `width` × `height` CSS px with text in `rects`. */
export function calmMap(rects: readonly PageRect[], width: number, height: number): CalmMap {
  const scale = Math.max(SCALE, Math.ceil(height / MAX_TEXELS));
  const columns = Math.max(1, Math.ceil(width / scale));
  const rows = Math.max(1, Math.ceil(height / scale));
  const field = new Float32Array(columns * rows);
  for (const rect of rects) {
    const x0 = Math.max(0, Math.floor((rect.x - PAD) / scale));
    const x1 = Math.min(columns, Math.ceil((rect.x + rect.width + PAD) / scale));
    const y0 = Math.max(0, Math.floor((rect.y - PAD) / scale));
    const y1 = Math.min(rows, Math.ceil((rect.y + rect.height + PAD) / scale));
    for (let y = y0; y < y1; y += 1) field.fill(1, y * columns + x0, y * columns + Math.max(x0, x1));
  }
  const radius = Math.max(1, Math.round(BLUR / scale));
  for (let pass = 0; pass < 3; pass += 1) {
    boxBlur(field, columns, rows, radius, 1, columns);
    boxBlur(field, rows, columns, radius, columns, 1);
  }
  const data = new Uint8Array(columns * rows);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.min(255, Math.round(field[index]! * GAIN * 255));
  return { data, width: columns, height: rows, scale };
}

/** The map's lift at a page point, 0–1 (nearest texel): what the shader reads before its smoothstep. */
export function calmAt(map: CalmMap, x: number, y: number): number {
  const column = Math.min(map.width - 1, Math.max(0, Math.floor(x / map.scale)));
  const row = Math.min(map.height - 1, Math.max(0, Math.floor(y / map.scale)));
  return map.data[row * map.width + column]! / 255;
}
