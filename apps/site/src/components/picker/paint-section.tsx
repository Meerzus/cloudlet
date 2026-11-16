'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { bleedOrigin } from '@/lib/paint-origin';
import { pageRamp, type RampStop } from '@/lib/picker-ramp';
import { usePickerColor } from './picker-color';
import type { SectionPaint } from './section-paint';

/** The renderer, the shader and the frame load this far ahead of the section: about a screen. */
const APPROACH = '100% 0px';

/**
 * The color picker's paint inside the section it is placed in (the section's first child), for a page
 * other than the color picker landing: the color comes from the nearest PickerColorProvider. Until the
 * section comes within about a screen of the window nothing but a flat background of the color is
 * there — no renderer, no shader, no frame; then they load (a dynamic import and the frame's
 * <picture>), and the paint spreads in over the flat color once the section is on screen. The
 * section sets the bands its paint fades in and out over (`--paint-edge-top`, `--paint-edge-bottom`,
 * picker.css) and passes the selector of its copy (`calm`) for the paper under the lines.
 */
export function PaintSection({ calm }: { calm: string }) {
  const state = usePickerColor();
  const { hex, started, change } = state;
  const ramp = pageRamp(state);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const still = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const paint = useRef<SectionPaint | null>(null);
  /** The colors now, for a paint that mounts after they changed. */
  const latest = useRef<{ hex: string; stops: readonly RampStop[] }>({ hex, stops: ramp.stops });
  latest.current = { hex, stops: ramp.stops };
  const [near, setNear] = useState(false);

  useEffect(() => {
    const section = box.current?.parentElement;
    if (!section) return;
    const approach = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        approach.disconnect();
        setNear(true);
      },
      { rootMargin: APPROACH },
    );
    approach.observe(section);
    return () => approach.disconnect();
  }, []);

  useEffect(() => {
    if (!near || !started) return;
    let alive = true;
    let mounted: SectionPaint | null = null;
    void import('./section-paint').then(({ mountSectionPaint }) => {
      const element = box.current;
      if (!alive || !element?.parentElement || !canvas.current || !still.current || !image.current) return;
      mounted = mountSectionPaint({
        box: element,
        section: element.parentElement,
        canvas: canvas.current,
        still: still.current,
        frame: image.current,
        calm,
        ...latest.current,
      });
      paint.current = mounted;
    });
    return () => {
      alive = false;
      mounted?.destroy();
      paint.current = null;
    };
  }, [near, started, calm]);

  useLayoutEffect(() => {
    const mounted = paint.current;
    const section = box.current?.parentElement;
    if (!mounted || !section) return;
    const { bleed, from } = change.current;
    // A jump with no control of its own spreads from the section's origin.
    const source = bleed ? (from ?? section.querySelector('[data-paint-origin]') ?? section) : null;
    mounted.show(hex, ramp.stops, source ? bleedOrigin(source) : null);
  }, [hex, ramp, change]);

  return (
    <div ref={box} className="paint-section" aria-hidden="true" style={{ '--paint-color': hex } as CSSProperties}>
      <canvas ref={canvas} className="paint-section-gl" />
      <canvas ref={still} className="paint-section-still" />
      {near ? (
        // Never shown: the shader (or the still frame) reads it.
        <picture hidden>
          <source type="image/avif" srcSet="/picker/material-page-640.avif 640w, /picker/material-page-1280.avif 1280w" sizes="100vw" />
          {/* eslint-disable-next-line @next/next/no-img-element -- a texture for WebGL, not an image on the page */}
          <img ref={image} src="/picker/material-page-1280.webp" srcSet="/picker/material-page-640.webp 640w, /picker/material-page-1280.webp 1280w" sizes="100vw" alt="" decoding="async" fetchPriority="low" />
        </picture>
      ) : null}
    </div>
  );
}
