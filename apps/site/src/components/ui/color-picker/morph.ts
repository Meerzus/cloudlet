/**
 * The swatch → panel morph: two spring channels (size and radius) that can be retargeted in flight,
 * and the feature test for driving them through registered CSS properties. Pure except for the
 * clock; the component owns the DOM.
 */

import { springAt, springRetarget, springVelocityAt, type SpringConfig, type SpringRetarget } from '@/lib/spring';

/** Springs of the morph; the size channel takes the Island's shape springs, the radius settles a touch earlier. */
export const MORPH = {
  sizeOpen: { stiffness: 900, damping: 60, mass: 2 } satisfies SpringConfig,
  sizeClose: { stiffness: 900, damping: 45, mass: 1 } satisfies SpringConfig,
  radiusOpen: { stiffness: 900, damping: 70, mass: 1.4 } satisfies SpringConfig,
  radiusClose: { stiffness: 900, damping: 55, mass: 1 } satisfies SpringConfig,
  /** The content unblurs after the clip has started to grow, and blurs out faster than it came. */
  contentDelay: 70,
  contentIn: 240,
  contentOut: 140,
  /** Extra delay per body row when the rows appear one after another. */
  stagger: 40,
  blur: 6,
} as const;

/** Slow-motion knob for the stand: animations run at this rate and the channels read time through it. */
export const morphClock = { rate: 1 };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface Retarget extends SpringRetarget {
  readonly from: number;
  readonly to: number;
}

/**
 * One animated scalar (0 = collapsed, 1 = expanded) on a spring. `retarget` reads the current value
 * and speed of the movement in flight and starts a new spring from there, so an interrupted open or
 * close carries its momentum instead of jumping.
 */
export class SpringChannel {
  private from: number;
  private velocity0 = 0;
  private to: number;
  private config: SpringConfig = MORPH.sizeOpen;
  private startedAt = now();

  constructor(initial: number) {
    this.from = initial;
    this.to = initial;
  }

  private elapsed(at: number) {
    return Math.max(0, ((at - this.startedAt) * morphClock.rate) / 1000);
  }

  value(at = now()): number {
    return this.from === this.to && this.velocity0 === 0 ? this.to : springAt(this.config, this.from, this.velocity0, this.to, this.elapsed(at));
  }

  velocity(at = now()): number {
    return this.from === this.to && this.velocity0 === 0 ? 0 : springVelocityAt(this.config, this.from, this.velocity0, this.to, this.elapsed(at));
  }

  /** Aims the channel at `to` on `config` from wherever it is now; `null` when it is already there. */
  retarget(to: number, config: SpringConfig, at = now()): Retarget | null {
    const from = this.value(at);
    const velocity = this.velocity(at);
    this.from = from;
    this.velocity0 = velocity;
    this.to = to;
    this.config = config;
    this.startedAt = at;
    const easing = springRetarget(config, from, velocity, to);
    return easing ? { ...easing, from, to } : null;
  }

  /** Puts the channel at `value` with no movement (reduced motion, no WAAPI). */
  settle(value: number) {
    this.from = value;
    this.to = value;
    this.velocity0 = 0;
    this.startedAt = now();
  }
}

/** The names of the registered properties the clip-path reads; see color-picker.css `@property`. */
export const CLIP_VARS = ['--color-picker-clip-top', '--color-picker-clip-right', '--color-picker-clip-bottom', '--color-picker-clip-left'] as const;
export const RADIUS_VAR = '--color-picker-clip-radius';

/**
 * Registered custom properties animate as numbers, so size and radius can run on two springs at
 * once. `CSS.registerProperty` ships with `@property` (Chromium 85, Safari 16.4, Firefox 128);
 * without it the morph animates `clip-path` on one spring.
 */
export function supportsMorphChannels(): boolean {
  return typeof CSS !== 'undefined' && typeof CSS.registerProperty === 'function' && typeof CSS.supports === 'function' && CSS.supports('clip-path', 'inset(0px round 1px)');
}

/** Lengths in px for the clip channels at `progress` between the collapsed and expanded insets. */
export function clipAt(collapsed: readonly [number, number, number, number], progress: number): [string, string, string, string] {
  return collapsed.map((inset) => `${inset * (1 - progress)}px`) as [string, string, string, string];
}

/** Radius in px at `progress` between the circle's radius and the panel's corner radius. */
export const radiusAt = (circle: number, panel: number, progress: number) => `${circle + (panel - circle) * progress}px`;
