import { describe, expect, it } from 'vitest';
import { createRoundedRectPath } from '../../packages/toast/src/react/shape.js';

const numbers = (path: string) => path.match(/-?\d+(?:\.\d+)?/gu)!.map(Number);

describe('whole rounded-rect silhouette', () => {
  it('draws one closed rounded rectangle with four quarter-circle corners', () => {
    const path = createRoundedRectPath(200, 44, 10);
    expect(path.startsWith('M 10 0 L 190 0 C')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    expect(path.match(/C /gu)).toHaveLength(4);
    expect(path.match(/[MLCZ]/gu)!.join('')).toBe('MLCLCLCLCZ');
    const values = numbers(path);
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBe(200);
  });

  it('clamps a radius above half of the shorter side to a full pill', () => {
    expect(createRoundedRectPath(200, 44, 9999)).toBe(createRoundedRectPath(200, 44, 22));
    // Straight segments collapse to points but the topology stays the same.
    expect(createRoundedRectPath(200, 44, 22)).toContain('L 200 22 C');
    expect(createRoundedRectPath(40, 200, 9999)).toBe(createRoundedRectPath(40, 200, 20));
  });

  it('degrades zero, negative and non-finite input to an empty shape without NaN', () => {
    for (const path of [createRoundedRectPath(0, 0, 0), createRoundedRectPath(-5, 10, 4), createRoundedRectPath(Number.NaN, Infinity, Number.NaN)]) {
      expect(path).not.toMatch(/NaN|Infinity/u);
      expect(path.match(/[MLCZ]/gu)!.join('')).toBe('MLCLCLCLCZ');
    }
    expect(numbers(createRoundedRectPath(0, 0, 50)).every(value => value === 0)).toBe(true);
    expect(createRoundedRectPath(100, 40, -3)).toBe(createRoundedRectPath(100, 40, 0));
  });

  it('offsets the same shape for the HTML clip-path inside a wider layout box', () => {
    const local = numbers(createRoundedRectPath(100, 40, 12));
    const shifted = numbers(createRoundedRectPath(100, 40, 12, 30, 0));
    expect(shifted.filter((_, index) => index % 2 === 0)).toEqual(local.filter((_, index) => index % 2 === 0).map(x => Math.round((x + 30) * 1000) / 1000));
    expect(shifted.filter((_, index) => index % 2 === 1)).toEqual(local.filter((_, index) => index % 2 === 1));
    expect(createRoundedRectPath(100, 40, 12, Number.NaN)).toBe(createRoundedRectPath(100, 40, 12));
  });

  it('rounds coordinates to keep CSSOM strings short', () => {
    expect(numbers(createRoundedRectPath(100.123456, 40.98765, 7.77777)).every(value => Number.isInteger(value * 1000))).toBe(true);
  });
});
