'use client';

import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { springEasing } from '@/lib/spring';

/** The highlight slides between segments on this spring: a hint of overshoot, settled in about 400 ms. */
const SEGMENT_SPRING = springEasing({ stiffness: 420, damping: 30 });

/** Spread on the group so `.segment-indicator` moves on the spring (CSS `linear()`, no runtime). */
export const SEGMENT_STYLE = {
  '--segment-ease': SEGMENT_SPRING.easing,
  '--segment-duration': `${SEGMENT_SPRING.duration}ms`,
} as CSSProperties;

/**
 * One highlight slides under the active segment instead of each segment fading its own background.
 * Segments are the group's descendants marked `[data-segment]`; the group must be positioned. The
 * first placement is instant ([data-segment-ready] turns the transition on a frame later), and a
 * resize (fonts, viewport) re-places the highlight.
 */
export function useSegmentIndicator<Group extends HTMLElement = HTMLDivElement>(active: number) {
  const group = useRef<Group>(null);
  const indicator = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const root = group.current;
    const pill = indicator.current;
    if (!root || !pill) return;
    const place = () => {
      const target = root.querySelectorAll<HTMLElement>('[data-segment]')[active];
      if (!target) return;
      pill.style.translate = `${target.offsetLeft}px 0`;
      pill.style.width = `${target.offsetWidth}px`;
    };
    place();
    const frame = requestAnimationFrame(() => root.setAttribute('data-segment-ready', ''));
    const observer = new ResizeObserver(place);
    observer.observe(root);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [active]);

  return { group, indicator };
}
