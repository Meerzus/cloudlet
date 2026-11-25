'use client';

import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { springRetarget, springVelocityAt, type SpringConfig } from '@/lib/spring';

/** Code longer than this many lines starts folded under Show code. */
export const DEMO_FOLD_LINES = 8;
/** Without a spring the height glides on this curve. */
const GLIDE_MS = 280;
const GLIDE_EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

interface Flight {
  readonly from: number;
  readonly to: number;
  readonly velocity: number;
  readonly started: number;
  readonly done: () => void;
}

/**
 * The height of a block of the docs glides when its content changes: `resize(change)` applies a
 * state change and moves the element from its height before to its height after. A change during a
 * glide starts from where the element is; with a spring it also keeps the speed, so a quick second
 * choice does not stop the movement. The element clips its content only while it moves. Reduced
 * motion snaps.
 */
export function useHeightGlide<Element extends HTMLElement = HTMLDivElement>(spring?: SpringConfig) {
  const ref = useRef<Element>(null);
  const flight = useRef<Flight | null>(null);

  useEffect(() => () => flight.current?.done(), []);

  const resize = (change: () => void) => {
    const element = ref.current;
    if (!element) {
      change();
      return;
    }
    const before = flight.current;
    const from = element.getBoundingClientRect().height;
    const velocity = before && spring ? springVelocityAt(spring, before.from, before.velocity, before.to, (performance.now() - before.started) / 1000) : 0;
    before?.done();
    // A glide holds an inline height: it is released before the new content is measured.
    element.style.transition = 'none';
    flushSync(change);
    const to = element.getBoundingClientRect().height;
    const motion = spring ? springRetarget(spring, from, velocity, to) : { easing: GLIDE_EASE, duration: GLIDE_MS };
    // Not `<`: a height the environment cannot measure counts as no change.
    if (!motion || !(Math.abs(from - to) >= 0.5) || !window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
      element.style.transition = '';
      return;
    }
    const overflow = element.style.overflow;
    element.style.overflow = 'hidden';
    element.style.height = `${from}px`;
    void element.offsetHeight; // commit the start height before the transition
    element.style.transition = `height ${motion.duration}ms ${motion.easing}`;
    element.style.height = `${to}px`;
    const done = () => {
      element.style.height = '';
      element.style.transition = '';
      element.style.overflow = overflow;
      element.removeEventListener('transitionend', end);
      window.clearTimeout(timer);
      flight.current = null;
    };
    const end = (event: TransitionEvent) => {
      if (event.target === element && event.propertyName === 'height') done();
    };
    const timer = window.setTimeout(done, motion.duration + 80);
    element.addEventListener('transitionend', end);
    flight.current = { from, to, velocity, started: performance.now(), done };
  };

  return { ref, resize };
}
