import { springAt, springEase, type SpringConfig } from './spring';

/**
 * Puppets: the state model and the motion of a GSAP-driven lookalike of
 * the Cloudlet toaster. Everything here is pure: a transition between two poses is a
 * function of time, so a scrubbed timeline renders the same frame in either direction.
 */

export type PuppetKind = 'success' | 'error' | 'info' | 'warning' | 'loading';
export type PuppetMode = 'pill' | 'island';
/** Island controls a call to action can sit on (hover tint + focus ring). */
export type PuppetControl = 'action' | 'retry' | 'cancel' | 'close';

/** One notification's content. Faces with equal ids are the same notification. */
export interface PuppetFace {
  readonly id: string;
  readonly kind: PuppetKind;
  readonly title: string;
  /** Island body text; `{progress}` is replaced by the live ring value (e.g. "42%"). */
  readonly description?: string;
  /** The primary action, tinted with the status colour. */
  readonly action?: string;
  /** The neutral Retry of a failed operation. */
  readonly retry?: boolean;
  /** A determinate progress ring around the icon (a loading face shows no spinner then). */
  readonly ring?: boolean;
  /** The neutral cancel of a pending operation, with this label (`labels.cancel`). */
  readonly cancel?: string;
}

export interface PuppetState {
  readonly face: PuppetFace;
  readonly mode: PuppetMode;
  /** Notifications in the stack: tails and badge in the pill, dots in the Island. Default 1. */
  readonly count?: number;
  /** The current dot in the Island. Default 0. */
  readonly current?: number;
  /** False: the stack is empty (before entering, after exiting). Default true. */
  readonly present?: boolean;
  /** Ring value 0..1, or a range the ring travels while the state is held. */
  readonly progress?: number | readonly [number, number];
  /** Calls to a control (hover tint + focus ring), 0..1. */
  readonly highlight?: number;
  /** The control the highlight sits on; by default the first one the face shows. */
  readonly focus?: PuppetControl;
  /** A restyle through the tokens (scene 3, "Fits your stack"). Default `default`. */
  readonly look?: PuppetLookId;
}

/**
 * Token restyles of the Island for "Fits your stack": what a site gets by
 * overriding `--cloudlet-*` tokens. `accent` replaces every status colour, `tint` mixes
 * it into the background, radii are px.
 */
export interface PuppetLook {
  readonly radius?: number;
  readonly control?: number;
  readonly accent?: string;
  readonly tint?: number;
}
export const PUPPET_LOOKS = {
  default: {},
  /** shadcn-like neutral: small radii, zinc instead of status colours, a faint zinc card. */
  neutral: { radius: 10, control: 6, accent: 'oklch(0.552 0.016 285.938)', tint: 0.05 },
  /** A brand: violet accent washed into the background, rounder corners. */
  brand: { radius: 30, control: 16, accent: 'oklch(0.606 0.25 292.717)', tint: 0.09 },
} as const satisfies Record<string, PuppetLook>;
export type PuppetLookId = keyof typeof PUPPET_LOOKS;

/** Spring of the shape opening (`shapeOpen` of the package's MOTION); a retarget keeps riding it. */
const SHAPE_OPEN: SpringConfig = { stiffness: 900, damping: 60, mass: 2 };

/** The package's MOTION values in seconds; springs become ease functions. */
export const PUPPET_MOTION = {
  /** `enter`: 200 ms, bounce 0.25 → a damping ratio of 0.75 settling in ~200 ms. */
  enter: { ...springEase({ stiffness: 942, damping: 46 }), scale: 0.25, offset: 1, fade: 0.16 },
  exit: 0.3,
  shapeOpen: springEase(SHAPE_OPEN),
  shapeClose: springEase({ stiffness: 900, damping: 45, mass: 1 }),
  tails: 0.15,
  chromeDelay: 0.1,
  chromeIn: 0.2,
  chromeOut: 0.07,
  chromeOffset: 4,
  headerOut: 0.2,
  headerIn: 0.26,
  blur: 6,
  bodyOut: 0.12,
  bodyIn: 0.2,
  bodyOffset: 4,
  badge: 0.2,
  badgeScale: 0.6,
  countSwap: 0.16,
  progress: 1,
  highlight: 0.2,
  /** Body slide between notifications of an open Island. */
  slide: springEase({ stiffness: 1200, damping: 60, mass: 1 }),
  /** Site-only: a token restyle eases over this long (the package has no such transition). */
  look: 0.6,
} as const;

/** Layout read from the DOM by the puppeteer. */
export interface PuppetMetrics {
  /** Content width: the Island width. */
  readonly width: number;
  readonly pillHeight: number;
  readonly islandRadius: number;
  readonly indicatorHeight: number;
  /** Size of each face layer and its icon's position in content coordinates. */
  readonly layers: ReadonlyMap<string, { readonly w: number; readonly h: number; readonly iconX: number; readonly iconY: number }>;
}

export interface Pose {
  readonly present: boolean;
  readonly key: string;
  readonly face: string;
  readonly mode: PuppetMode;
  readonly w: number;
  readonly h: number;
  readonly r: number;
  readonly tails: number;
  /** Badge number, 0 without a badge. */
  readonly badge: number;
  readonly dots: boolean;
  readonly count: number;
  readonly current: number;
  readonly progress: number | null;
  readonly highlight: number;
  readonly focus: PuppetControl;
  readonly look: PuppetLookId;
  readonly iconX: number;
  readonly iconY: number;
}

export const layerKey = (state: PuppetState) => `${state.face.id}:${state.mode}`;

/** Unique face layers in first-use order. */
export function puppetLayers(states: readonly PuppetState[]) {
  const layers = new Map<string, { readonly key: string; readonly face: PuppetFace; readonly mode: PuppetMode }>();
  for (const state of states) {
    const key = layerKey(state);
    if (!layers.has(key)) layers.set(key, { key, face: state.face, mode: state.mode });
  }
  return [...layers.values()];
}

export const puppetDots = (states: readonly PuppetState[]) =>
  Math.max(0, ...states.filter((state) => state.mode === 'island').map((state) => state.count ?? 1));

export const puppetCounts = (states: readonly PuppetState[]) =>
  [...new Set(states.filter((state) => state.mode === 'pill' && (state.count ?? 1) > 1).map((state) => state.count ?? 1))];

/** The first control a face shows: where a highlight sits unless the state says otherwise. */
export const firstControl = (face: PuppetFace): PuppetControl =>
  face.action ? 'action' : face.retry ? 'retry' : face.cancel ? 'cancel' : 'close';

const clamp01 = (value: number) => (value <= 0 ? 0 : value >= 1 ? 1 : value);
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
/** CSS `ease-out`-like curve for fades and blur swaps. */
export const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 2;
const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
};
/** Linear progress of `time` through a window that starts at `start` and lasts `length`. */
const span = (time: number, start: number, length: number) => (length <= 0 ? (time >= start ? 1 : 0) : clamp01((time - start) / length));

/** The pose of `state`; `hold` (0..1) moves a ranged progress through its range. */
export function poseOf(state: PuppetState, metrics: PuppetMetrics, hold = 0): Pose {
  const key = layerKey(state);
  const layer = metrics.layers.get(key) ?? { w: 0, h: 0, iconX: 0, iconY: 0 };
  const island = state.mode === 'island';
  const count = state.count ?? 1;
  const dots = island && count > 1;
  const w = island ? metrics.width : layer.w;
  const h = layer.h + (dots ? metrics.indicatorHeight : 0);
  const range = state.progress;
  const look = state.look ?? 'default';
  const radius = (PUPPET_LOOKS[look] as PuppetLook).radius ?? metrics.islandRadius;
  return {
    present: state.present ?? true,
    key,
    face: state.face.id,
    mode: state.mode,
    w,
    h,
    r: island ? Math.min(radius, h / 2) : h / 2,
    tails: island ? 0 : Math.min(2, count - 1),
    badge: !island && count > 1 ? count : 0,
    dots,
    count,
    current: state.current ?? 0,
    progress: range === undefined ? null : typeof range === 'number' ? range : lerp(range[0], range[1], clamp01(hold)),
    highlight: state.highlight ?? 0,
    focus: state.focus ?? firstControl(state.face),
    look,
    iconX: layer.iconX,
    iconY: layer.iconY,
  };
}

export type Highlights = Readonly<Record<PuppetControl, number>>;

export interface LayerFrame {
  readonly key: string;
  readonly heading: { readonly opacity: number; readonly blur: number; readonly x: number; readonly y: number };
  /** `x` is logical: positive towards the inline end (RTL mirrors it). */
  readonly body: { readonly opacity: number; readonly x: number; readonly y: number };
  readonly progress: number | null;
  readonly highlight: Highlights;
}

export interface Frame {
  readonly presence: { readonly opacity: number; readonly scale: number; readonly y: number };
  readonly shape: { readonly w: number; readonly h: number; readonly r: number };
  /** Tail 1 and tail 2: slot (steps out from the pill) and opacity. */
  readonly tails: readonly [{ readonly slot: number; readonly opacity: number }, { readonly slot: number; readonly opacity: number }];
  readonly badge: number;
  readonly counts: readonly { readonly count: number; readonly opacity: number; readonly blur: number }[];
  /** Visible layers only; every other layer is hidden. */
  readonly layers: readonly LayerFrame[];
  readonly close: { readonly opacity: number; readonly y: number; readonly highlight: number };
  readonly indicator: number;
  /** Visible dots (fractional while one comes or goes). */
  readonly dotCount: number;
  readonly current: number;
  /** Token restyle: from look `a` to look `b`, `t` of the way. */
  readonly look: { readonly a: PuppetLookId; readonly b: PuppetLookId; readonly t: number };
}

type Morph = 'open' | 'close' | 'adjust';
const morphOf = (a: Pose, b: Pose): Morph =>
  a.mode === 'pill' && b.mode === 'island' ? 'open' : a.mode === 'island' && b.mode === 'pill' ? 'close' : 'adjust';

/**
 * Another notification becomes current in an open Island: navigation (the current index moves) or
 * the current one was closed (fewer notifications). Its body slides: +1 brings the
 * incoming body from the inline end (towards older ones), like the package's plan. An update of
 * the same slot (same index and count) crossfades instead.
 */
export function slideOf(a: Pose, b: Pose): 0 | 1 | -1 {
  if (a.mode !== 'island' || b.mode !== 'island' || !a.present || !b.present || a.face === b.face) return 0;
  if (b.current !== a.current) return b.current > a.current ? 1 : -1;
  return b.count < a.count ? 1 : 0;
}

const highlightOf = (pose: Pose, control: PuppetControl) => (pose.focus === control ? pose.highlight : 0);
const highlights = (pose: Pose): Highlights => ({
  action: highlightOf(pose, 'action'),
  retry: highlightOf(pose, 'retry'),
  cancel: highlightOf(pose, 'cancel'),
  close: highlightOf(pose, 'close'),
});

/** Length of the transition a → b in seconds (the package's timings). */
export function transitionDuration(a: Pose, b: Pose): number {
  const m = PUPPET_MOTION;
  if (!a.present && !b.present) return 0;
  if (!a.present) return Math.max(m.enter.duration, m.enter.fade);
  if (!b.present) return m.exit;
  const morph = morphOf(a, b);
  const shape = morph === 'open' ? m.shapeOpen : m.shapeClose;
  const parts = [shape.duration];
  if (a.key !== b.key) parts.push(m.headerIn, m.bodyIn);
  if (morph === 'open') parts.push(m.chromeDelay + m.chromeIn);
  if (morph === 'close') parts.push(shape.duration - m.tails + m.badge);
  if (a.badge !== b.badge) parts.push(m.badge, m.countSwap, m.enter.duration);
  if (a.key === b.key && a.progress !== b.progress) parts.push(m.progress);
  if (a.highlight !== b.highlight || a.focus !== b.focus) parts.push(m.highlight);
  if (slideOf(a, b)) parts.push(m.slide.duration, m.headerIn);
  if (a.count !== b.count) parts.push(m.countSwap);
  if (a.look !== b.look) parts.push(m.look);
  return Math.max(...parts);
}

const tailOf = (pose: Pose, index: 1 | 2) =>
  pose.tails >= index ? { slot: index, opacity: 1 } : { slot: index - 1, opacity: 0 };

/** The frame `time` seconds into the transition a → b (a === b, or time past the end: b at rest). */
export function frameBetween(from: Pose, to: Pose, time: number): Frame {
  const m = PUPPET_MOTION;
  // An empty stack has no geometry of its own: it borrows the other side's.
  const a = from.present ? from : { ...to, present: false };
  const b = to.present ? to : { ...a, present: false };

  let presence = { opacity: 1, scale: 1, y: 0 };
  if (!a.present && !b.present) presence = { opacity: 0, scale: m.enter.scale, y: -m.enter.offset };
  else if (!a.present) {
    const s = m.enter.ease(span(time, 0, m.enter.duration));
    presence = { opacity: span(time, 0, m.enter.fade), scale: lerp(m.enter.scale, 1, s), y: lerp(-m.enter.offset, 0, s) };
  } else if (!b.present) {
    const s = easeInOut(span(time, 0, m.exit));
    presence = { opacity: 1 - s, scale: lerp(1, m.enter.scale, s), y: lerp(0, -m.enter.offset, s) };
  }

  const morph = morphOf(a, b);
  const shape = morph === 'open' ? m.shapeOpen : m.shapeClose;
  const sp = shape.ease(span(time, 0, shape.duration));
  const shapeFrame = { w: lerp(a.w, b.w, sp), h: lerp(a.h, b.h, sp), r: lerp(a.r, b.r, sp) };

  // Tails retract in the first 150 ms of opening, return in the last 150 ms of collapsing, else ride the enter spring.
  const tp =
    morph === 'open' ? easeOut(span(time, 0, m.tails))
      : morph === 'close' ? easeOut(span(time, shape.duration - m.tails, m.tails))
        : m.enter.ease(span(time, 0, m.enter.duration));
  const tails = ([1, 2] as const).map((index) => {
    const ta = tailOf(a, index);
    const tb = tailOf(b, index);
    return { slot: lerp(ta.slot, tb.slot, tp), opacity: clamp01(lerp(ta.opacity, tb.opacity, tp)) };
  }) as unknown as Frame['tails'];

  // Badge presence fades with the morph; its number blur-swaps.
  const badgeStart = morph === 'close' ? shape.duration - m.tails : 0;
  const bp = easeOut(span(time, badgeStart, m.badge));
  const badge = lerp(a.badge ? 1 : 0, b.badge ? 1 : 0, bp);
  const counts: { count: number; opacity: number; blur: number }[] = [];
  if (a.badge && b.badge && a.badge !== b.badge) {
    const out = easeOut(span(time, 0, m.countSwap));
    counts.push({ count: a.badge, opacity: 1 - out, blur: m.blur * out }, { count: b.badge, opacity: out, blur: m.blur * (1 - out) });
  } else if (b.badge || a.badge) counts.push({ count: b.badge || a.badge, opacity: 1, blur: 0 });

  const layers: LayerFrame[] = [];
  const rest = { opacity: 1, blur: 0, x: 0, y: 0 };
  const shown = (pose: Pose) => (pose.mode === 'island' ? 1 : 0);
  const progressOf = (pose: Pose) => pose.progress;
  if (a.key === b.key) {
    const pp = easeOut(span(time, 0, m.progress));
    const hp = easeOut(span(time, 0, m.highlight));
    const ha = highlights(a);
    const hb = highlights(b);
    layers.push({
      key: b.key,
      heading: rest,
      body: { opacity: shown(b), x: 0, y: 0 },
      progress: a.progress === null || b.progress === null ? b.progress : lerp(a.progress, b.progress, pp),
      highlight: {
        action: lerp(ha.action, hb.action, hp),
        retry: lerp(ha.retry, hb.retry, hp),
        cancel: lerp(ha.cancel, hb.cancel, hp),
        close: lerp(ha.close, hb.close, hp),
      },
    });
  } else {
    // Heading: the same notification moves (FLIP with the shape spring); another one blur-swaps in place.
    const same = a.face === b.face;
    const out = easeOut(span(time, 0, m.headerOut));
    const into = easeOut(span(time, 0, m.headerIn));
    const headingA = same ? { ...rest, opacity: 0 } : { opacity: 1 - out, blur: m.blur * out, x: 0, y: 0 };
    const headingB = same
      ? { opacity: 1, blur: 0, x: (a.iconX - b.iconX) * (1 - sp), y: (a.iconY - b.iconY) * (1 - sp) }
      : { opacity: into, blur: m.blur * (1 - into), x: 0, y: 0 };
    // Body: chrome timings when the shape opens or collapses; between two Island slides it slides
    // (another notification) or crossfades (the same one updated).
    let bodyA = { opacity: 0, x: 0, y: 0 };
    let bodyB = { opacity: 0, x: 0, y: 0 };
    const slide = slideOf(a, b);
    if (morph === 'open') {
      const c = easeOut(span(time, m.chromeDelay, m.chromeIn));
      bodyB = { opacity: c, x: 0, y: m.chromeOffset * (1 - c) };
    } else if (morph === 'close') {
      bodyA = { opacity: 1 - span(time, 0, m.chromeOut), x: 0, y: 0 };
    } else if (slide) {
      // The outgoing body follows the incoming one a width behind; the shell stays put.
      const into = slide * a.w * (1 - m.slide.ease(span(time, 0, m.slide.duration)));
      bodyA = { opacity: 1, x: into - slide * a.w, y: 0 };
      bodyB = { opacity: 1, x: into, y: 0 };
    } else if (a.mode === 'island') {
      const bo = easeOut(span(time, 0, m.bodyOut));
      const bi = easeOut(span(time, 0, m.bodyIn));
      bodyA = { opacity: 1 - bo, x: 0, y: 0 };
      bodyB = { opacity: bi, x: 0, y: m.bodyOffset * (1 - bi) };
    }
    layers.push(
      { key: a.key, heading: headingA, body: bodyA, progress: progressOf(a), highlight: highlights(a) },
      { key: b.key, heading: headingB, body: bodyB, progress: progressOf(b), highlight: highlights(b) },
    );
  }

  // Close button and indicator: Island chrome.
  let chrome = shown(a) && shown(b) ? 1 : 0;
  let chromeY = 0;
  if (morph === 'open') {
    chrome = easeOut(span(time, m.chromeDelay, m.chromeIn));
    chromeY = m.chromeOffset * (1 - chrome);
  } else if (morph === 'close') chrome = 1 - span(time, 0, m.chromeOut);
  const dots = morph === 'open' ? b.dots : morph === 'close' ? a.dots : a.dots || b.dots;
  const dotCount = morph === 'adjust' ? lerp(a.count, b.count, easeOut(span(time, 0, m.countSwap))) : morph === 'close' ? a.count : b.count;
  const closeHighlight = lerp(highlightOf(a, 'close'), highlightOf(b, 'close'), easeOut(span(time, 0, m.highlight)));

  return {
    presence,
    shape: shapeFrame,
    tails,
    badge,
    counts,
    layers,
    close: { opacity: chrome, y: chromeY, highlight: closeHighlight },
    indicator: dots ? chrome : 0,
    dotCount,
    current: time < transitionDuration(a, b) / 2 ? a.current : b.current,
    look: { a: a.look, b: b.look, t: a.look === b.look ? 1 : easeInOut(span(time, 0, m.look)) },
  };
}

/**
 * The transition a → b interrupted `at` seconds in and retargeted to c (the package's invariant:
 * a retarget starts from the current value and speed). Everything but the shape plays a → c;
 * the shape springs on from where a → b had it, with its velocity, towards c.
 */
export function frameRetarget(a: Pose, b: Pose, c: Pose, at: number, time: number): Frame {
  const frame = frameBetween(a, c, at + time);
  const shapeAt = (t: number) => frameBetween(a, b, Math.max(0, t)).shape;
  const dt = 1 / 120;
  const from = shapeAt(at);
  const before = shapeAt(at - dt);
  const after = shapeAt(at + dt);
  const span2 = at + dt - Math.max(0, at - dt);
  const channel = (key: 'w' | 'h' | 'r') =>
    springAt(SHAPE_OPEN, from[key], (after[key] - before[key]) / span2, c[key], Math.max(0, time));
  return { ...frame, shape: { w: channel('w'), h: channel('h'), r: channel('r') } };
}

/** Length of a retarget: the interrupted part plus the rest towards c. */
export const retargetDuration = (a: Pose, c: Pose, at: number) => at + transitionDuration(a, c);
