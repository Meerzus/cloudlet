/**
 * A damped spring sampled into a CSS `linear()` easing, so plain CSS transitions
 * can move on springs without a runtime dependency. Deterministic: the same input
 * gives the same string on the server and in the browser.
 */
export interface SpringConfig {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass?: number;
}

export interface SpringEasing {
  /** CSS `linear(...)` timing function. */
  readonly easing: string;
  /** Settling time in milliseconds. */
  readonly duration: number;
}

const STEP = 1 / 240;
const MAX_SECONDS = 3;

/** Unit step response of the spring, sampled every STEP seconds until it settles. */
function trace({ stiffness, damping, mass = 1 }: SpringConfig): { readonly samples: number[]; readonly seconds: number } {
  const samples: number[] = [];
  let position = 0;
  let velocity = 0;
  let time = 0;
  for (; time < MAX_SECONDS; time += STEP) {
    samples.push(position);
    const force = -stiffness * (position - 1) - damping * velocity;
    velocity += (force / mass) * STEP;
    position += velocity * STEP;
    if (Math.abs(position - 1) < 0.0005 && Math.abs(velocity) < 0.005) break;
  }
  samples.push(1);
  return { samples, seconds: time };
}

function sampler(samples: readonly number[]) {
  return (progress: number) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    const at = progress * (samples.length - 1);
    const low = Math.floor(at);
    const from = samples[low] ?? 1;
    return from + ((samples[low + 1] ?? from) - from) * (at - low);
  };
}

export function springEasing(config: SpringConfig, points = 48): SpringEasing {
  const { samples, seconds } = trace(config);
  const sample = sampler(samples);
  const stops: string[] = [];
  for (let index = 0; index <= points; index += 1) {
    stops.push(index === points ? '1' : String(Math.round(sample(index / points) * 10000) / 10000));
  }
  return { easing: `linear(${stops.join(', ')})`, duration: Math.round(seconds * 1000) };
}

export interface SpringEase {
  /** Progress 0..1 → eased value (overshoots like the spring); usable as a GSAP ease. */
  readonly ease: (progress: number) => number;
  /** Settling time in seconds. */
  readonly duration: number;
}

/**
 * Position `time` seconds after a spring starts at `from` with `velocity` (units per second) towards
 * `to`: a retarget that keeps the current value and speed (interruptibility). Pure: it
 * re-integrates from the start, so a scrubbed timeline gets the same value in either direction.
 */
export function springAt({ stiffness, damping, mass = 1 }: SpringConfig, from: number, velocity: number, to: number, time: number) {
  let position = from;
  let speed = velocity;
  const steps = Math.min(Math.max(0, Math.round(time / STEP)), Math.round(MAX_SECONDS / STEP));
  for (let index = 0; index < steps; index += 1) {
    const force = -stiffness * (position - to) - damping * speed;
    speed += (force / mass) * STEP;
    position += speed * STEP;
  }
  return position;
}

/** The same spring as an ease function, for scrubbed timelines (GSAP accepts functions as eases). */
export function springEase(config: SpringConfig): SpringEase {
  const { samples, seconds } = trace(config);
  return { ease: sampler(samples), duration: seconds };
}

export interface SpringRetarget {
  /** CSS `linear(...)` over the normalised distance: 0 is `from`, 1 is `to`; overshoot goes past 1. */
  readonly easing: string;
  /** Settling time in milliseconds. */
  readonly duration: number;
}

/** Settled when within this fraction of the distance and this fraction of the distance per second. */
const SETTLE_POSITION = 0.001;
const SETTLE_SPEED = 0.01;

/**
 * A spring that starts at `from` moving at `velocity` (units per second) and seeks `to`, as a
 * `linear()` easing over the normalised distance — the easing of a transition that picks up a
 * movement in flight (interruptibility: no stop, no restart, the speed carries over). The two
 * channels of a morph, size and radius, each take one. `null` when there is nothing to move.
 */
export function springRetarget({ stiffness, damping, mass = 1 }: SpringConfig, from: number, velocity: number, to: number, points = 48): SpringRetarget | null {
  const distance = to - from;
  // With no distance the keyframes coincide and the easing cannot show the leftover speed: let it go.
  if (Math.abs(distance) < 1e-6) return null;
  const scale = Math.abs(distance);
  const samples: number[] = [];
  let position = from;
  let speed = velocity;
  let time = 0;
  for (; time < MAX_SECONDS; time += STEP) {
    samples.push(position);
    const force = -stiffness * (position - to) - damping * speed;
    speed += (force / mass) * STEP;
    position += speed * STEP;
    if (Math.abs(position - to) < SETTLE_POSITION * scale && Math.abs(speed) < SETTLE_SPEED * scale) break;
  }
  samples.push(to);
  const sample = sampler(samples.map((value) => (value - from) / distance));
  const stops: string[] = [];
  for (let index = 0; index <= points; index += 1) {
    stops.push(index === points ? '1' : String(Math.round(sample(index / points) * 10000) / 10000));
  }
  return { easing: `linear(${stops.join(', ')})`, duration: Math.max(1, Math.round(time * 1000)) };
}

/** Velocity (units per second) of the same spring at `time`, from the positions a step apart. */
export function springVelocityAt(config: SpringConfig, from: number, velocity: number, to: number, time: number) {
  if (time <= 0) return velocity;
  return (springAt(config, from, velocity, to, time) - springAt(config, from, velocity, to, time - STEP)) / STEP;
}
