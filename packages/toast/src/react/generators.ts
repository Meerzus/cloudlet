/**
 * Numeric animation generators for the shell sampler (motion.ts), ported from Motion 14.3.0
 * so that every frame matches what was tuned on the laboratory:
 *
 * - `spring` is the numeric part of motion-dom/dist/es/animation/generators/spring.mjs
 *   (physics-defined and duration/bounce-defined springs, `findSpring`, analytical velocity,
 *   granular rest thresholds, the overdamped settle limit);
 * - `tween` is the two-keyframe fast path of motion-dom's `keyframes` generator for numbers,
 *   with `easeOut` = `cubicBezier(0, 0, 0.58, 1)` from motion-utils 14.1.1.
 *
 * Motion is Copyright (c) 2024 Motion B.V., MIT (packages/toast/THIRD_PARTY_NOTICES.md).
 * Colour/string mixing, keyframe arrays and the rest of Motion are not needed here: Cloudlet
 * animates numbers only. tests/unit/generators-reference.test.ts samples both implementations
 * every millisecond against the installed Motion 14.3.0 (|Δ| < 1e-9, same `done` frame).
 * Expressions keep Motion's operation order on purpose: a re-association changes the last bits.
 */

export interface GeneratorState { value: number; done: boolean }
export interface Generator {
  /** `t` in generator milliseconds. Returns a mutable state object, like Motion's iterator. */
  readonly next: (t: number) => GeneratorState;
  /** Analytical derivative in units per second; tweens have none (a following spring starts at rest). */
  readonly velocity?: (t: number) => number;
}

export interface SpringOptions {
  readonly from: number;
  readonly to: number;
  /** Units per second; ignored by duration/bounce springs, as in Motion. */
  readonly velocity?: number | undefined;
  readonly stiffness?: number | undefined;
  readonly damping?: number | undefined;
  readonly mass?: number | undefined;
  readonly duration?: number | undefined;
  readonly bounce?: number | undefined;
}

const clamp = (min: number, max: number, v: number) => (v > max ? max : v < min ? min : v);
const millisecondsToSeconds = (milliseconds: number) => milliseconds / 1000;
const secondsToMilliseconds = (seconds: number) => seconds * 1000;

/* ------------------------------------------------------------------------------------------ */
/* motion-utils/dist/es/easing/cubic-bezier.mjs (modified from Gaëtan Renaudeau's BezierEasing) */

const calcBezier = (t: number, a1: number, a2: number) => t * (3 * (1 - t) * ((1 - t) * a1 + t * a2) + t * t);
function cubicBezier(mX1: number, mY1: number, mX2: number, mY2: number): (x: number) => number {
  if (mX1 === mY1 && mX2 === mY2) return (x) => x;
  return (x) => {
    let lowerBound = 0;
    let upperBound = 1;
    let t = x;
    for (let i = 0; ; i++) {
      // Outside the bracket (x out of range or a Newton overshoot on a flat part): bisect.
      if (!(t >= lowerBound && t <= upperBound)) t = (lowerBound + upperBound) / 2;
      const currentX = calcBezier(t, mX1, mX2) - x;
      if (currentX * currentX < 1e-28 || i === 40) break;
      currentX > 0 ? (upperBound = t) : (lowerBound = t);
      // Newton-Raphson step, dx/dt from a forward difference.
      t -= (currentX * 1e-7) / (calcBezier(t + 1e-7, mX1, mX2) - x - currentX);
    }
    return calcBezier(t, mY1, mY2);
  };
}
const easeOut = cubicBezier(0, 0, 0.58, 1);

/* ------------------------------------------------------------------------------------------ */
/* motion-dom/dist/es/animation/generators/keyframes.mjs: two numeric keyframes, one easing  */

/** `keyframes({ keyframes: [from, to], duration, ease: 'easeOut' })` for numbers. */
export function tween(from: number, to: number, duration: number): Generator {
  const state: GeneratorState = { done: false, value: from };
  const mixes = from !== to;
  return {
    next: (t) => {
      state.value = mixes ? from + (to - from) * easeOut(duration > 0 ? clamp(0, 1, t / duration) : 1) : to;
      state.done = t >= duration;
      return state;
    },
  };
}

/* ------------------------------------------------------------------------------------------ */
/* motion-dom/dist/es/animation/generators/spring.mjs                                        */

const springDefaults = {
  stiffness: 100,
  damping: 10,
  mass: 1.0,
  duration: 800,
  bounce: 0.3,
  restSpeed: { granular: 0.01, default: 2 },
  restDelta: { granular: 0.005, default: 0.5 },
  minDuration: 0.01,
  maxDuration: 10.0,
  minDamping: 0.05,
};

/** Bounce → damping ratio as SwiftUI does: 0 critically damped, towards 1 undamped, towards −1 overdamped. */
const bounceToDampingRatio = (bounce: number) => bounce < 0
  ? 1 / Math.max(1 + bounce, springDefaults.minDamping)
  : Math.max(1 - bounce, springDefaults.minDamping);

const rootIterations = 12;
function approximateRoot(envelope: (v: number) => number, derivative: (v: number) => number, initialGuess: number) {
  let result = initialGuess;
  for (let i = 1; i < rootIterations; i++) result = result - envelope(result) / derivative(result);
  return result;
}

/** Scales an overdamped spring's undamped frequency so a negative bounce changes the shape, not the arrival. */
function overdampedFreqScale(dampingRatio: number, criticalFreqTime: number) {
  if (!(dampingRatio > 1)) return 1;
  const root = Math.sqrt(dampingRatio * dampingRatio - 1);
  const slow = dampingRatio - root;
  const fast = dampingRatio + root;
  const target = 2 * root * Math.exp(-criticalFreqTime) * (1 + criticalFreqTime);
  return approximateRoot(
    (freqTime) => fast * Math.exp(-slow * freqTime) - slow * Math.exp(-fast * freqTime) - target,
    (freqTime) => Math.exp(-fast * freqTime) - Math.exp(-slow * freqTime),
    criticalFreqTime,
  ) / criticalFreqTime;
}

function calcAngularFreq(undampedFreq: number, dampingRatio: number) {
  return undampedFreq * Math.sqrt(1 - dampingRatio * dampingRatio);
}

const safeMin = 0.001;
/** Duration/bounce → stiffness/damping (zero initial velocity, default mass), by Newton's method. */
function findSpring(duration: number, bounce: number) {
  let envelope: (undampedFreq: number) => number;
  let derivative: (undampedFreq: number) => number;
  const dampingRatio = bounceToDampingRatio(bounce);
  duration = clamp(springDefaults.minDuration, springDefaults.maxDuration, millisecondsToSeconds(duration));
  if (dampingRatio < 1) {
    envelope = (undampedFreq) => {
      const exponentialDecay = undampedFreq * dampingRatio;
      const delta = exponentialDecay * duration;
      const b = calcAngularFreq(undampedFreq, dampingRatio);
      const c = Math.exp(-delta);
      return safeMin - (exponentialDecay / b) * c;
    };
    derivative = (undampedFreq) => {
      const exponentialDecay = undampedFreq * dampingRatio;
      const delta = exponentialDecay * duration;
      const e = dampingRatio * dampingRatio * undampedFreq * undampedFreq * duration;
      const f = Math.exp(-delta);
      const g = calcAngularFreq(undampedFreq * undampedFreq, dampingRatio);
      const factor = -envelope(undampedFreq) + safeMin > 0 ? -1 : 1;
      return (factor * -e * f) / g;
    };
  } else {
    // Critically damped; overdamped springs reuse this root, scaled below.
    envelope = (undampedFreq) => {
      const a = Math.exp(-undampedFreq * duration);
      const b = undampedFreq * duration + 1;
      return -safeMin + a * b;
    };
    derivative = (undampedFreq) => {
      const a = Math.exp(-undampedFreq * duration);
      const b = -undampedFreq * (duration * duration);
      return a * b;
    };
  }
  const initialGuess = 5 / duration;
  const criticalFreq = approximateRoot(envelope, derivative, initialGuess);
  const undampedFreq = criticalFreq * overdampedFreqScale(dampingRatio, criticalFreq * duration);
  const stiffness = undampedFreq * undampedFreq;
  return { stiffness, damping: dampingRatio * 2 * Math.sqrt(stiffness), duration: secondsToMilliseconds(duration) };
}

/** Stiffness and mass are divisors (positive); damping 0 is a valid perpetual oscillation. */
const isValidPhysics = (value: number | undefined, canBeZero = false): value is number =>
  (canBeZero ? (value as number) >= 0 : (value as number) > 0) && (value as number) < Infinity;

/**
 * `spring({ keyframes: [from, to], velocity, stiffness, damping, mass })` or
 * `spring({ keyframes: [from, to], duration, bounce })`. Physics, when valid, wins over
 * duration/bounce; a duration/bounce spring that fails to resolve falls back to Motion's defaults.
 */
export function spring(options: SpringOptions): Generator {
  const origin = options.from;
  const target = options.to;
  const state: GeneratorState = { done: false, value: origin };

  const validStiffness = isValidPhysics(options.stiffness) ? options.stiffness : undefined;
  const validDamping = isValidPhysics(options.damping, true) ? options.damping : undefined;
  const validMass = isValidPhysics(options.mass) ? options.mass : undefined;
  let stiffness = validStiffness ?? springDefaults.stiffness;
  let damping = validDamping ?? springDefaults.damping;
  const mass = validMass ?? springDefaults.mass;
  let duration = 0;
  let isResolvedFromDuration = false;
  const isTimeDefined = (validStiffness ?? validDamping ?? validMass) === undefined
    && (options.duration !== undefined || options.bounce !== undefined);
  if (isTimeDefined) {
    const resolved = findSpring(options.duration ?? springDefaults.duration, options.bounce ?? springDefaults.bounce);
    stiffness = resolved.stiffness;
    damping = resolved.damping;
    duration = resolved.duration;
    isResolvedFromDuration = true;
    // Degenerate time options (NaN bounce, no convergence): replace the pair together.
    if (!isValidPhysics(stiffness) || !isValidPhysics(damping, true)) {
      stiffness = springDefaults.stiffness;
      damping = springDefaults.damping;
    }
  }

  // Time-defined springs ignore inherited velocity (it would oscillate small ranges heavily).
  const inheritVelocity = (velocity: number) => (isTimeDefined ? 0 : -millisecondsToSeconds(velocity));
  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
  const undampedAngularFreq = millisecondsToSeconds(Math.sqrt(stiffness / mass));
  const decay = dampingRatio * undampedAngularFreq;
  const delta = target - origin;
  const velocity = inheritVelocity(options.velocity || 0) || 0;
  const isGranularScale = Math.abs(delta) < 5;
  const restSpeed = isGranularScale ? springDefaults.restSpeed.granular : springDefaults.restSpeed.default;
  const restDelta = isGranularScale ? springDefaults.restDelta.granular : springDefaults.restDelta.default;

  let resolveSpring: (t: number) => number;
  let resolveVelocity: (t: number) => number;
  if (dampingRatio < 1) {
    // Underdamped. exp/sin/cos depend only on t: memoised per t, as in Motion.
    const angularFreq = calcAngularFreq(undampedAngularFreq, dampingRatio);
    const A = (velocity + decay * delta) / angularFreq;
    const sinC = decay * A + delta * angularFreq;
    const cosC = decay * delta - A * angularFreq;
    const c = { t: -1, env: 0, sin: 0, cos: 0 };
    const sample = (t: number) => {
      if (t !== c.t) {
        c.t = t;
        c.env = Math.exp(-decay * t);
        c.sin = Math.sin(angularFreq * t);
        c.cos = Math.cos(angularFreq * t);
      }
    };
    resolveSpring = (t) => { sample(t); return target - c.env * (A * c.sin + delta * c.cos); };
    resolveVelocity = (t) => { sample(t); return c.env * (sinC * c.sin + cosC * c.cos); };
  } else if (dampingRatio === 1) {
    // Critically damped.
    const C = velocity + undampedAngularFreq * delta;
    resolveSpring = (t) => target - Math.exp(-undampedAngularFreq * t) * (delta + (velocity + undampedAngularFreq * delta) * t);
    resolveVelocity = (t) => Math.exp(-undampedAngularFreq * t) * (undampedAngularFreq * C * t - velocity);
  } else {
    // Overdamped: a slow and a fast decaying exponential, so no term overflows.
    const dampedAngularFreq = undampedAngularFreq * Math.sqrt(dampingRatio * dampingRatio - 1);
    const slow = decay - dampedAngularFreq;
    const fast = decay + dampedAngularFreq;
    // Physics-defined springs settle at the damping rate once dampedAngularFreq·t passes 300;
    // time-defined (negative bounce) springs keep the exact curve.
    const limit = isTimeDefined ? Infinity : 300 / dampedAngularFreq;
    const decayAt = (rate: number, t: number) => Math.exp(t > limit ? -rate * limit - decay * (t - limit) : -rate * t);
    const P = (velocity + decay * delta) / dampedAngularFreq;
    const S = (delta + P) / 2;
    const F = (delta - P) / 2;
    resolveSpring = (t) => target - S * decayAt(slow, t) - F * decayAt(fast, t);
    resolveVelocity = (t) => slow * S * decayAt(slow, t) + fast * F * decayAt(fast, t);
  }

  return {
    velocity: (t) => secondsToMilliseconds(resolveVelocity(t)),
    next: (t) => {
      const current = resolveSpring(t);
      if (!isResolvedFromDuration) {
        const currentVelocity = secondsToMilliseconds(resolveVelocity(t));
        state.done = Math.abs(currentVelocity) <= restSpeed && Math.abs(target - current) <= restDelta;
      } else {
        state.done = t >= duration;
      }
      state.value = state.done ? target : current;
      return state;
    },
  };
}
