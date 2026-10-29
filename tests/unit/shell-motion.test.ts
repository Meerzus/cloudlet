import { describe, expect, it, vi } from 'vitest';
import { createShellMotion, MOTION, resolveMotion } from '../../packages/toast/src/react/motion.js';
import type { ShellFrame } from '../../packages/toast/src/react/motion.js';

function harness(options: { reducedMotion?: boolean; timeScale?: number; constants?: ReturnType<typeof resolveMotion> } = {}) {
  let time = 0;
  let id = 0;
  const pending = new Map<number, (time: number) => void>();
  const frames: ShellFrame[] = [];
  const motion = createShellMotion({
    now: () => time,
    requestFrame: callback => { pending.set(++id, callback); return id; },
    cancelFrame: frame => { pending.delete(frame); },
    write: frame => frames.push(frame),
    ...options,
  });
  const step = (delta: number) => {
    time += delta;
    const callbacks = [...pending.values()];
    pending.clear();
    for (const callback of callbacks) callback(time);
  };
  /** Advances in 16 ms frames until nothing is scheduled. */
  const settle = (limit = 5000) => { for (let spent = 0; pending.size && spent < limit; spent += 16) step(16); };
  const last = () => frames[frames.length - 1]!;
  return { motion, frames, pending, step, settle, last };
}

const pill = { width: 220, height: 44, radius: 22 };
const island = { width: 416, height: 120, radius: 24 };

describe('host shell sampler', () => {
  it('never writes before the first measurement and jumps to it', () => {
    const { motion, frames, step } = harness();
    motion.setHover(true);
    motion.swap('header');
    step(100);
    expect(frames).toHaveLength(0);
    motion.setShape(pill, 'close');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject(pill);
  });

  it('retargets the shape from its current value and velocity, then stops the frame loop', () => {
    const { motion, step, last, pending, settle } = harness();
    motion.setShape(pill, 'instant');
    motion.setShape(island, 'open');
    step(64);
    const moving = last();
    expect(moving.width).toBeGreaterThan(pill.width);
    expect(moving.width).toBeLessThan(island.width);
    motion.setShape(pill, 'close');
    expect(last().width).toBe(moving.width);
    // Reversing keeps the forward momentum for a moment instead of resetting speed.
    step(1);
    expect(last().width).toBeGreaterThan(moving.width);
    settle();
    expect(last()).toMatchObject(pill);
    expect(pending.size).toBe(0);
  });

  it('opens slower than it collapses and adjusts (DESIGN §7: shapeOpen is the softer spring)', () => {
    const open = harness();
    const close = harness();
    open.motion.setShape(pill, 'instant'); open.motion.setShape(island, 'open');
    close.motion.setShape(pill, 'instant'); close.motion.setShape(island, 'close');
    open.step(80); close.step(80);
    expect(open.last().width).toBeLessThan(close.last().width);
    // The relationship, not the numbers: the values themselves are the owner's (D47) and live only in MOTION.
    expect(MOTION.shapeOpen.stiffness / MOTION.shapeOpen.mass).toBeLessThan(MOTION.shapeClose.stiffness / MOTION.shapeClose.mass);
  });

  it('does not restart identical targets or keep an idle loop', () => {
    const one = harness();
    const two = harness();
    for (const test of [one, two]) { test.motion.setShape(pill, 'instant'); test.motion.setShape(island, 'open'); test.step(40); }
    one.motion.setShape(island, 'open');
    one.step(40); two.step(40);
    expect(one.last().width).toBe(two.last().width);
    one.settle();
    const count = one.frames.length;
    one.motion.setShape(island, 'open');
    one.step(1000);
    expect(one.frames).toHaveLength(count + 1);
    expect(one.pending.size).toBe(0);
  });

  it('enters from the edge and leaves through the exit layer from the current presence', () => {
    const { motion, step, last, settle } = harness();
    const entered = vi.fn();
    motion.setShape(pill, 'instant');
    motion.enter(-1, entered);
    expect(last()).toMatchObject({ opacity: 0, scale: MOTION.enter.scale, y: -MOTION.enter.offset });
    step(100);
    const partial = last();
    expect(partial.opacity).toBeGreaterThan(0);
    const exited = vi.fn();
    motion.exit(-1, exited);
    expect(last()).toMatchObject({ exitOpacity: partial.opacity, exitScale: partial.scale, exitY: partial.y });
    settle();
    expect(last()).toMatchObject({ opacity: 1, scale: 1, y: 0, exitOpacity: 0, exitScale: MOTION.enter.scale, exitY: -MOTION.enter.offset });
    expect(entered).toHaveBeenCalledOnce();
    expect(exited).toHaveBeenCalledOnce();
  });

  it('rises the first tail into the pill place with the entrance spring', () => {
    const { motion, last, settle } = harness();
    motion.setShape(pill, 'instant');
    motion.rise(7, 0.95);
    expect(last()).toMatchObject({ y: 7, scale: 0.95 });
    settle();
    expect(last()).toMatchObject({ y: 0, scale: 1, opacity: 1 });
  });

  it('shifts tails back on arrival and up on rise, fading the ones beyond the depth', () => {
    const { motion, last, settle, step } = harness();
    motion.setShape(pill, 'instant');
    motion.setTails(2, 'arrival', 1);
    expect(last()).toMatchObject({ tail1: 0, tail1Opacity: 1, tail2: 1, tail2Opacity: 1 });
    settle();
    expect(last()).toMatchObject({ tail1: 1, tail2: 2, tail1Opacity: 1, tail2Opacity: 1 });
    const done = vi.fn();
    motion.setTails(1, 'rise', 2, done);
    expect(last()).toMatchObject({ tail1: 2, tail1Opacity: 1, tail2Opacity: 0 });
    step(16);
    expect(done).not.toHaveBeenCalled();
    settle();
    expect(last()).toMatchObject({ tail1: 1, tail2Opacity: 0 });
    expect(done).toHaveBeenCalledOnce();
  });

  it('retracts tails and badge in 150 ms and shows the chrome after a 100 ms delay when opening', () => {
    const { motion, step, last, settle } = harness();
    motion.setShape(pill, 'instant');
    motion.setTails(2, 'settle', 0);
    motion.setBadge(true);
    settle();
    motion.setShape(island, 'open');
    motion.open();
    step(96);
    expect(last().chrome).toBe(0);
    step(64);
    expect(last().tail1Opacity).toBe(0);
    expect(last().badge).toBe(0);
    expect(last().chrome).toBeGreaterThan(0);
    settle();
    expect(last()).toMatchObject({ chrome: 1, tail1: 0, tail2: 0 });
  });

  it('fades the chrome snapshot in 70 ms and brings tails back during the last 150 ms of collapsing', () => {
    const { motion, step, last, settle } = harness();
    motion.setShape(island, 'instant');
    motion.open();
    settle();
    const chrome = vi.fn();
    const tails = vi.fn();
    motion.setShape(pill, 'close');
    motion.collapse(2, true, { chrome, tails });
    expect(last()).toMatchObject({ chrome: 0, chromeOut: 1, tail1Opacity: 0 });
    step(80);
    expect(last().chromeOut).toBe(0);
    expect(chrome).toHaveBeenCalledOnce();
    // The shape is still far from the pill: tails have not started yet.
    expect(last().tail1Opacity).toBe(0);
    expect(last().width).toBeGreaterThan(pill.width + 10);
    settle();
    expect(last()).toMatchObject({ ...pill, tail1: 1, tail2: 2, tail1Opacity: 1, badge: 1 });
    expect(tails).toHaveBeenCalledOnce();
  });

  it('keeps one outgoing snapshot per layer: a new swap continues from the live look and only its completion runs', () => {
    const { motion, step, last, settle, pending } = harness();
    const stale = vi.fn();
    const current = vi.fn();
    motion.setShape(pill, 'instant');
    motion.swap('header', stale);
    expect(last()).toMatchObject({ headerOut: 1, headerIn: 0 });
    step(96);
    const live = last().headerIn;
    expect(live).toBeGreaterThan(0);
    motion.swap('header', current);
    expect(last()).toMatchObject({ headerOut: live, headerIn: 0 });
    step(MOTION.headerOut);
    expect(last().headerOut).toBe(0);
    settle();
    expect(last()).toMatchObject({ headerIn: 1, headerOut: 0 });
    expect(stale).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledOnce();
    expect(pending.size).toBe(0);
  });

  it('starts an incoming-only blur when the outgoing header leaves with another layer', () => {
    const { motion, last } = harness();
    motion.setShape(pill, 'instant');
    motion.swap('header', undefined, true);
    expect(last()).toMatchObject({ headerOut: 0, headerIn: 0 });
  });

  it('slides the strip continuously when a slide interrupts a slide', () => {
    const { motion, step, last, settle } = harness();
    const first = vi.fn();
    const second = vi.fn();
    motion.setShape(island, 'instant');
    motion.slide(1, 416, first);
    expect(last()).toMatchObject({ slide: 416, slideDirection: 1, slideWidth: 416 });
    step(64);
    const position = last().slide;
    expect(position).toBeGreaterThan(0);
    expect(position).toBeLessThan(416);
    motion.slide(1, 416, second);
    // The live slide becomes the snapshot where it was; the new one follows one width behind.
    expect(last().slide - last().slideDirection * last().slideWidth).toBeCloseTo(position, 6);
    step(1);
    expect(last().slide).toBeLessThan(position + 416);
    settle();
    expect(last().slide).toBe(0);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('moves the shared heading back to its new layout position (FLIP) without scaling it', () => {
    const { motion, step, last, settle } = harness();
    motion.setShape(pill, 'instant');
    motion.shiftHeading(90, -4, 'open');
    expect(last()).toMatchObject({ headX: 90, headY: -4 });
    step(64);
    expect(last().headX).toBeGreaterThan(0);
    expect(last().headX).toBeLessThan(90);
    settle();
    expect(last()).toMatchObject({ headX: 0, headY: 0 });
  });

  it('applies timeScale to every channel and keeps values continuous when it changes', () => {
    const full = harness();
    const slow = harness({ timeScale: 0.5 });
    for (const test of [full, slow]) { test.motion.setShape(pill, 'instant'); test.motion.swap('header'); test.motion.setShape(island, 'open'); }
    full.step(64); slow.step(128);
    expect(slow.last().width).toBeCloseTo(full.last().width, 6);
    expect(slow.last().headerIn).toBeCloseTo(full.last().headerIn, 6);
    const before = slow.last().width;
    slow.motion.setTimeScale(0.1);
    slow.step(1);
    expect(Math.abs(slow.last().width - before)).toBeLessThan(1);
    slow.motion.setTimeScale(Number.NaN);
    slow.settle();
    expect(slow.last()).toMatchObject(island);
  });

  it('starts reduced: geometry jumps and every transition is an 80 ms opacity change', () => {
    const { motion, step, last, settle } = harness({ reducedMotion: true });
    const entered = vi.fn();
    motion.setShape(pill, 'instant');
    motion.enter(-1, entered);
    expect(last()).toMatchObject({ scale: 1, y: 0, opacity: 0, reduced: true });
    motion.setShape(island, 'open');
    expect(last()).toMatchObject(island);
    motion.slide(1, 416);
    expect(last()).toMatchObject({ slide: 0, slideIn: 0, slideOut: 1 });
    step(48);
    expect(entered).not.toHaveBeenCalled();
    step(48);
    expect(last()).toMatchObject({ opacity: 1, slideIn: 1, slideOut: 0 });
    expect(entered).toHaveBeenCalledOnce();
    motion.shiftHeading(80, 0, 'open');
    expect(last().headX).toBe(0);
    settle();
  });

  it('stops spatial motion at once when the preference changes on the fly', () => {
    const { motion, step, last, settle, pending } = harness();
    const done = vi.fn();
    motion.setShape(pill, 'instant');
    motion.setShape(island, 'open');
    motion.slide(1, 416, done);
    motion.swap('body');
    step(40);
    expect(last().width).toBeLessThan(island.width);
    motion.setReducedMotion(true);
    expect(last()).toMatchObject({ ...island, slide: 0 });
    step(MOTION.reduced);
    expect(last()).toMatchObject({ bodyIn: 1, bodyOut: 0 });
    expect(done).toHaveBeenCalledOnce();
    expect(pending.size).toBe(0);
    motion.setReducedMotion(false);
    settle();
    expect(last()).toMatchObject(island);
  });

  it('tweens progress and jumps for a new bar', () => {
    const { motion, step, last, settle } = harness();
    motion.setShape(island, 'instant');
    motion.setProgress(0.1, true);
    expect(last().progress).toBe(0.1);
    motion.setProgress(0.75, false);
    step(MOTION.progress / 2);
    expect(last().progress).toBeGreaterThan(0.1);
    expect(last().progress).toBeLessThan(0.75);
    settle();
    expect(last().progress).toBe(0.75);
  });

  it('disposal cancels the scheduled frame, callbacks and every later write', () => {
    const { motion, step, frames, pending } = harness();
    const done = vi.fn();
    motion.setShape(pill, 'instant');
    motion.enter(-1, done);
    motion.swap('header', done);
    expect(motion.running).toBe(true);
    const count = frames.length;
    motion.dispose(); motion.dispose();
    motion.setShape(island, 'open'); motion.enter(-1); motion.exit(-1); motion.slide(1, 10); motion.open(); motion.collapse(1, true);
    motion.setReducedMotion(true); motion.setTimeScale(2);
    step(1000);
    expect(pending.size).toBe(0);
    expect(motion.running).toBe(false);
    expect(frames).toHaveLength(count);
    expect(done).not.toHaveBeenCalled();
  });

  it('resolves debugging overrides field by field and keeps defaults for invalid values', () => {
    expect(resolveMotion(undefined)).toBe(resolveMotion(undefined));
    const resolved = resolveMotion({
      enter: { duration: 600 }, shapeOpen: { stiffness: 0, damping: 10 }, slide: { mass: Number.NaN },
      blur: 12, headerIn: -1, bodyOffset: 0,
      // @ts-expect-error Unknown keys and the swipe thresholds are not tunable here.
      swipe: { intent: 1 }, unknown: 3,
    });
    expect(resolved.enter).toEqual({ ...MOTION.enter, duration: 600 });
    expect(resolved.shapeOpen).toEqual({ ...MOTION.shapeOpen, damping: 10 });
    expect(resolved.slide).toEqual(MOTION.slide);
    expect(resolved).toMatchObject({ blur: 12, headerIn: MOTION.headerIn, bodyOffset: 0 });
    expect(resolved).not.toHaveProperty('swipe');
    expect(resolved).not.toHaveProperty('unknown');
  });

  it('applies new constants to transitions started after the change, not to running ones', () => {
    const fast = resolveMotion({ headerIn: 40, headerOut: 40 });
    const { motion, step, last } = harness();
    motion.setShape(pill, 'instant');
    motion.swap('header');
    motion.setConstants(fast);
    expect(motion.constants).toBe(fast);
    step(64);
    // Started with the default 260 ms: still running.
    expect(last().headerIn).toBeLessThan(1);
    step(MOTION.headerIn);
    motion.swap('header');
    step(48);
    expect(last().headerIn).toBe(1);
    const tuned = harness({ constants: resolveMotion({ shapeOpen: { stiffness: 2000, damping: 90 } }) });
    const plain = harness();
    for (const test of [tuned, plain]) { test.motion.setShape(pill, 'instant'); test.motion.setShape(island, 'open'); test.step(48); }
    expect(tuned.last().width).toBeGreaterThan(plain.last().width);
  });
});
