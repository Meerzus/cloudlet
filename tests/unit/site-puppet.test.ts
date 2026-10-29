import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PUPPET_LOOKS,
  PUPPET_MOTION,
  firstControl,
  frameBetween,
  frameRetarget,
  poseOf,
  slideOf,
  puppetCounts,
  puppetDots,
  puppetLayers,
  transitionDuration,
  type PuppetFace,
  type PuppetMetrics,
  type PuppetState,
} from '../../apps/site/src/lib/puppet-model';
import { roundedRectPath } from '../../apps/site/src/lib/puppeteer';
import { createRoundedRectPath } from '../../packages/toast/src/react/shape';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** `--cloudlet-*` declarations of the first rule whose selector starts with `selector`. */
function tokens(css: string, selector: string) {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--cloudlet-[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value!.trim()]));
}

describe('site puppets: fidelity to the package', () => {
  const pkg = read('packages/toast/src/styles.css');
  const puppet = read('apps/site/src/components/puppets/puppet.css');

  it('copies every light token it uses with the package value', () => {
    const own = tokens(puppet, '.puppet {');
    const source = tokens(pkg, '.cloudlet-host {');
    expect(Object.keys(own).length).toBeGreaterThan(20);
    for (const [name, value] of Object.entries(own)) expect(value, name).toBe(source[name]);
  });

  it('copies the dark theme values', () => {
    const own = tokens(puppet, ':is(.dark .puppet');
    const source = tokens(pkg, '.cloudlet-host[data-theme="dark"] {');
    expect(own).toEqual(source);
  });

  it('draws the package glyphs and silhouette', () => {
    const card = read('packages/toast/src/react/card.tsx');
    const markup = read('apps/site/src/components/puppets/puppet.tsx');
    const paths = (source: string) => [...source.matchAll(/(?:success|error|info|warning): '([^']+)'/g)].map(([, d]) => d);
    expect(paths(markup)).toEqual(paths(card));
    expect(markup).toContain("'m4.5 4.5 7 7m0-7-7 7'");
    expect(card).toContain("'m4.5 4.5 7 7m0-7-7 7'");
    for (const [w, h, r, x, y] of [[207.39, 44, 22, 104.3, 0], [416, 112.5, 24, 0, 0], [10, 4, 99, 0, 0]] as const) {
      expect(roundedRectPath(w, h, r, x, y)).toBe(createRoundedRectPath(w, h, r, x, y));
    }
  });

  it('slides with the package spring and orders controls like it (action, retry, cancel)', () => {
    const motion = read('packages/toast/src/react/motion.ts');
    expect(motion).toContain('slide: { stiffness: 1200, damping: 60, mass: 1 }');
    const model = read('apps/site/src/lib/puppet-model.ts');
    expect(model).toContain("slide: springEase({ stiffness: 1200, damping: 60, mass: 1 })");
    const card = read('packages/toast/src/react/card.tsx');
    expect(card.indexOf("control('retry'")).toBeLessThan(card.indexOf("control('cancel'"));
  });

  it('recolours looks from the package status values', () => {
    const own = tokens(puppet, '.puppet {');
    const source = read('apps/site/src/lib/puppeteer.ts');
    for (const kind of ['success', 'error', 'info', 'warning', 'loading']) {
      expect(source, kind).toContain(`${kind}: '${own[`--cloudlet-${kind}`]}'`);
    }
  });
});

const SYNCED: PuppetFace = { id: 'synced', kind: 'success', title: 'Synced to the cloud' };
const STORM: PuppetFace = { id: 'storm', kind: 'warning', title: 'Storm ahead', description: 'Only 3% left.', action: 'Upgrade' };
const UPLOAD: PuppetFace = { id: 'upload', kind: 'loading', title: 'Uploading', ring: true };

const STATES: PuppetState[] = [
  { face: SYNCED, mode: 'pill', present: false },
  { face: SYNCED, mode: 'pill' },
  { face: STORM, mode: 'pill', count: 3 },
  { face: STORM, mode: 'island', count: 3 },
  { face: UPLOAD, mode: 'island', count: 3, progress: [0.1, 0.9] },
];

const METRICS: PuppetMetrics = {
  width: 416,
  pillHeight: 44,
  islandRadius: 24,
  indicatorHeight: 30,
  layers: new Map([
    ['synced:pill', { w: 180, h: 44, iconX: 128, iconY: 10 }],
    ['storm:pill', { w: 200, h: 44, iconX: 118, iconY: 10 }],
    ['storm:island', { w: 416, h: 90, iconX: 14, iconY: 12 }],
    ['upload:island', { w: 416, h: 54, iconX: 14, iconY: 12 }],
  ]),
};
const pose = (index: number, hold = 0) => poseOf(STATES[index]!, METRICS, hold);

describe('site puppets: model', () => {
  it('derives layers, dots and badge numbers from the states', () => {
    expect(puppetLayers(STATES).map((layer) => layer.key)).toEqual(['synced:pill', 'storm:pill', 'storm:island', 'upload:island']);
    expect(puppetDots(STATES)).toBe(3);
    expect(puppetCounts(STATES)).toEqual([3]);
  });

  it('poses the pill, the stack and the Island like the package', () => {
    expect(pose(1)).toMatchObject({ w: 180, h: 44, r: 22, tails: 0, badge: 0 });
    expect(pose(2)).toMatchObject({ w: 200, h: 44, tails: 2, badge: 3 });
    expect(pose(3)).toMatchObject({ w: 416, h: 120, r: 24, tails: 0, badge: 0, dots: true });
    expect(pose(4, 0.5).progress).toBeCloseTo(0.5);
  });

  it('starts at the first pose and ends at the second for every transition', () => {
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 4], [3, 2]] as const) {
      const start = frameBetween(pose(a, 1), pose(b), 0);
      const end = frameBetween(pose(a, 1), pose(b), transitionDuration(pose(a, 1), pose(b)));
      const rest = frameBetween(pose(b), pose(b), Infinity);
      expect(end.shape.w).toBeCloseTo(rest.shape.w, 1);
      expect(end.shape.h).toBeCloseTo(rest.shape.h, 1);
      expect(end.badge).toBeCloseTo(rest.badge, 3);
      expect(end.close.opacity).toBeCloseTo(rest.close.opacity, 3);
      if (a !== 0) expect(start.shape.w).toBeCloseTo(pose(a).w, 3);
    }
  });

  it('grows the first pill out of a quarter scale', () => {
    const start = frameBetween(pose(0), pose(1), 0);
    expect(start.presence).toEqual({ opacity: 0, scale: PUPPET_MOTION.enter.scale, y: -PUPPET_MOTION.enter.offset });
    expect(frameBetween(pose(0), pose(1), PUPPET_MOTION.enter.fade).presence.opacity).toBe(1);
  });

  it('moves the same notification into the Island and blur-swaps another one', () => {
    const open = frameBetween(pose(2), pose(3), 0);
    const island = open.layers.find((layer) => layer.key === 'storm:island')!;
    expect(island.heading).toMatchObject({ opacity: 1, blur: 0, x: 118 - 14, y: 10 - 12 });
    expect(open.layers.find((layer) => layer.key === 'storm:pill')!.heading.opacity).toBe(0);
    expect(open.tails.map((tail) => tail.opacity)).toEqual([1, 1]);

    const swap = frameBetween(pose(1), pose(2), PUPPET_MOTION.headerOut / 2);
    const out = swap.layers.find((layer) => layer.key === 'synced:pill')!.heading;
    const into = swap.layers.find((layer) => layer.key === 'storm:pill')!.heading;
    expect(out.blur).toBeGreaterThan(0);
    expect(into.blur).toBeGreaterThan(0);
    expect(out.opacity + into.opacity).toBeGreaterThan(0.5);
  });

  it('delays the Island chrome on opening and drops it fast on collapsing', () => {
    expect(frameBetween(pose(2), pose(3), PUPPET_MOTION.chromeDelay).close.opacity).toBe(0);
    expect(frameBetween(pose(2), pose(3), PUPPET_MOTION.chromeDelay + PUPPET_MOTION.chromeIn).close.opacity).toBe(1);
    expect(frameBetween(pose(3), pose(2), PUPPET_MOTION.chromeOut).close.opacity).toBe(0);
  });
});

const READY: PuppetFace = { id: 'ready', kind: 'info', title: 'Ready', description: 'Album', action: 'Upload' };
const SAVED: PuppetFace = { id: 'saved', kind: 'success', title: 'Saved', description: 'Album' };
const SYNCING: PuppetFace = { id: 'syncing', kind: 'loading', title: 'Syncing', cancel: 'Cancel' };
const ISLANDS = new Map([
  ...METRICS.layers,
  ['ready:island', { w: 416, h: 96, iconX: 14, iconY: 12 }],
  ['ready:pill', { w: 190, h: 44, iconX: 123, iconY: 10 }],
  ['saved:island', { w: 416, h: 70, iconX: 14, iconY: 12 }],
  ['syncing:island', { w: 416, h: 90, iconX: 14, iconY: 12 }],
]);
const M2: PuppetMetrics = { ...METRICS, layers: ISLANDS };
const at = (state: PuppetState, hold = 0) => poseOf(state, M2, hold);

describe('site puppets: scene 3 abilities', () => {
  const ready = at({ face: READY, mode: 'island', count: 3 });
  const saved = at({ face: SAVED, mode: 'island', count: 3, current: 1 });

  it('slides the body to another notification and crossfades an update of the same one', () => {
    expect(slideOf(ready, saved)).toBe(1);
    expect(slideOf(saved, ready)).toBe(-1);
    // Closing the current one: fewer notifications, the next older takes its place.
    expect(slideOf(saved, at({ face: READY, mode: 'island', count: 2, current: 1 }))).toBe(1);
    // Scene 2's updates keep crossfading: same index, same count.
    expect(slideOf(pose(3), pose(4))).toBe(0);

    const start = frameBetween(ready, saved, 0);
    const into = start.layers.find((layer) => layer.key === 'saved:island')!;
    const out = start.layers.find((layer) => layer.key === 'ready:island')!;
    expect(into.body).toMatchObject({ opacity: 1, x: 416 });
    expect(out.body).toMatchObject({ opacity: 1, x: 0 });
    const end = frameBetween(ready, saved, PUPPET_MOTION.slide.duration);
    expect(end.layers.find((layer) => layer.key === 'saved:island')!.body.x).toBeCloseTo(0, 0);
    // The shell stays put: only the height adjusts.
    expect(start.shape.w).toBe(end.shape.w);
    expect(transitionDuration(ready, saved)).toBeGreaterThanOrEqual(PUPPET_MOTION.slide.duration);
  });

  it('folds a dot away when the current notification closes', () => {
    const closed = at({ face: READY, mode: 'island', count: 2, current: 1 });
    expect(frameBetween(saved, closed, 0).dotCount).toBe(3);
    expect(frameBetween(saved, closed, PUPPET_MOTION.countSwap).dotCount).toBe(2);
  });

  it('puts the highlight on one control: the first by default, or the one in focus', () => {
    expect(firstControl(READY)).toBe('action');
    expect(firstControl(SYNCING)).toBe('cancel');
    expect(firstControl(SYNCED)).toBe('close');
    const cancel = frameBetween(at({ face: SYNCING, mode: 'island' }), at({ face: SYNCING, mode: 'island', highlight: 1 }), PUPPET_MOTION.highlight);
    expect(cancel.layers[0]!.highlight).toEqual({ action: 0, retry: 0, cancel: 1, close: 0 });
    const close = frameBetween(saved, at({ face: SAVED, mode: 'island', count: 3, current: 1, highlight: 1, focus: 'close' }), PUPPET_MOTION.highlight);
    expect(close.close.highlight).toBe(1);
    expect(close.layers[0]!.highlight.action).toBe(0);
  });

  it('restyles through tokens: radius from the look, colours eased in', () => {
    const brand = at({ face: READY, mode: 'island', look: 'brand' });
    expect(brand.r).toBe(PUPPET_LOOKS.brand.radius);
    const half = frameBetween(at({ face: READY, mode: 'island' }), brand, PUPPET_MOTION.look / 2);
    expect(half.look.a).toBe('default');
    expect(half.look.b).toBe('brand');
    expect(half.look.t).toBeGreaterThan(0);
    expect(half.look.t).toBeLessThan(1);
    expect(half.shape.r).toBeGreaterThan(24);
  });

  it('retargets an interrupted opening from its current shape and speed', () => {
    const pill = at({ face: READY, mode: 'pill' }, 1);
    const open = at({ face: READY, mode: 'island' });
    const taller = at({ face: READY, mode: 'island', count: 2, current: 1 });
    const tau = 0.12;
    const before = frameBetween(pill, open, tau).shape;
    const start = frameRetarget(pill, open, taller, tau, 0).shape;
    expect(start.w).toBeCloseTo(before.w, 6);
    expect(start.h).toBeCloseTo(before.h, 6);
    // No jump in speed either: one frame later it has moved as far as the uninterrupted spring would.
    const dt = 1 / 120;
    const next = frameRetarget(pill, open, taller, tau, dt).shape;
    const free = frameBetween(pill, open, tau + dt).shape;
    expect(next.w - start.w).toBeCloseTo(free.w - before.w, 0);
    const settled = frameRetarget(pill, open, taller, tau, 2).shape;
    expect(settled.h).toBeCloseTo(taller.h, 1);
    expect(settled.w).toBeCloseTo(taller.w, 1);
  });
});
