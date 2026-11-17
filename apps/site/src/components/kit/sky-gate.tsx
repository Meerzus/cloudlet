'use client';

import { useEffect, useRef } from 'react';

/**
 * Keeps the sky's own clouds out of the page while the hero covers the screen (kit.css): a point at
 * 55 % of the hero; once it has scrolled above the window the hero's `data-sky-clouds` turns `on` and
 * the clouds fade in — one attribute flip per crossing, with or without motion. Until then they are
 * not even fetched.
 */
export function SkyGate() {
  const mark = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const point = mark.current;
    const hero = point?.parentElement;
    if (!point || !hero) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      const covering = entry.isIntersecting || entry.boundingClientRect.top > 0;
      hero.setAttribute('data-sky-clouds', covering ? 'off' : 'on');
    });
    observer.observe(point);
    return () => observer.disconnect();
  }, []);
  return <div ref={mark} aria-hidden="true" className="kit-hero-sentinel" />;
}
