/**
 * jsdom has no layout or paint: React tests replace the host sampler with this
 * recorder. Completions run synchronously by default (instant presentation);
 * `hold()` queues them so a test can inspect snapshots mid-transition and then
 * `flush()` them. Real physics, timeScale and reduced motion are unit-tested in
 * tests/unit/shell-motion.test.ts and exercised in production browser checks.
 */
import type { CloudletMotionConstants } from '../../packages/toast/src/react.js';

// No import of motion.js here: tests replace that module with this mock, so importing it would deadlock.
const constants = () => ({ bodyQuiet: 0 } as unknown as CloudletMotionConstants);

export const motionControl = {
  held: false,
  calls: [] as string[],
  queue: [] as (() => void)[],
  /** Constants the host reads back (`bodyQuiet` is 0 here so each update crossfades unless a test raises it). */
  constants: constants(),
  /** Clock the host reads for update timing. */
  now: 0,
  hold() { this.held = true; },
  flush() {
    this.held = false;
    for (const done of this.queue.splice(0)) done();
  },
  reset() { this.held = false; this.calls = []; this.queue = []; this.constants = constants(); this.now = 0; },
};

function finish(done: (() => void) | undefined) {
  if (!done) return;
  if (motionControl.held) motionControl.queue.push(done); else done();
}

export function createShellMotionMock() {
  const record = (name: string) => motionControl.calls.push(name);
  return {
    setShape(_target: unknown, mode: string) { record(`shape:${mode}`); },
    enter(_edge: number, done?: () => void) { record('enter'); finish(done); },
    rise(_offset: number, _scale: number, done?: () => void) { record('rise'); finish(done); },
    exit(_edge: number, done?: () => void, fling?: { direction: number }) { record(fling ? `exit:fling:${fling.direction}` : 'exit'); finish(done); },
    hide() { record('hide'); },
    shiftHeading() { record('heading'); },
    setTails(depth: number, change: string, _previous: number, done?: () => void) { record(`tails:${change}:${depth}`); finish(done); },
    setBadge(visible: boolean) { record(`badge:${visible}`); },
    open(done?: () => void) { record('open'); finish(done); },
    collapse(depth: number, _badge: boolean, done?: { chrome?: () => void; tails?: () => void }) {
      record(`collapse:${depth}`); finish(done?.chrome); finish(done?.tails);
    },
    swap(layer: string, done?: () => void, incomingOnly = false) { record(`swap:${layer}${incomingOnly ? ':in' : ''}`); finish(done); },
    swapping() { return false; },
    get constants() { return motionControl.constants; },
    now() { return motionControl.now; },
    slide(direction: number, _width: number, done?: () => void) { record(`slide:${direction}`); finish(done); },
    drag(channel: string, value: number) { record(`drag:${channel}:${Math.round(value)}`); },
    release(channel: string, velocity: number, done?: () => void) { record(`release:${channel}:${Math.round(velocity)}`); finish(done); },
    fling(channel: string, velocity: number) { record(`fling:${channel}:${Math.round(velocity)}`); },
    setProgress() {},
    setHover() {},
    setReducedMotion(next: boolean) { record(`reduced:${next}`); },
    setTimeScale(value?: number) { if (value !== undefined) record(`timeScale:${value}`); },
    setConstants(value: { enter: { duration: number } }) { record(`constants:enter=${value.enter.duration}`); },
    running: false,
    dispose() { record('dispose'); },
  };
}
