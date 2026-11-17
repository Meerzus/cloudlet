import { describe, expect, it } from 'vitest';
import { PAINT_FRAGMENT } from '../../apps/site/src/components/picker/paint-shader';
import { calmMap } from '../../apps/site/src/lib/paint-calm';
import { tileSize } from '../../apps/site/src/lib/paint-layout';
import { paintColorAt, type Pixels } from '../../apps/site/src/lib/paint-sample';
import { EDGE_RAGGED, edgeAlpha, fbm, sectionEdges, sectionScroll, stillPaint } from '../../apps/site/src/lib/paint-section';
import { heroRamp, rampLut } from '../../apps/site/src/lib/picker-ramp';

const edges = { top: 280, height: 1600, bottom: 240 };
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;

/** A frame whose grey value changes across and down, so a misplaced texel shows. */
function frame(width: number, height: number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = Math.round(((x * 7 + y * 3) % 256) * 0.6 + 60);
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

describe('the paint in a section of another page: its edges', () => {
  it('is fully transparent above and below the section, so it never spills over its neighbours', () => {
    for (let x = 0; x <= 1440; x += 37) {
      for (const y of [-500, -1, 0, edges.height, edges.height + 1, edges.height + 900]) expect(edgeAlpha(x, y, edges), `${x}, ${y}`).toBe(0);
    }
  });

  it('is opaque between its bands, wherever the airbrush edge wanders', () => {
    for (let x = 0; x <= 1440; x += 23) {
      for (let y = edges.top; y <= edges.height - edges.bottom; y += 41) expect(edgeAlpha(x, y, edges), `${x}, ${y}`).toBe(1);
    }
  });

  it('rises and falls smoothly over the bands, and the ragged start wanders across the section', () => {
    const step = 2;
    for (let x = 0; x <= 1440; x += 61) {
      let previous = edgeAlpha(x, 0, edges);
      for (let y = step; y < edges.height; y += step) {
        const alpha = edgeAlpha(x, y, edges);
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThanOrEqual(1);
        // No hard step anywhere: the sky runs into the paint.
        expect(Math.abs(alpha - previous), `${x}, ${y}`).toBeLessThan(0.05);
        previous = alpha;
      }
    }
    // Halfway down the top band the paint is more opaque in some columns than in others.
    const middle = [...Array(60).keys()].map((index) => edgeAlpha(index * 24, edges.top * 0.5, edges));
    expect(Math.max(...middle) - Math.min(...middle)).toBeGreaterThan(0.15);
  });

  it('a whole page (height 0) has no edges', () => {
    expect(edgeAlpha(100, 5000, { top: 1, height: 0, bottom: 1 })).toBe(1);
  });

  it('wanders by the same fbm as the shader, normalised to its largest value', () => {
    expect(PAINT_FRAGMENT).toContain('uniform vec3 uEdges;');
    expect(PAINT_FRAGMENT).toContain('fbm(actual / 220.0) / 0.9375 * uRagged');
    expect(EDGE_RAGGED).toBeGreaterThan(0);
    expect(EDGE_RAGGED).toBeLessThan(1);
    for (let index = 0; index < 400; index += 1) {
      const value = fbm(index * 0.37, index * 0.11);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0.9375);
    }
  });

  it('a short section shrinks both bands evenly and keeps paint between them', () => {
    expect(sectionEdges(2000, 300, 250)).toEqual({ top: 300, height: 2000, bottom: 250 });
    const short = sectionEdges(500, 300, 200);
    expect(short.top / short.bottom).toBeCloseTo(1.5);
    expect(short.top + short.bottom).toBeCloseTo(400);
    // Never a zero band: the shader's smoothstep needs a width.
    expect(sectionEdges(0, 300, 200).top).toBeGreaterThan(0);
  });
});

describe('the paint in a section of another page: where it lies', () => {
  it('a canvas fixed to the window shows the section from the window’s top row: negative above the section', () => {
    expect(sectionScroll(1000, 1800)).toBe(-800);
    expect(sectionScroll(1800, 1800)).toBe(0);
    expect(sectionScroll(2300, 1800)).toBe(500);
  });

  it('the still frame is what the shader draws with the flow stopped: color by color, alpha by the edges', () => {
    const size = { width: 360, height: 400 };
    const small = { top: 80, height: size.height, bottom: 60 };
    const texels = frame(40, 120);
    const calm = calmMap([{ x: 40, y: 150, width: 200, height: 30 }], size.width, size.height);
    const lut = rampLut(heroRamp('#ff6a3d')!.stops);
    const scale = 0.25;
    const windowHeight = 800;
    for (const invert of [false, true]) {
      const still = stillPaint({ frame: texels, size, windowHeight, calm, lift: 0.97, invert, lut, edges: small }, scale);
      expect(still.width).toBe(90);
      expect(still.height).toBe(100);
      const layout = { width: size.width, tile: tileSize({ width: size.width, height: windowHeight }, texels.width / texels.height), phase: 0, flow: 0 };
      for (let row = 0; row < still.height; row += 7) {
        for (let column = 0; column < still.width; column += 5) {
          const x = (column + 0.5) / scale;
          const y = (row + 0.5) / scale;
          const at = (row * still.width + column) * 4;
          const alpha = edgeAlpha(x, y, small);
          expect(still.data[at + 3]).toBe(Math.round(alpha * 255));
          if (alpha === 0) continue;
          const expected = paintColorAt(x, y, { frame: texels, layout, calm, lift: 0.97, invert, lut });
          expect(hex(still.data[at]!, still.data[at + 1]!, still.data[at + 2]!), `${column}, ${row}`).toBe(expected);
        }
      }
    }
  });
});
