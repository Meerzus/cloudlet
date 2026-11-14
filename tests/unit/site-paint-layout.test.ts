import { describe, expect, it } from 'vitest';
import { calmAt, calmMap } from '../../apps/site/src/lib/paint-calm';
import { FLOW, frameUv, MIN_SCREENS, mirror, noise, tileSize, warp } from '../../apps/site/src/lib/paint-layout';

const ASPECT = 1280 / 3840;
const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };

describe('the long frame on the page (COLOR_PICKER §8.2)', () => {
  it('spans the window on a desktop and is at least 2.5 screens long on a phone, cropped at the sides', () => {
    const wide = tileSize(desktop, ASPECT);
    expect(wide.width).toBeCloseTo(1440);
    expect(wide.height).toBeCloseTo(4320);
    const tall = tileSize(phone, ASPECT);
    expect(tall.height).toBeCloseTo(phone.height * MIN_SCREENS);
    expect(tall.width).toBeGreaterThan(phone.width);
    expect(tall.width / tall.height).toBeCloseTo(ASPECT);
  });

  it('mirrors every further copy, so each seam meets its own edge', () => {
    expect(mirror(0.25)).toBeCloseTo(0.25);
    expect(mirror(1.25)).toBeCloseTo(0.75);
    expect(mirror(2.25)).toBeCloseTo(0.25);
    expect(mirror(-0.25)).toBeCloseTo(0.25);
    for (const seam of [1, 2, 3]) expect(mirror(seam - 1e-6)).toBeCloseTo(mirror(seam + 1e-6), 5);
  });

  it('lays the first screens as they are and warps the frame only further down', () => {
    expect(warp(0.3, 0.2)).toEqual([0.3, 0.2]);
    expect(warp(0.3, 0.55)).toEqual([0.3, 0.55]);
    const [u, v] = warp(0.3, 2.5);
    expect(Math.hypot(u - 0.3, v - 2.5)).toBeGreaterThan(0);
  });

  it('the warp is continuous and never folds the frame back on itself', () => {
    const step = 0.001;
    let previous = warp(0.5, 0);
    for (let v = step; v < 8; v += step) {
      const next = warp(0.5, v);
      expect(next[1], `v ${v.toFixed(3)}`).toBeGreaterThan(previous[1]);
      expect(Math.abs(next[0] - previous[0]), `u at ${v.toFixed(3)}`).toBeLessThan(0.01);
      expect(next[1] - previous[1], `v at ${v.toFixed(3)}`).toBeLessThan(0.01);
      previous = next;
    }
  });

  it('a step down the page moves little in the frame, across seams too', () => {
    const tile = tileSize(desktop, ASPECT);
    const layout = { width: desktop.width, tile, phase: 0.3, flow: FLOW };
    for (let y = 0; y < tile.height * 4; y += 7) {
      for (const x of [0, 360, 720, 1439]) {
        const [u0, v0] = frameUv(x, y, layout);
        const [u1, v1] = frameUv(x, y + 2, layout);
        expect(Math.hypot(u1 - u0, v1 - v0), `${x}, ${y}`).toBeLessThan(0.005);
        expect(u0).toBeGreaterThanOrEqual(0);
        expect(u0).toBeLessThanOrEqual(1);
        expect(v0).toBeGreaterThanOrEqual(0);
        expect(v0).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the top of the page is the top of the frame, centred, and the flow moves it a few percent at most', () => {
    const tile = tileSize(desktop, ASPECT);
    const still = frameUv(720, 0, { width: desktop.width, tile, phase: 0, flow: 0 });
    expect(still[0]).toBeCloseTo(0.5);
    expect(still[1]).toBeCloseTo(0);
    for (const phase of [0, 0.25, 0.5, 0.75]) {
      const [u, v] = frameUv(720, 600, { width: desktop.width, tile, phase, flow: FLOW });
      const [su, sv] = frameUv(720, 600, { width: desktop.width, tile, phase, flow: 0 });
      expect(Math.hypot(u - su, v - sv)).toBeLessThanOrEqual(FLOW * 2 * Math.SQRT2);
    }
    // The flow's cycle closes on itself.
    expect(frameUv(300, 900, { width: desktop.width, tile, phase: 0, flow: FLOW })[0]).toBeCloseTo(frameUv(300, 900, { width: desktop.width, tile, phase: 1, flow: FLOW })[0], 6);
  });

  it('the noise is smooth and stays in [0, 1]', () => {
    for (let x = -3; x < 3; x += 0.137) {
      for (let y = -3; y < 3; y += 0.173) {
        const value = noise(x, y);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
        expect(Math.abs(noise(x + 0.001, y) - value)).toBeLessThan(0.01);
      }
    }
  });
});

describe('the paper under the copy (COLOR_PICKER §8.2)', () => {
  const lines = [
    { x: 100, y: 400, width: 600, height: 40 },
    { x: 100, y: 450, width: 420, height: 40 },
  ];

  it('lifts the paper fully under a line and around it, then fades out within about 150 px', () => {
    const map = calmMap(lines, 1440, 3000);
    expect(calmAt(map, 300, 420)).toBe(1);
    expect(calmAt(map, 100, 470)).toBe(1);
    // The far end of the long line, with no line under it, is still at full lift (it was at 0.75 with a 32 px reach).
    expect(calmAt(map, 695, 405)).toBe(1);
    expect(calmAt(map, 695, 435)).toBe(1);
    // Past the line's end the paper falls off softly…
    const edge = [700, 740, 780, 820, 860].map((x) => calmAt(map, x, 420));
    for (let index = 1; index < edge.length; index += 1) expect(edge[index]!).toBeLessThanOrEqual(edge[index - 1]!);
    expect(edge[1]!).toBeGreaterThan(0.3);
    // …is all but gone a little over 150 px away, and gone past the blur's reach.
    expect(calmAt(map, 300, 400 - 206)).toBeLessThan(0.05);
    expect(calmAt(map, 300, 400 - 240)).toBe(0);
    expect(calmAt(map, 1200, 2000)).toBe(0);
  });

  it('follows lines, not blocks: a short last line leaves the paint beside it', () => {
    const map = calmMap(lines, 1440, 3000);
    expect(calmAt(map, 690, 470)).toBeGreaterThan(calmAt(map, 690, 520));
    expect(calmAt(map, 1000, 470)).toBe(0);
  });

  it('takes coarser texels on a very long page, so the texture stays within 4096 rows', () => {
    const map = calmMap(lines, 1440, 40_000);
    expect(map.height).toBeLessThanOrEqual(4096);
    expect(map.scale).toBeGreaterThan(6);
    expect(map.data).toHaveLength(map.width * map.height);
    expect(calmAt(map, 300, 420)).toBe(1);
  });
});
