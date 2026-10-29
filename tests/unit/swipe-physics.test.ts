import { describe, expect, it } from 'vitest';
import { decideRelease, rubberBand } from '../../packages/toast/src/react/gestures.js';
import { createShellMotion, MOTION } from '../../packages/toast/src/react/motion.js';
import type { ShellFrame } from '../../packages/toast/src/react/motion.js';

const both = { negative: true, positive: true };

describe('swipe release decision', () => {
  it('commits past 30% of the swiped dimension in either direction', () => {
    expect(MOTION.swipe.distance).toBe(0.3);
    expect(decideRelease(121, 0, 400, both)).toBe(1);
    expect(decideRelease(-121, 0, 400, both)).toBe(-1);
    expect(decideRelease(120, 0, 400, both)).toBe(0);
    expect(decideRelease(-119, 0, 400, both)).toBe(0);
  });

  it('commits a flick of at least 24 px faster than 0.5 px/ms towards the travel', () => {
    expect(decideRelease(24, 0.51, 400, both)).toBe(1);
    expect(decideRelease(-24, -0.51, 400, both)).toBe(-1);
    expect(decideRelease(23.9, 3, 400, both)).toBe(0);
    expect(decideRelease(40, 0.5, 400, both)).toBe(0);
    // Velocity away from the travel is never a flick towards it.
    expect(decideRelease(40, -3, 400, both)).toBe(0);
  });

  it('cancels a long swipe flicked back and never commits without a destination', () => {
    expect(decideRelease(300, -0.6, 400, both)).toBe(0);
    expect(decideRelease(300, -0.4, 400, both)).toBe(1);
    expect(decideRelease(-300, 0, 400, { negative: false, positive: true })).toBe(0);
    expect(decideRelease(300, 2, 400, { negative: true, positive: false })).toBe(0);
    expect(decideRelease(0, 5, 400, both)).toBe(0);
  });

  it('treats invalid velocity and dimension conservatively', () => {
    expect(decideRelease(100, Number.NaN, 400, both)).toBe(0);
    expect(decideRelease(30, Number.POSITIVE_INFINITY, 0, both)).toBe(0);
    expect(decideRelease(30, 1, 0, both)).toBe(1);
  });
});

describe('rubber band', () => {
  it('keeps the sign, resists progressively and never reaches the dimension', () => {
    expect(rubberBand(0, 400)).toBe(0);
    const small = rubberBand(40, 400);
    const large = rubberBand(400, 400);
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(40);
    expect(rubberBand(-40, 400)).toBeCloseTo(-small, 10);
    expect(large / 400).toBeLessThan(small / 40);
    expect(rubberBand(1e9, 400)).toBeLessThan(400);
    // iOS coefficient: 100 px of travel on 400 px moves (1 - 1 / 1.1375) × 400.
    expect(rubberBand(100, 400)).toBeCloseTo((1 - 1 / 1.1375) * 400, 6);
  });

  it('returns zero for invalid input', () => {
    expect(rubberBand(Number.NaN, 400)).toBe(0);
    expect(rubberBand(50, 0)).toBe(0);
    expect(rubberBand(50, -1)).toBe(0);
  });
});

function harness() {
  let time = 0;
  const frames: ShellFrame[] = [];
  const callbacks: ((time: number) => void)[] = [];
  const motion = createShellMotion({
    now: () => time,
    requestFrame: callback => callbacks.push(callback),
    cancelFrame: () => {},
    write: frame => frames.push(frame),
  });
  motion.setShape({ width: 320, height: 44, radius: 22 }, 'instant');
  const step = (ms: number) => {
    time += ms;
    for (const callback of callbacks.splice(0)) callback(time);
  };
  const run = (ms: number) => { for (let elapsed = 0; elapsed < ms; elapsed += 16) step(16); };
  return { motion, frames, step, run, last: () => frames.at(-1)! };
}

describe('drag channels', () => {
  it('follows the finger without a spring and springs home with the release velocity', () => {
    const { motion, step, run, last } = harness();
    motion.drag('dragX', 80);
    expect(last().dragX).toBe(80);
    expect(motion.running).toBe(false);
    let done = 0;
    motion.release('dragX', 0, () => { done += 1; });
    step(16);
    const still = last().dragX;
    const flicked = harness();
    flicked.motion.drag('dragX', 80);
    flicked.motion.release('dragX', 2000);
    flicked.step(16);
    // Release velocity carries on: a flick outwards keeps moving before returning.
    expect(flicked.last().dragX).toBeGreaterThan(still);
    run(2000);
    expect(last().dragX).toBe(0);
    expect(done).toBe(1);
    expect(motion.running).toBe(false);
  });

  it('continues a committed navigation slide from the finger offset and velocity', () => {
    const { motion, step, run, last } = harness();
    motion.drag('slide', -150);
    motion.fling('slide', -1500);
    motion.slide(1, 400);
    // The live slide takes the neighbour's place: one width further along the strip.
    expect(last().slide).toBe(250);
    step(16);
    const fast = 250 - last().slide;
    const calm = harness();
    calm.motion.drag('slide', -150);
    calm.motion.slide(1, 400);
    calm.step(16);
    expect(fast).toBeGreaterThan(250 - calm.last().slide);
    run(2000);
    expect(last().slide).toBe(0);
  });

  it('flings the dismissed pill sideways from the finger and returns the live shell to the centre', () => {
    const { motion, run, last, frames } = harness();
    motion.drag('dragX', -90);
    let done = 0;
    motion.exit(-1, () => { done += 1; }, { direction: -1, distance: 320, velocity: -1200 });
    expect(last().exitX).toBe(-90);
    expect(last().dragX).toBe(0);
    run(2000);
    expect(last().exitX).toBe(-320);
    expect(last().exitOpacity).toBe(0);
    expect(last().exitY).toBe(0);
    expect(Math.min(...frames.map(frame => frame.exitX))).toBeLessThanOrEqual(-320);
    expect(done).toBe(1);
  });

  it('falls back to the edge for an ordinary exit and ignores drag under reduced motion', () => {
    const { motion, run, last } = harness();
    motion.exit(-1);
    run(2000);
    expect(last().exitX).toBe(0);
    expect(last().exitY).toBe(-MOTION.enter.offset);
    motion.setReducedMotion(true);
    motion.drag('dragY', 30);
    motion.release('dragY', 900);
    expect(last().dragY).toBe(0);
  });
});
