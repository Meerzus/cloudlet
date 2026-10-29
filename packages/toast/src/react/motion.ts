import type { CloudletMotionConstants, CloudletMotionOverrides } from '../react.js';
import { spring, tween as tweenGenerator } from './generators.js';
import type { Generator } from './generators.js';

/**
 * Values tuned on the laboratory, the one place
 * to tune them. Durations are milliseconds at `timeScale: 1`; offsets are CSS px.
 */
export const MOTION = {
  /** First pill of an empty stack: scale and translateY on the spring, opacity on a `fade` ms tween (it grows, not fades). */
  enter: { duration: 200, bounce: 0.25, scale: 0.25, offset: 1, fade: 160 },
  /** Exit of the last record or of the dismissed top pill: the reverse of entering (same scale and offset). */
  exit: { duration: 300, bounce: 0 },
  /** Shape springs: opening, and collapsing or adjusting to new content. */
  shapeOpen: { stiffness: 900, damping: 60, mass: 2 },
  shapeClose: { stiffness: 900, damping: 45, mass: 1 },
  /** Tails retract in the first 150 ms of opening and return in the last 150 ms of collapsing. */
  tails: 150,
  /** Close button, body and indicator: delayed fade + 4 px on open, 70 ms fade on collapse. */
  chromeDelay: 100, chromeIn: 200, chromeOut: 70, chromeOffset: 4,
  /** Title and icon blur swap: outgoing 0→6 px and 1→0, incoming 6→0 px and 0→1. */
  headerOut: 200, headerIn: 260, blur: 6,
  /** Body crossfade: outgoing opacity, incoming opacity + translateY 4→0; a stream of updates (progress) crossfades once, then changes in place. */
  bodyOut: 120, bodyIn: 200, bodyOffset: 4, bodyQuiet: 600,
  /** Horizontal slide of the body between notifications (the heading blur-swaps in place); swipes release with it. */
  slide: { stiffness: 1200, damping: 60, mass: 1 },
  /** Badge presence (scale .6↔1, opacity), badge number and indicator text blur swap. */
  badge: { duration: 200, bounce: 0, scale: 0.6 }, countSwap: 160,
  /** Numeric progress value tween. */
  progress: 1000,
  /** Hover spreads the tails by 2 px per step. */
  hover: 200, hoverLift: 2,
  /** Reduced motion: every transition becomes an opacity change of this length; swipes are off. */
  reduced: 80,
  /**
   * Swipes: the axis is decided after `intent` px; a release commits past
   * `distance` of the swiped dimension, or after `minDistance` px with `velocity` px/ms
   * towards the commit (a flick back cancels). Edges resist with the rubber-band
   * coefficient; a trackpad swipe ends after `wheelIdle` ms without wheel events and commits
   * as soon as its release would; for `wheelLock` ms after that the same stream cannot commit
   * again (one gesture keeps accelerating), later only a faster or reversed delta starts a new swipe.
   * Released offsets spring home with the `slide` spring and the release velocity.
   * Collapsing towards the screen edge has little room: it also commits after `edge` px.
   */
  swipe: { intent: 8, distance: 0.3, minDistance: 24, velocity: 0.5, edge: 32, rubberBand: 0.55, wheelIdle: 140, wheelLock: 400, suppressClick: 500 },
} as const;

/** The tunable part of MOTION: everything but the swipe thresholds. */
const tunable: CloudletMotionConstants = MOTION;
const positive = new Set(['stiffness', 'mass']);

/**
 * Resolves `ToasterMotion.overrides` (a debugging channel) onto the starting
 * values. A field that is not a finite number in range (springs: stiffness and mass > 0,
 * everything else ≥ 0) keeps its default; unknown keys are ignored.
 */
export function resolveMotion(overrides: CloudletMotionOverrides | undefined): CloudletMotionConstants {
  if (!overrides || typeof overrides !== 'object') return tunable;
  const valid = (key: string, value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && (positive.has(key) ? value > 0 : value >= 0);
  const result: Record<string, unknown> = {};
  for (const [key, base] of Object.entries(tunable) as [string, unknown][]) {
    if (key === 'swipe') continue;
    const override = (overrides as Record<string, unknown>)[key];
    if (typeof base === 'number') result[key] = valid(key, override) ? override : base;
    else {
      const fields = { ...(base as Record<string, number>) };
      if (override && typeof override === 'object') {
        for (const field of Object.keys(fields)) {
          const value = (override as Record<string, unknown>)[field];
          if (valid(field, value)) fields[field] = value;
        }
      }
      result[key] = fields;
    }
  }
  return result as unknown as CloudletMotionConstants;
}

const channelKeys = [
  'opacity', 'scale', 'y', 'width', 'height', 'radius',
  'tail1', 'tail1Opacity', 'tail2', 'tail2Opacity', 'lift', 'badge',
  'chrome', 'chromeOut', 'headerIn', 'headerOut', 'bodyIn', 'bodyOut',
  'slide', 'slideIn', 'slideOut', 'badgeIn', 'badgeOut', 'pageIn', 'pageOut',
  'progress', 'exitOpacity', 'exitScale', 'exitY', 'exitX', 'headX', 'headY', 'dragX', 'dragY',
] as const;
export type Channel = typeof channelKeys[number];
/** Spatial channels jump under reduced motion; every other channel fades for MOTION.reduced. */
const spatial = new Set<Channel>(['scale', 'y', 'width', 'height', 'radius', 'tail1', 'tail2', 'lift', 'slide', 'progress',
  'exitScale', 'exitY', 'exitX', 'headX', 'headY', 'dragX', 'dragY']);
const initial: Partial<Record<Channel, number>> = { scale: 1, headerIn: 1, bodyIn: 1, slideIn: 1, badgeIn: 1, pageIn: 1, exitScale: 1 };

export type ShellFrame = Readonly<Record<Channel, number>> & {
  readonly reduced: boolean;
  /** +1 when the incoming slide arrives from the inline end, −1 from the start. */
  readonly slideDirection: number;
  readonly slideWidth: number;
};
export type SwapLayer = 'header' | 'body' | 'badge' | 'page';
export type ShapeMode = 'open' | 'close' | 'instant';
export interface ShellGeometry { readonly width: number; readonly height: number; readonly radius: number }
/** Channels a finger moves directly: the pill or Island (`dragX`, `dragY`) and the Island content (`slide`). */
export type DragChannel = 'dragX' | 'dragY' | 'slide';
/** A swipe-dismissed pill keeps flying sideways from where the finger released it. */
export interface Fling { readonly direction: 1 | -1; readonly distance: number; readonly velocity: number }

interface ShellMotionOptions {
  readonly now: () => number;
  readonly requestFrame: (callback: (time: number) => void) => number;
  readonly cancelFrame: (frame: number) => void;
  /** The sole DOM writer: scoped CSSOM rules and SVG attributes, never a style attribute. */
  readonly write: (frame: ShellFrame) => void;
  readonly reducedMotion?: boolean;
  readonly timeScale?: number | undefined;
  /** Resolved constants (`resolveMotion`); MOTION when omitted. */
  readonly constants?: CloudletMotionConstants | undefined;
}

type Spec =
  | { readonly stiffness: number; readonly damping: number; readonly mass: number }
  | { readonly duration: number; readonly bounce: number }
  | { readonly tween: number };
interface ChannelState {
  value: number;
  target: number;
  /** Real-time units per second, independent of timeScale. */
  velocity: number;
  animation: { generator: Generator; start: number; delay: number } | null;
}

const swaps = (m: CloudletMotionConstants): Record<SwapLayer | 'chrome', readonly [Channel, Channel, number, number]> => ({
  header: ['headerIn', 'headerOut', m.headerIn, m.headerOut],
  body: ['bodyIn', 'bodyOut', m.bodyIn, m.bodyOut],
  badge: ['badgeIn', 'badgeOut', m.countSwap, m.countSwap],
  page: ['pageIn', 'pageOut', m.countSwap, m.countSwap],
  chrome: ['chrome', 'chromeOut', m.chromeIn, m.chromeOut],
});
const validScale = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;

/**
 * One RAF sampler per host over the generators of generators.ts (the numeric part of
 * Motion 14.3.0, frame-exact by the reference test): next() takes milliseconds,
 * velocity() returns the analytical units/s derivative accepted by the next
 * physical spring, so every retarget starts from the current value and speed.
 * Time-defined springs (duration/bounce) intentionally ignore velocity there.
 * `timeScale` stretches generator time for every channel at once. Nothing is
 * scheduled while idle; completion callbacks run only for the latest request
 * of their group and never synchronously.
 */
export function createShellMotion(options: ShellMotionOptions) {
  const values = Object.fromEntries(channelKeys.map(key => {
    const value = initial[key] ?? 0;
    return [key, { value, target: value, velocity: 0, animation: null } satisfies ChannelState];
  })) as Record<Channel, ChannelState>;
  const groups = new Map<string, { keys: readonly Channel[]; done: () => void }>();
  let frame: number | null = null;
  let disposed = false;
  let measured = false;
  let reduced = options.reducedMotion ?? false;
  let timeScale = validScale(options.timeScale);
  // Read at the start of every transition: new values apply live, running ones finish as started.
  let m = options.constants ?? tunable;
  let slideDirection = 1;
  let slideWidth = 0;

  const active = (keys: readonly Channel[]) => keys.some(key => values[key].animation !== null);
  const output = (): ShellFrame => {
    const result = { reduced, slideDirection, slideWidth } as Record<string, number | boolean>;
    for (const key of channelKeys) result[key] = values[key].value;
    return result as unknown as ShellFrame;
  };
  const write = () => { if (measured && !disposed) options.write(output()); };
  function sample(time: number) {
    for (const key of channelKeys) {
      const state = values[key];
      const animation = state.animation;
      if (!animation) continue;
      const elapsed = Math.max(0, (time - animation.start) * timeScale - animation.delay);
      const next = animation.generator.next(elapsed);
      state.value = next.value;
      state.velocity = next.done ? 0 : (animation.generator.velocity?.(elapsed) ?? 0) * timeScale;
      if (next.done) { state.animation = null; state.value = state.target; }
    }
  }
  function schedule() {
    if (!disposed && frame === null) frame = options.requestFrame(tick);
  }
  function complete() {
    for (const [name, group] of [...groups]) {
      if (disposed) return;
      if (groups.get(name) !== group || active(group.keys)) continue;
      // Clear before invoking: completion can synchronously retarget or dispose.
      groups.delete(name);
      group.done();
    }
  }
  function tick(time: number) {
    frame = null;
    if (disposed) return;
    sample(time);
    write();
    complete();
    if (active(channelKeys)) schedule();
  }
  function jump(key: Channel, value: number) {
    const state = values[key];
    state.value = state.target = value;
    state.velocity = 0;
    state.animation = null;
  }
  function to(key: Channel, target: number, spec: Spec, time: number, delay = 0) {
    const state = values[key];
    if (reduced) {
      if (spatial.has(key)) return jump(key, target);
      spec = { tween: m.reduced };
      delay = 0;
    }
    state.target = target;
    if (state.value === target && !state.animation) return;
    const generator = 'tween' in spec
      ? tweenGenerator(state.value, target, spec.tween)
      : spring({ from: state.value, to: target, velocity: state.velocity / timeScale, ...spec });
    state.animation = { generator, start: time, delay };
  }
  function after(name: string, keys: readonly Channel[], done?: () => void) {
    if (done) groups.set(name, { keys, done }); else groups.delete(name);
  }
  /** Shared entry for every public request: sample now, mutate, write the first frame, schedule. */
  function request(change: (time: number) => void) {
    if (disposed) return;
    const time = options.now();
    sample(time);
    change(time);
    write();
    // Completions are always delivered from a frame, never synchronously.
    if (groups.size || active(channelKeys)) schedule();
  }
  const enterSpring = () => ({ duration: m.enter.duration, bounce: m.enter.bounce });
  const exitSpring = () => ({ duration: m.exit.duration, bounce: m.exit.bounce });
  const badgeSpring = () => ({ duration: m.badge.duration, bounce: m.badge.bounce });
  const tween = (duration: number) => ({ tween: duration });

  /** Visual settle time of a running channel in real milliseconds (bounded, includes a pending delay). */
  function remaining(key: Channel, time: number): number {
    const animation = values[key].animation;
    if (!animation) return 0;
    const target = values[key].target;
    const elapsed = (time - animation.start) * timeScale - animation.delay;
    let t = Math.max(0, elapsed);
    for (const end = t + 2000; t < end; t += 8) {
      const next = animation.generator.next(t);
      if (next.done || Math.abs(next.value - target) < 0.5) break;
    }
    // Generators keep mutable iterator state: resample the current time.
    animation.generator.next(Math.max(0, elapsed));
    return (t - elapsed) / timeScale;
  }
  function swap(layer: SwapLayer | 'chrome', time: number, done?: () => void, incomingOnly = false) {
    const [incoming, outgoing, inMs, outMs] = swaps(m)[layer];
    // The live layer was just cloned: the snapshot continues from its current look.
    jump(outgoing, incomingOnly ? 0 : values[incoming].value);
    jump(incoming, 0);
    to(outgoing, 0, tween(outMs), time);
    to(incoming, 1, tween(inMs), time, layer === 'chrome' ? m.chromeDelay : 0);
    after(layer, [incoming, outgoing], done);
  }
  function tails(depth: number, time: number, spec: Spec, delay: number, from?: (index: number) => { slot?: number; opacity?: number }) {
    for (const index of [1, 2] as const) {
      const slot = `tail${index}` as const;
      const opacity = `tail${index}Opacity` as const;
      const start = from?.(index);
      if (start?.slot !== undefined) jump(slot, start.slot);
      if (start?.opacity !== undefined) jump(opacity, start.opacity);
      if (index <= depth) {
        to(slot, index, spec, time, delay);
        to(opacity, 1, 'tween' in spec ? spec : tween(m.tails), time, delay);
      } else to(opacity, 0, tween(m.tails), time);
    }
  }
  const tailKeys: readonly Channel[] = ['tail1', 'tail1Opacity', 'tail2', 'tail2Opacity', 'badge'];

  return {
    /** Target geometry measured from HTML; the first measurement and `instant` never animate. */
    setShape(target: ShellGeometry, mode: ShapeMode) {
      request(time => {
        const spec = mode === 'open' ? m.shapeOpen : m.shapeClose;
        for (const key of ['width', 'height', 'radius'] as const) {
          if (!measured || mode === 'instant') jump(key, target[key]);
          else if (values[key].target !== target[key]) to(key, target[key], spec, time);
        }
        measured = true;
      });
    },
    /**
     * The title and icon are the same nodes in both states, so a morph moves them
     * (FLIP): the layout jump is cancelled and springs back with the shape. Text never scales.
     */
    shiftHeading(dx: number, dy: number, mode: ShapeMode) {
      request(time => {
        const spec = mode === 'open' ? m.shapeOpen : m.shapeClose;
        for (const [key, delta] of [['headX', dx], ['headY', dy]] as const) {
          if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) continue;
          values[key].value += delta;
          to(key, 0, spec, time);
        }
      });
    },
    /** The first pill: opacity 0→1 (tween), scale and translateY from the edge on the enter spring. */
    enter(edge: -1 | 1, done?: () => void) {
      request(time => {
        jump('opacity', 0); jump('scale', m.enter.scale); jump('y', edge * m.enter.offset);
        // The shell becomes opaque within `fade`; only scale and y follow the spring.
        to('opacity', 1, tween(m.enter.fade), time);
        for (const key of ['scale', 'y'] as const) to(key, key === 'y' ? 0 : 1, enterSpring(), time);
        after('presence', ['opacity', 'scale', 'y'], done);
      });
    },
    /** The first tail moves up into the pill's place after the top pill was dismissed. */
    rise(offset: number, scale: number, done?: () => void) {
      request(time => {
        jump('y', offset); jump('scale', scale);
        to('y', 0, enterSpring(), time); to('scale', 1, enterSpring(), time); to('opacity', 1, enterSpring(), time);
        after('presence', ['opacity', 'scale', 'y'], done);
      });
    },
    /**
     * The exit layer leaves from the shell's current presence; the shell itself is free again.
     * With a fling (swipe dismiss) the snapshot continues sideways with the release velocity
     * (px/s) instead of falling back to the edge, and the live shell returns to the centre.
     */
    exit(edge: -1 | 1, done?: () => void, fling?: Fling) {
      request(time => {
        jump('exitOpacity', values.opacity.value); jump('exitScale', values.scale.value);
        jump('exitY', values.y.value + values.dragY.value); jump('exitX', fling ? values.dragX.value : 0);
        to('exitOpacity', 0, exitSpring(), time);
        if (fling) {
          values.exitX.velocity = fling.velocity;
          to('exitX', fling.direction * fling.distance, m.slide, time);
        } else {
          to('exitScale', m.enter.scale, exitSpring(), time);
          to('exitY', edge * m.enter.offset, exitSpring(), time);
        }
        jump('dragX', 0); jump('dragY', 0);
        after('exit', ['exitOpacity', 'exitScale', 'exitY', 'exitX'], done);
      });
    },
    /** Hides the live shell at once (its look moved to the exit layer). */
    hide() { request(() => jump('opacity', 0)); },
    /**
     * Collapsed stack depth (0–2 tails). `arrival`: tails shift back from the pill;
     * `rise`: they move up one step; `settle`: spring to their slots in place.
     */
    setTails(depth: number, change: 'arrival' | 'rise' | 'settle', previousDepth: number, done?: () => void) {
      request(time => {
        if (change === 'settle') tails(depth, time, enterSpring(), 0);
        else tails(depth, time, enterSpring(), 0, index => {
          if (index > depth) return { opacity: 0 };
          if (change === 'arrival') return { slot: index - 1, opacity: 1 };
          return { slot: index + 1, opacity: index + 1 <= previousDepth ? 1 : 0 };
        });
        after('tails', tailKeys, done);
      });
    },
    setBadge(visible: boolean) { request(time => to('badge', visible ? 1 : 0, badgeSpring(), time)); },
    /** True while the layer's incoming side is still fading in: a further update joins it instead of restarting. */
    swapping(layer: SwapLayer): boolean { return !!values[swaps(m)[layer][0]].animation; },
    /** The sampler's clock (real ms), so the host's update timing follows the same source. */
    now(): number { return options.now(); },
    /** Opening: tails and badge leave in 150 ms; close, body and indicator appear after 100 ms. */
    open(done?: () => void) {
      request(time => {
        for (const index of [1, 2] as const) { to(`tail${index}`, 0, tween(m.tails), time); to(`tail${index}Opacity`, 0, tween(m.tails), time); }
        to('badge', 0, tween(m.tails), time);
        jump('chromeOut', 0);
        jump('chrome', 0);
        to('chrome', 1, tween(m.chromeIn), time, m.chromeDelay);
        after('tails', tailKeys, done);
      });
    },
    /**
     * Collapsing: the chrome snapshot fades in 70 ms while the shape springs back;
     * tails and badge return during the last 150 ms of the shape spring.
     */
    collapse(depth: number, badge: boolean, done?: { chrome?: () => void; tails?: () => void }) {
      request(time => {
        jump('chrome', 0);
        jump('chromeOut', 1);
        to('chromeOut', 0, tween(m.chromeOut), time);
        after('chrome', ['chromeOut'], done?.chrome);
        const delay = Math.max(0, Math.max(remaining('width', time), remaining('height', time)) - m.tails) * timeScale;
        tails(depth, time, tween(m.tails), delay, () => ({ slot: 0, opacity: 0 }));
        to('badge', badge ? 1 : 0, tween(m.tails), time, delay);
        after('tails', tailKeys, done?.tails);
      });
    },
    /** One outgoing snapshot per layer: a new swap restarts from the live layer's current look. */
    swap(layer: SwapLayer, done?: () => void, incomingOnly = false) {
      request(time => swap(layer, time, done, incomingOnly));
    },
    /** Slide inside a fixed shell. The outgoing snapshot follows the incoming layer one width behind. */
    slide(direction: 1 | -1, width: number, done?: () => void) {
      request(time => {
        if (reduced) {
          jump('slide', 0);
          jump('slideOut', 1); jump('slideIn', 0);
          to('slideOut', 0, tween(m.reduced), time); to('slideIn', 1, tween(m.reduced), time);
        } else {
          jump('slideOut', 1); jump('slideIn', 1);
          // Keep the strip continuous and its velocity when a slide interrupts a slide.
          const state = values.slide;
          state.value += direction * width;
          to('slide', 0, m.slide, time);
        }
        slideDirection = direction;
        slideWidth = width;
        after('slide', ['slide', 'slideIn', 'slideOut'], done);
      });
    },
    /** The finger owns the channel: no spring, no velocity until `release`. */
    drag(channel: DragChannel, value: number) {
      request(() => { if (Number.isFinite(value)) jump(channel, value); });
    },
    /**
     * The finger lets go: the channel springs home (0) with the release velocity in px/s.
     * A committed navigation instead keeps the offset and velocity and calls `slide`.
     */
    release(channel: DragChannel, velocity: number, done?: () => void) {
      request(time => {
        values[channel].velocity = Number.isFinite(velocity) ? velocity : 0;
        to(channel, 0, m.slide, time);
        after(`release:${channel}`, [channel], done);
      });
    },
    /** Sets the speed a following `slide` starts with (a swipe released towards a neighbour). */
    fling(channel: DragChannel, velocity: number) {
      if (!disposed && !values[channel].animation) values[channel].velocity = Number.isFinite(velocity) ? velocity : 0;
    },
    setProgress(value: number | null, immediate: boolean) {
      request(time => { if (value === null || immediate) jump('progress', value ?? 0); else to('progress', value, tween(m.progress), time); });
    },
    setHover(active: boolean) { request(time => to('lift', active ? 1 : 0, tween(m.hover), time)); },
    setReducedMotion(next: boolean) {
      if (disposed || reduced === next) return;
      request(time => {
        reduced = next;
        if (!reduced) return;
        for (const key of channelKeys) {
          const state = values[key];
          if (!state.animation) continue;
          if (spatial.has(key)) jump(key, state.target);
          else { state.animation = null; state.velocity = 0; to(key, state.target, tween(m.reduced), time); }
        }
      });
    },
    setTimeScale(next: number | undefined) {
      const scale = validScale(next);
      if (disposed || scale === timeScale) return;
      const time = options.now();
      sample(time);
      // Rebase running animations so their generator time stays continuous.
      for (const key of channelKeys) {
        const animation = values[key].animation;
        if (animation) animation.start = time - (time - animation.start) * timeScale / scale;
      }
      timeScale = scale;
    },
    /** New constants apply to transitions started from now on; running ones keep their curves. */
    setConstants(next: CloudletMotionConstants) { m = next; },
    /** The constants in effect (the renderer reads offsets and blur from them). */
    get constants() { return m; },
    /** True while a frame is scheduled; an idle host never keeps a RAF loop. */
    get running() { return frame !== null; },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== null) options.cancelFrame(frame);
      frame = null;
      groups.clear();
      for (const key of channelKeys) values[key].animation = null;
    },
  };
}

export type ShellMotion = ReturnType<typeof createShellMotion>;
