import { describe, expect, it } from 'vitest';
import { calmAt, calmMap } from '../../apps/site/src/lib/paint-calm';
import { frameUv, tileSize } from '../../apps/site/src/lib/paint-layout';
import { calmLinear, frameLuminance, lutAt, paintColorAt, type PaintSample, type Pixels } from '../../apps/site/src/lib/paint-sample';
import { LUT_SIZE } from '../../apps/site/src/lib/picker-ramp';

/** A lookup table straight in bytes: entry i is `color(i / (LUT_SIZE − 1))`. */
const table = (color: (t: number) => readonly [number, number, number]) => {
  const out = new Uint8Array(LUT_SIZE * 4);
  for (let index = 0; index < LUT_SIZE; index += 1) out.set([...color(index / (LUT_SIZE - 1)).map(Math.round), 255], index * 4);
  return out;
};
/** Black at the ramp's start, white at its end: a lookup reads back the brightness it was given. */
const GREY = table((t) => [t * 255, t * 255, t * 255]);
/** Red to blue, so a mix of the two ends shows. */
const RED_BLUE = table((t) => [(1 - t) * 255, 0, t * 255]);

/** A frame of `width` × `height` texels whose grey value is `value(x, y)`. */
function frame(width: number, height: number, value: (x: number, y: number) => number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set([value(x, y), value(x, y), value(x, y), 255], (y * width + x) * 4);
  return { data, width, height };
}

const viewport = { width: 1200, height: 800 };
const layout = { width: viewport.width, tile: tileSize(viewport, 1 / 3), phase: 0, flow: 0 };
const sample = (over: Partial<PaintSample>): PaintSample => ({ frame: frame(30, 90, () => 128), layout, calm: null, lift: 0.97, invert: false, lut: GREY, ...over });
const channel = (hex: string) => Number.parseInt(hex.slice(1, 3), 16);

describe('the color under a point of the paint (COLOR_PICKER §8.7)', () => {
  it('samples the lookup table as the shader does: linear between texel centres, clamped at the ends', () => {
    expect(lutAt(RED_BLUE, 0)).toEqual([255, 0, 0]);
    expect(lutAt(RED_BLUE, 1)).toEqual([0, 0, 255]);
    // The first and last half texel read the end entries.
    expect(lutAt(RED_BLUE, 0.4 / LUT_SIZE)).toEqual([255, 0, 0]);
    // Halfway between the centres of entries 127 and 128.
    const middle = lutAt(GREY, 0.5);
    const low = GREY[127 * 4]!;
    const high = GREY[128 * 4]!;
    expect(middle[0]).toBeCloseTo((low + high) / 2, 6);
  });

  it('reads the frame’s brightness by Rec. 709 and finds it on the ramp', () => {
    // Pure green has a luminance of 0.7152.
    const green: Pixels = { data: new Uint8ClampedArray(Array.from({ length: 9 }, () => [0, 255, 0, 255]).flat()), width: 3, height: 3 };
    expect(frameLuminance(green, 0.5, 0.5)).toBeCloseTo(0.7152, 4);
    const color = paintColorAt(600, 300, sample({ frame: { ...green } }));
    expect(channel(color)).toBeCloseTo(0.7152 * 255, -0.5);
  });

  it('reads the frame upside down in the dark theme', () => {
    const light = paintColorAt(600, 300, sample({ frame: frame(30, 90, () => 51), lut: RED_BLUE }));
    const dark = paintColorAt(600, 300, sample({ frame: frame(30, 90, () => 51), lut: RED_BLUE, invert: true }));
    // 20 % along the ramp, and 80 %.
    expect(channel(light)).toBeGreaterThan(190);
    expect(channel(dark)).toBeLessThan(65);
  });

  it('lifts the paper under the copy as far as the shader does, and leaves the paint away from it', () => {
    const calm = calmMap([{ x: 400, y: 200, width: 400, height: 40 }], viewport.width, 1600);
    const dim = frame(30, 90, () => 64);
    const under = paintColorAt(600, 220, sample({ frame: dim, calm }));
    const away = paintColorAt(600, 1400, sample({ frame: dim, calm }));
    expect(channel(under)).toBeGreaterThanOrEqual(Math.floor(0.97 * 255) - 1);
    expect(channel(away)).toBeCloseTo(64, -0.5);
    // Linear filtering matches the nearest texel at a texel's centre.
    const centre = calm.scale * 40.5;
    expect(calmLinear(calm, centre, centre)).toBeCloseTo(calmAt(calm, centre, centre), 6);
  });

  it('follows the page’s layout: a frame dark on its left and light on its right reads so across the window', () => {
    // 1200 px wide window, the frame spans it: x = 100 falls on the dark left, x = 1100 on the light right.
    const split = frame(40, 120, (x) => (x < 20 ? 0 : 255));
    expect(frameUv(100, 300, layout)[0]).toBeLessThan(0.5);
    expect(paintColorAt(100, 300, sample({ frame: split }))).toBe('#000000');
    expect(paintColorAt(1100, 300, sample({ frame: split }))).toBe('#ffffff');
    // The second copy down the page is mirrored: the same sides, the seam meeting its own edge.
    expect(paintColorAt(100, layout.tile.height + 100, sample({ frame: split }))).toBe(paintColorAt(100, layout.tile.height - 100, sample({ frame: split })));
  });

  it('moves with the flow as the shader does: the phase changes where a point falls on the frame', () => {
    const ramp = frame(64, 192, (x, y) => (x * 3 + y) % 256);
    const still = paintColorAt(500, 400, sample({ frame: ramp }));
    const flowing = paintColorAt(500, 400, sample({ frame: ramp, layout: { ...layout, phase: 0.3, flow: 0.03 } }));
    const [u0, v0] = frameUv(500, 400, layout);
    const [u1, v1] = frameUv(500, 400, { ...layout, phase: 0.3, flow: 0.03 });
    expect(Math.hypot(u1 - u0, v1 - v0)).toBeGreaterThan(0.001);
    expect(flowing).not.toBe(still);
  });
});
