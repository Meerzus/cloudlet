import { describe, expect, it, vi } from 'vitest';
import { keyframes as motionKeyframes, spring as motionSpring } from 'motion';
import { MOTION } from '../../packages/toast/src/react/motion.js';
import { spring, tween } from '../../packages/toast/src/react/generators.js';
import type { Generator, SpringOptions } from '../../packages/toast/src/react/generators.js';

/**
 * E1: Cloudlet's own generators must reproduce Motion 14.3.0 frame
 * for frame, because the values of MOTION were accepted by the owner on the laboratory running
 * Motion. Both implementations are sampled every millisecond until they stop: the values
 * and velocities agree to 1e-9 and `done` flips on the same frame. `motion` stays a
 * devDependency of the workspace, pinned to the version the port was taken from, for this test.
 */

const TOLERANCE = 1e-9;
/** A perpetual oscillation (damping 0) never stops: both implementations are compared up to here. */
const LIMIT_MS = 20_000;

type MotionGenerator = { next: (t: number) => { value: number; done: boolean }; velocity?: (t: number) => number };

interface Pair { readonly own: Generator; readonly reference: MotionGenerator; readonly label: string }

function compare({ own, reference, label }: Pair): { doneAt: number | null } {
  let doneAt: number | null = null;
  for (let t = 0; t <= LIMIT_MS; t += 1) {
    const expected = reference.next(t);
    const actual = own.next(t);
    if (Math.abs(actual.value - expected.value) >= TOLERANCE || actual.done !== expected.done) {
      throw new Error(`${label}: at ${t} ms own ${actual.value} (${actual.done}) vs motion ${expected.value} (${expected.done})`);
    }
    if (reference.velocity) {
      const expectedVelocity = reference.velocity(t);
      const actualVelocity = own.velocity!(t);
      if (Math.abs(actualVelocity - expectedVelocity) >= TOLERANCE) {
        throw new Error(`${label}: velocity at ${t} ms own ${actualVelocity} vs motion ${expectedVelocity}`);
      }
    } else {
      expect(own.velocity, label).toBeUndefined();
    }
    if (expected.done) { doneAt = t; break; }
  }
  return { doneAt };
}

const springPair = (options: SpringOptions, label: string): Pair => {
  const { from, to, ...spec } = options;
  // Motion's option types are optional without `undefined`; pass only the fields the case sets.
  const defined = Object.fromEntries(Object.entries(spec).filter(([, value]) => value !== undefined));
  return {
    own: spring(options),
    reference: motionSpring({ keyframes: [from, to], ...defined }) as MotionGenerator,
    label,
  };
};
const tweenPair = (from: number, to: number, duration: number, label: string): Pair => ({
  own: tween(from, to, duration),
  reference: motionKeyframes({ keyframes: [from, to], duration, ease: 'easeOut' }) as MotionGenerator,
  label,
});

/** Initial speeds in units/s as `createShellMotion` passes them: at rest, a normal swipe, a very fast one. */
const velocities = { rest: 0, swipe: 600, flick: 5000, reverse: -1200 };
/** Ranges the channels actually travel: granular (|Δ| < 5) and default rest thresholds. */
const physicsRanges = [
  { from: 220, to: 416 }, // width pill → Island
  { from: 416, to: 220 },
  { from: 44, to: 120 }, // height
  { from: 22, to: 24 }, // radius (granular)
  { from: 300, to: 0 }, // slide one width
  { from: -150, to: 0 }, // released drag
  { from: 0.6, to: 0 }, // heading shift (granular)
  { from: 7, to: 7 }, // retarget onto the current value with velocity
];
const timedRanges = [
  { from: 0.25, to: 1 }, // enter scale
  { from: -1, to: 0 }, // enter y from the top edge
  { from: 1, to: 0 }, // exit opacity
  { from: 1, to: 0.25 }, // exit scale
  { from: 0, to: 1 }, // badge
  { from: 0, to: 2 }, // tail slot
  { from: 7, to: 0 }, // rise offset (not granular)
  { from: 1, to: 1 },
];

describe('generators reference (Motion 14.3.0)', () => {
  const physics = { shapeOpen: MOTION.shapeOpen, shapeClose: MOTION.shapeClose, slide: MOTION.slide };
  for (const [name, spec] of Object.entries(physics)) {
    it(`MOTION.${name} physics spring matches for every range and release velocity`, () => {
      for (const range of physicsRanges) {
        for (const [speed, velocity] of Object.entries(velocities)) {
          const { doneAt } = compare(springPair({ ...range, velocity, ...spec }, `${name} ${range.from}→${range.to} @${speed}`));
          expect(doneAt, `${name} ${range.from}→${range.to} @${speed} must settle`).not.toBeNull();
        }
      }
    });
  }

  const timed = { enter: MOTION.enter, exit: MOTION.exit, badge: MOTION.badge };
  for (const [name, { duration, bounce }] of Object.entries(timed)) {
    it(`MOTION.${name} duration/bounce spring matches and ignores the inherited velocity`, () => {
      for (const range of timedRanges) {
        for (const [speed, velocity] of Object.entries(velocities)) {
          const { doneAt } = compare(springPair({ ...range, velocity, duration, bounce }, `${name} ${range.from}→${range.to} @${speed}`));
          expect(doneAt).toBe(duration);
        }
      }
    });
  }

  it('matches every tween duration of MOTION with easeOut and the same done frame', () => {
    const durations = {
      fade: MOTION.enter.fade, tails: MOTION.tails, chromeIn: MOTION.chromeIn, chromeOut: MOTION.chromeOut,
      headerOut: MOTION.headerOut, headerIn: MOTION.headerIn, bodyOut: MOTION.bodyOut, bodyIn: MOTION.bodyIn,
      countSwap: MOTION.countSwap, progress: MOTION.progress, hover: MOTION.hover, reduced: MOTION.reduced,
    };
    const ranges = [[0, 1], [1, 0], [0.3, 0.7], [0, 100], [37, 42], [2, 1], [0.5, 0.5]] as const;
    for (const [name, duration] of Object.entries(durations)) {
      for (const [from, to] of ranges) {
        const { doneAt } = compare(tweenPair(from, to, duration, `tween ${name} ${from}→${to}`));
        expect(doneAt).toBe(duration);
      }
    }
  });

  it('matches boundary overrides: clamped durations, extreme bounces, overdamped and critical physics', () => {
    // Motion warns about durations above 10 s; the clamp itself is what this case compares.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const boundaries: [SpringOptions, string][] = [
      [{ from: 0, to: 1, duration: 1, bounce: 0 }, 'duration below the 10 ms floor'],
      [{ from: 0, to: 100, duration: 10, bounce: 0.25 }, 'duration at the floor'],
      [{ from: 0, to: 100, duration: 10_000, bounce: 0 }, 'duration at the 10 s ceiling'],
      [{ from: 0, to: 100, duration: 20_000, bounce: 0.3 }, 'duration above the ceiling'],
      [{ from: 0, to: 100, duration: 400, bounce: -0.5 }, 'negative bounce (overdamped, exact curve)'],
      [{ from: 0, to: 100, duration: 400, bounce: -1 }, 'bounce −1 (min damping clamp)'],
      [{ from: 0, to: 100, duration: 400, bounce: 0.99 }, 'bounce near 1'],
      [{ from: 0, to: 100, duration: 400, bounce: 1 }, 'bounce 1 (min damping clamp)'],
      [{ from: 0, to: 1, duration: 300 }, 'duration only (default bounce)'],
      [{ from: 0, to: 1, bounce: 0.5 }, 'bounce only (default duration)'],
      [{ from: 0, to: 100, velocity: 600, stiffness: 100, damping: 20, mass: 1 }, 'critically damped physics'],
      [{ from: 0, to: 3, velocity: 600, stiffness: 100, damping: 20, mass: 1 }, 'critically damped granular'],
      [{ from: 0, to: 100, velocity: 600, stiffness: 5000, damping: 1000, mass: 0.1 }, 'heavily overdamped (settle limit)'],
      [{ from: 0, to: 100, velocity: -5000, stiffness: 1200, damping: 400, mass: 1 }, 'overdamped against the velocity'],
      [{ from: 0, to: 100, velocity: 5000, stiffness: 30, damping: 3, mass: 1 }, 'very soft spring'],
      [{ from: 0, to: 100, velocity: 0, stiffness: 900, damping: 60, mass: 2 }, 'shapeOpen defaults'],
      [{ from: 100, to: 100, velocity: 5000, stiffness: 1200, damping: 60, mass: 1 }, 'kick without displacement'],
    ];
    for (const [options, label] of boundaries) {
      const { doneAt } = compare(springPair(options, label));
      expect(doneAt, label).not.toBeNull();
    }
  });

  it('matches a perpetual oscillation up to the sampling limit without either side reporting done', () => {
    const { doneAt } = compare(springPair({ from: 0, to: 100, velocity: 0, stiffness: 400, damping: 0, mass: 1 }, 'undamped'));
    expect(doneAt).toBeNull();
  });

  it('matches a zero-length and a zero-range tween', () => {
    expect(compare(tweenPair(0, 1, 0, 'tween 0 ms')).doneAt).toBe(0);
    expect(compare(tweenPair(5, 5, 200, 'tween flat')).doneAt).toBe(200);
  });

  it('agrees with Motion on the retarget chain: a spring started from the previous velocity() lands on the same frames', () => {
    // The shell samples velocity() mid-flight and seeds the next spring with it; both sides do the same hand-over.
    const first = springPair({ from: 220, to: 416, velocity: 0, ...MOTION.shapeOpen }, 'chain first');
    const cut = 64;
    const ownState = first.own.next(cut);
    const referenceState = first.reference.next(cut);
    const ownVelocity = first.own.velocity!(cut);
    const referenceVelocity = first.reference.velocity!(cut);
    expect(Math.abs(ownState.value - referenceState.value)).toBeLessThan(TOLERANCE);
    expect(Math.abs(ownVelocity - referenceVelocity)).toBeLessThan(TOLERANCE);
    const second: Pair = {
      own: spring({ from: ownState.value, to: 220, velocity: ownVelocity, ...MOTION.shapeClose }),
      reference: motionSpring({ keyframes: [referenceState.value, 220], velocity: referenceVelocity, ...MOTION.shapeClose }) as MotionGenerator,
      label: 'chain second',
    };
    expect(compare(second).doneAt).not.toBeNull();
  });
});
