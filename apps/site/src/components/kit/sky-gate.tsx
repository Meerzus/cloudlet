'use client';

import { useEffect, useRef } from 'react';

/**
 * Keeps the sky's own clouds out of the page while the hero covers the screen (kit.css): a point at
 * 55 % of the hero; once it has scrolled above the window the hero's `data-sky-clouds` turns `on` and
 * the clouds fade in — one attribute flip per crossing, with or without motion. Until then they are
 * not even fetched.
 *
 * The window is stretched far down (`rootMargin`), so "intersecting" means "not yet above the top":
 * a jump from below the window straight past it (an anchor, End on a short phone) still flips the
 * state, where an observer of the window alone would see two misses and stay quiet.
 */
export function SkyGate() {
  const mark = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const point = mark.current;
    const hero = point?.parentElement;
    if (!point || !hero) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        hero.setAttribute('data-sky-clouds', entry.isIntersecting ? 'off' : 'on');
      },
      { rootMargin: '0px 0px 100000px 0px' },
    );
    observer.observe(point);
    return () => observer.disconnect();
  }, []);
  return <div ref={mark} aria-hidden="true" className="kit-hero-sentinel" />;
}
