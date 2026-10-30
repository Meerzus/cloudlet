import { gsap } from './gsap';
import {
  PUPPET_LOOKS,
  frameBetween,
  frameRetarget,
  layerKey,
  poseOf,
  transitionDuration,
  type Frame,
  type PuppetControl,
  type PuppetLook,
  type PuppetLookId,
  type PuppetMetrics,
  type PuppetState,
} from './puppet-model';

/**
 * The imperative side of a puppet: measures the static markup of
 * `<Puppet>` and writes frames into it. A frame is a pure function of (from, to,
 * time), so any timeline position renders identically when scrubbed either way.
 * The container may be scaled and rotated freely: all measurements are layout
 * sizes (offset*), never bounding rects.
 */

/** One step of a script: reach `state`, then hold it for `hold` seconds of timeline. */
export interface PuppetStep {
  readonly state: number;
  readonly hold: number;
  /** Stretches the transition into this step (scrubbed scenes give transitions more scroll). */
  readonly stretch?: number;
  /** A label at the centre of the hold (snap targets). */
  readonly label?: string;
  /**
   * Interrupt: the transition heads for `via.state` first and is retargeted to `state`
   * `via.at` seconds in, keeping the shape's speed.
   */
  readonly via?: { readonly state: number; readonly at: number };
}

export interface PuppetScript {
  readonly duration: number;
  /** Plateau centres by label, in timeline seconds. */
  readonly labels: ReadonlyMap<string, number>;
  /** Start and end of each step's hold. */
  readonly holds: readonly { readonly state: number; readonly start: number; readonly end: number; readonly label?: string }[];
  /** Renders the puppet at `time` seconds into the script. */
  render(time: number): void;
}

type Box = { w: number; h: number; iconX: number; iconY: number };
type LayerNodes = {
  readonly face: HTMLElement;
  readonly heading: HTMLElement;
  readonly body: HTMLElement | null;
  readonly ring: SVGCircleElement | null;
  readonly progressText: readonly HTMLElement[];
  readonly highlights: ReadonlyMap<PuppetControl, HTMLElement>;
};

/** Status tokens a look recolours, with the package values (puppet.css keeps them in sync). */
const STATUS = {
  success: 'oklch(0.723 0.219 142.136)',
  error: 'oklch(0.637 0.237 25.331)',
  info: 'oklch(0.685 0.169 237.323)',
  warning: 'oklch(0.795 0.184 86.047)',
  loading: 'oklch(0.556 0 0)',
} as const;
/** Height of an action pill, px: its resting radius is half of it. */
const CONTROL_RADIUS = 16;

const px = (value: number) => `${Math.round(value * 1000) / 1000}px`;
/** Blink lays boxes out on a 1/64 px grid; the package's indicator sits in flow, ours is translated. */
const layoutUnit = (value: number) => Math.round(value * 64) / 64;
const curve = 0.5522847498;
const round = (value: number) => String(Math.round(value * 1000) / 1000);

/** The package's silhouette formula (a rounded rectangle of quarter-circle Béziers). */
export function roundedRectPath(width: number, height: number, radius: number, x = 0, y = 0) {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const r = Math.min(Math.max(0, radius), w / 2, h / 2);
  const k = r * curve;
  const right = x + w;
  const bottom = y + h;
  const p = (px: number, py: number) => `${round(px)} ${round(py)}`;
  return [
    `M ${p(x + r, y)}`,
    `L ${p(right - r, y)}`,
    `C ${p(right - r + k, y)} ${p(right, y + r - k)} ${p(right, y + r)}`,
    `L ${p(right, bottom - r)}`,
    `C ${p(right, bottom - r + k)} ${p(right - r + k, bottom)} ${p(right - r, bottom)}`,
    `L ${p(x + r, bottom)}`,
    `C ${p(x + r - k, bottom)} ${p(x, bottom - r + k)} ${p(x, bottom - r)}`,
    `L ${p(x, y + r)}`,
    `C ${p(x, y + r - k)} ${p(x + r - k, y)} ${p(x + r, y)}`,
    'Z',
  ].join(' ');
}

export class Puppeteer {
  readonly root: HTMLElement;
  readonly states: readonly PuppetState[];
  private metrics: (PuppetMetrics & { tailOffset: number; tailScale: number; rtl: boolean }) | null = null;
  private readonly stack: HTMLElement;
  private readonly bg: SVGSVGElement;
  private readonly path: SVGPathElement;
  private readonly content: HTMLElement;
  private readonly tails: readonly HTMLElement[];
  private readonly badge: HTMLElement;
  private readonly counts: ReadonlyMap<number, HTMLElement>;
  private readonly close: HTMLElement;
  private readonly closeHighlight: HTMLElement | null;
  private restyled = false;
  private readonly indicator: HTMLElement | null;
  private readonly dots: readonly HTMLElement[];
  private readonly layers: ReadonlyMap<string, LayerNodes>;
  private readonly written = new WeakMap<Element, Record<string, string>>();

  constructor(root: HTMLElement, states: readonly PuppetState[]) {
    this.root = root;
    this.states = states;
    const one = <T extends Element>(selector: string) => {
      const element = root.querySelector<T>(selector);
      if (!element) throw new Error(`Puppet markup is missing ${selector}`);
      return element;
    };
    this.stack = one('.pp-stack');
    this.bg = one('.pp-bg');
    this.path = one('.pp-bg path');
    this.content = one('.pp-content');
    this.tails = [one<HTMLElement>('.pp-tail[data-tail="1"]'), one<HTMLElement>('.pp-tail[data-tail="2"]')];
    this.badge = one('.pp-badge');
    this.counts = new Map([...root.querySelectorAll<HTMLElement>('.pp-badge [data-count]')].map((node) => [Number(node.dataset.count), node]));
    this.close = one('.pp-close');
    this.closeHighlight = this.close.querySelector('.pp-highlight');
    this.indicator = root.querySelector('.pp-indicator');
    this.dots = [...root.querySelectorAll<HTMLElement>('.pp-dot')];
    this.layers = new Map(
      [...root.querySelectorAll<HTMLElement>('.pp-face')].map((face) => [
        face.dataset.layer ?? '',
        {
          face,
          heading: face.querySelector<HTMLElement>('.pp-heading')!,
          body: face.querySelector<HTMLElement>('.pp-body'),
          ring: face.querySelector<SVGCircleElement>('.pp-ring-fill'),
          progressText: [...face.querySelectorAll<HTMLElement>('[data-pp-progress]')],
          highlights: new Map(
            [...face.querySelectorAll<HTMLElement>('.pp-highlight')].map((node) => [node.dataset.control as PuppetControl, node]),
          ),
        },
      ]),
    );
    for (const state of states) {
      if (!this.layers.has(layerKey(state))) throw new Error(`Puppet markup has no layer ${layerKey(state)}`);
    }
  }

  /** Reads layout: call after resizes and font loads (ScrollTrigger `refreshInit`). */
  measure() {
    const style = getComputedStyle(this.root);
    const token = (name: string, fallback: number) => {
      const value = Number.parseFloat(style.getPropertyValue(name));
      return Number.isFinite(value) ? value : fallback;
    };
    const width = Number.parseFloat(getComputedStyle(this.content).width) || this.content.clientWidth;
    const layers = new Map<string, Box>();
    for (const [key, nodes] of this.layers) {
      const { face } = nodes;
      // Used (fractional) sizes: offset* rounds, and rects would include the container's transforms.
      const size = getComputedStyle(face);
      const w = Number.parseFloat(size.width) || face.offsetWidth;
      const h = Number.parseFloat(size.height) || face.offsetHeight;
      const left = face.dataset.mode === 'pill' ? (width - w) / 2 : 0;
      face.style.left = px(left);
      const icon = face.querySelector<HTMLElement>('.pp-icon');
      layers.set(key, { w, h, iconX: left + (icon?.offsetLeft ?? 0), iconY: icon?.offsetTop ?? 0 });
    }
    this.metrics = {
      width,
      pillHeight: token('--cloudlet-pill-height', 44),
      islandRadius: token('--cloudlet-island-radius', 24),
      indicatorHeight: this.indicator?.offsetHeight ?? 0,
      tailOffset: token('--cloudlet-tail-offset', 4),
      tailScale: token('--cloudlet-tail-scale', 0.9),
      rtl: style.direction === 'rtl',
      layers,
    };
    this.root.dataset.ready = '';
    return this.metrics;
  }

  private get m() {
    return this.metrics ?? this.measure();
  }

  pose(index: number, hold = 0) {
    const state = this.states[index];
    if (!state) throw new RangeError(`No puppet state ${index}`);
    return poseOf(state, this.m, hold);
  }

  /** Height of the tallest state, tails included: reserve it to avoid layout shift. */
  get height() {
    const { tailOffset } = this.m;
    return Math.max(...this.states.map((_, index) => this.pose(index).h)) + 2 * tailOffset;
  }

  /** Seconds the transition a → b lasts at stretch 1. */
  duration(a: number, b: number) {
    return transitionDuration(this.pose(a), this.pose(b));
  }

  /** Shows `index` at rest; `hold` moves a ranged progress (0..1). */
  set(index: number, hold = 0) {
    const pose = this.pose(index, hold);
    this.write(frameBetween(pose, pose, Infinity));
  }

  /** Renders `time` seconds into the transition a → b. */
  render(a: number, b: number, time: number) {
    this.write(frameBetween(this.pose(a, 1), this.pose(b, 0), time));
  }

  /** Renders `time` seconds after a → b was retargeted to c `at` seconds in. */
  retarget(a: number, b: number, c: number, at: number, time: number) {
    this.write(frameRetarget(this.pose(a, 1), this.pose(b, 0), this.pose(c, 0), at, time));
  }

  /** Seconds a transition into `to` lasts at stretch 1, an interrupted one included. */
  stepDuration(from: number, to: number, via?: PuppetStep['via']) {
    return via ? via.at + this.duration(from, to) : this.duration(from, to);
  }

  /** Renders `time` seconds into the transition `from` → `to` (through `via` when interrupted). */
  renderStep(from: number, to: number, time: number, via?: PuppetStep['via']) {
    if (!via) this.render(from, to, time);
    else if (time < via.at) this.render(from, via.state, time);
    else this.retarget(from, via.state, to, via.at, time - via.at);
  }

  /** Lays out steps on a timeline of seconds; `render(t)` is then a pure function of t. */
  script(steps: readonly PuppetStep[]): PuppetScript {
    type Segment =
      | { kind: 'move'; from: number; to: number; start: number; length: number; stretch: number; via?: PuppetStep['via'] }
      | { kind: 'hold'; state: number; start: number; length: number };
    const segments: Segment[] = [];
    const holds: { state: number; start: number; end: number; label?: string }[] = [];
    const labels = new Map<string, number>();
    let time = 0;
    let previous: number | null = null;
    for (const step of steps) {
      if (previous !== null) {
        const stretch = step.stretch ?? 1;
        const length = this.stepDuration(previous, step.state, step.via) * stretch;
        segments.push({ kind: 'move', from: previous, to: step.state, start: time, length, stretch, ...(step.via ? { via: step.via } : {}) });
        time += length;
      }
      segments.push({ kind: 'hold', state: step.state, start: time, length: step.hold });
      holds.push({ state: step.state, start: time, end: time + step.hold, ...(step.label ? { label: step.label } : {}) });
      if (step.label) labels.set(step.label, time + step.hold / 2);
      time += step.hold;
      previous = step.state;
    }
    const duration = time;
    return {
      duration,
      labels,
      holds,
      render: (at: number) => {
        const t = Math.min(Math.max(at, 0), duration);
        const segment = segments.find((item) => t < item.start + item.length) ?? segments.at(-1);
        if (!segment) return;
        if (segment.kind === 'hold') this.set(segment.state, segment.length > 0 ? (t - segment.start) / segment.length : 1);
        else this.renderStep(segment.from, segment.to, (t - segment.start) / segment.stretch, segment.via);
      },
    };
  }

  /**
   * A paused-or-playing GSAP timeline that plays the script (one linear driver tween,
   * labels at plateau centres): drop it into a ScrollTrigger or a parent timeline.
   */
  timeline(steps: readonly PuppetStep[], vars: gsap.TimelineVars = {}) {
    const script = this.script(steps);
    const driver = { t: 0 };
    const timeline = gsap.timeline(vars);
    timeline.to(driver, { t: script.duration, duration: script.duration, ease: 'none', onUpdate: () => script.render(driver.t) }, 0);
    for (const [label, at] of script.labels) timeline.addLabel(label, at);
    script.render(0);
    return timeline;
  }

  private css(element: Element, values: Record<string, string>) {
    const last = this.written.get(element) ?? {};
    const style = (element as HTMLElement).style;
    for (const [name, value] of Object.entries(values)) {
      if (last[name] === value) continue;
      style.setProperty(name, value);
      last[name] = value;
    }
    this.written.set(element, last);
  }

  private attr(element: Element, name: string, value: string) {
    const last = this.written.get(element) ?? {};
    if (last[`@${name}`] === value) return;
    element.setAttribute(name, value);
    last[`@${name}`] = value;
    this.written.set(element, last);
  }

  private write(frame: Frame) {
    const m = this.m;
    const { w, h } = frame.shape;
    const r = Math.min(Math.max(0, frame.shape.r), w / 2, h / 2);
    const left = (m.width - w) / 2;

    this.css(this.stack, {
      opacity: String(frame.presence.opacity),
      transform: `translateY(${px(frame.presence.y)}) scale(${round(frame.presence.scale)})`,
    });
    this.attr(this.bg, 'width', round(w));
    this.attr(this.bg, 'height', round(h));
    this.attr(this.path, 'd', roundedRectPath(w, h, r));
    this.css(this.bg, { left: px(left), 'border-radius': px(r) });
    this.css(this.content, { 'clip-path': `path("${roundedRectPath(w, h, r, left, 0)}")` });

    frame.tails.forEach((tail, index) => {
      const node = this.tails[index]!;
      this.css(node, {
        width: px(w),
        height: px(Math.min(h, m.pillHeight)),
        opacity: String(tail.opacity),
        transform: `translateX(-50%) translateY(${px(tail.slot * m.tailOffset)}) scale(${round(m.tailScale ** tail.slot)})`,
      });
    });

    const badgeX = (w / 2 - 10) * (m.rtl ? -1 : 1);
    this.css(this.badge, {
      opacity: String(frame.badge),
      transform: `translate(calc(${px(badgeX)} - 50%), -6px) scale(${round(0.6 + 0.4 * frame.badge)})`,
    });
    for (const [count, node] of this.counts) {
      const shown = frame.counts.find((item) => item.count === count);
      this.css(node, { opacity: String(shown?.opacity ?? 0), filter: `blur(${px(shown?.blur ?? 0)})` });
    }

    for (const [key, nodes] of this.layers) {
      const shown = frame.layers.find((layer) => layer.key === key);
      const heading = shown?.heading ?? { opacity: 0, blur: 0, x: 0, y: 0 };
      this.css(nodes.heading, {
        opacity: String(heading.opacity),
        filter: heading.blur ? `blur(${px(heading.blur)})` : 'none',
        transform: heading.x || heading.y ? `translate(${px(heading.x)}, ${px(heading.y)})` : 'none',
      });
      if (nodes.body) {
        const body = shown?.body ?? { opacity: 0, x: 0, y: 0 };
        const x = m.rtl ? -body.x : body.x;
        this.css(nodes.body, { opacity: String(body.opacity), transform: x || body.y ? `translate(${px(x)}, ${px(body.y)})` : 'none' });
      }
      const progress = shown?.progress;
      if (progress !== null && progress !== undefined) {
        if (nodes.ring) this.attr(nodes.ring, 'stroke-dasharray', `${round(progress * 100)} 100`);
        for (const text of nodes.progressText) {
          const value = `${Math.round(progress * 100)}%`;
          if (text.textContent !== value) text.textContent = value;
        }
      }
      for (const [control, highlight] of nodes.highlights) this.css(highlight, { opacity: String(shown?.highlight[control] ?? 0) });
    }

    this.css(this.close, { opacity: String(frame.close.opacity), transform: frame.close.y ? `translateY(${px(frame.close.y)})` : 'none' });
    if (this.closeHighlight) this.css(this.closeHighlight, { opacity: String(frame.close.highlight) });
    if (this.indicator) {
      this.css(this.indicator, { opacity: String(frame.indicator), transform: `translateY(${px(layoutUnit(h - m.indicatorHeight))})` });
      this.dots.forEach((dot, index) => {
        dot.toggleAttribute('data-current', index === frame.current);
        // A dot that comes or goes folds its box (and the gap before it) so the row stays centred.
        const shown = Math.min(1, Math.max(0, frame.dotCount - index));
        const box = dot.parentElement!;
        this.css(box, shown >= 1 ? { width: '', opacity: '', 'margin-inline-start': '' } : {
          width: px(24 * shown),
          opacity: String(shown),
          'margin-inline-start': index > 0 ? px(-8 * (1 - shown)) : '0px',
        });
      });
    }
    this.restyle(frame.look);
  }

  /** Token restyle (scene 3, "Fits your stack"): recolours and rounds the Island through CSS variables. */
  private restyle({ a, b, t }: Frame['look']) {
    const names = ['--pp-control-radius', '--cloudlet-background', ...Object.keys(STATUS).map((kind) => `--cloudlet-${kind}`)];
    if (a === 'default' && b === 'default') {
      if (this.restyled) for (const name of names) this.css(this.root, { [name]: '' });
      this.restyled = false;
      return;
    }
    this.restyled = true;
    const look = (id: PuppetLookId): PuppetLook => PUPPET_LOOKS[id];
    const la = look(a);
    const lb = look(b);
    const mix = (from: string, to: string) => (t >= 1 ? to : t <= 0 ? from : `color-mix(in oklab, ${to} ${round(t * 100)}%, ${from})`);
    const values: Record<string, string> = {
      '--pp-control-radius': px((la.control ?? CONTROL_RADIUS) + ((lb.control ?? CONTROL_RADIUS) - (la.control ?? CONTROL_RADIUS)) * t),
    };
    for (const [kind, base] of Object.entries(STATUS)) values[`--cloudlet-${kind}`] = mix(la.accent ?? base, lb.accent ?? base);
    const tint = (la.tint ?? 0) + ((lb.tint ?? 0) - (la.tint ?? 0)) * t;
    // The theme's surface by reference, so a theme switch under a look repaints it.
    const surface = 'var(--pp-surface)';
    const accent = mix(la.accent ?? surface, lb.accent ?? surface);
    values['--cloudlet-background'] = tint > 0 ? `color-mix(in oklab, ${accent} ${round(tint * 100)}%, ${surface})` : surface;
    this.css(this.root, values);
  }
}
