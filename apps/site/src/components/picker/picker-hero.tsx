'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ColorPickerPanel } from '@/components/ui/color-picker/color-picker';
import { flatLut, flatOf, rampLut } from '@/lib/picker-ramp';
import { MaterialRenderer, type MaterialLayout, type Rect } from './material-renderer';
import { CALM_RECTS } from './material-shader';
import { usePickerColor } from './picker-color';

/** Phones take the tall frame and stack the panel under the copy (§8.4). picker.css and the <source> media say the same. */
const PHONE = '(max-width: 639px)';
const REDUCED = '(prefers-reduced-motion: reduce)';
/** The panel's corner radius (color-picker.css: 1.25rem), for the bleed's origin. */
const PANEL_RADIUS = 20;
/** Room left round the copy before its calm zone starts to fade, CSS px. */
const CALM_PAD = 16;

/** The line boxes of an element's text: the calm zone follows the words, not their blocks. */
function lines(element: Element): DOMRect[] {
  const boxes: DOMRect[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    boxes.push(...[...range.getClientRects()].filter((rect) => rect.width > 1 && rect.height > 1));
  }
  return boxes;
}

const relative = (box: DOMRect, to: DOMRect, pad = 0): Rect => ({ x: box.left - to.left - pad, y: box.top - to.top - pad, width: box.width + pad * 2, height: box.height + pad * 2 });

/**
 * The landing's hero (COLOR_PICKER §8.2–8.4): a generated airbrush frame recolored by the page's
 * color (PickerColorProvider) through a ramp, flowing slowly, with the picker panel open beside the
 * headline. Dragging a handle repaints at once; a jump (typing, the eyedropper) and the frame's
 * arrival spread out of the panel. Without WebGL 2 the flat background of picker.css stays.
 */
export function PickerHero() {
  const { value, hex, ramp, started, bleed, pick } = usePickerColor();
  const [flat, setFlat] = useState(false);
  const [ready, setReady] = useState(false);
  const section = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const renderer = useRef<MaterialRenderer | null>(null);
  /** The frame has been shown once: its first appearance always bleeds, later ones follow `bleed`. */
  const shown = useRef(false);

  // The renderer: created once the start color is known, its first (flat) frame drawn before paint.
  useLayoutEffect(() => {
    const element = canvas.current;
    const host = section.current;
    if (!started || !element || !host) return;
    const instance = MaterialRenderer.create(element, { lut: flatLut(flatOf(hex)!), invert: false });
    if (!instance) {
      setFlat(true);
      return;
    }
    renderer.current = instance;
    const reduced = window.matchMedia(REDUCED);
    const phone = window.matchMedia(PHONE);
    const motion = () => instance.setMoving(!reduced.matches);
    motion();
    reduced.addEventListener('change', motion);

    const measure = () => {
      const box = element.getBoundingClientRect();
      const target = panel.current?.querySelector('.color-picker-inline')?.getBoundingClientRect();
      if (!target || box.width === 0) return;
      const header = document.querySelector('.site-header')?.getBoundingClientRect();
      const calm = header ? [relative(header, box)] : [];
      const words = copy.current ? lines(copy.current).map((line) => relative(line, box, CALM_PAD)) : [];
      // More lines than the shader takes (a narrow window): the last rectangle covers the rest.
      const room = CALM_RECTS - calm.length;
      calm.push(...words.slice(0, room - 1));
      const rest = words.slice(room - 1);
      if (rest.length) {
        const left = Math.min(...rest.map((rect) => rect.x));
        const top = Math.min(...rest.map((rect) => rect.y));
        calm.push({ x: left, y: top, width: Math.max(...rest.map((rect) => rect.x + rect.width)) - left, height: Math.max(...rest.map((rect) => rect.y + rect.height)) - top });
      }
      const layout: MaterialLayout = {
        width: box.width,
        height: box.height,
        // Desktop: the paper at the frame's left stays under the copy. Phone: the tall frame's paper is its top.
        focus: phone.matches ? { x: 0.5, y: 0 } : { x: 0.1, y: 0.5 },
        origin: { ...relative(target, box), radius: PANEL_RADIUS },
        calm,
      };
      instance.setLayout(layout);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(host);
    if (copy.current) resize.observe(copy.current);

    // The frame: the <picture> picks its width and format (and the tall one on a phone); a change of either reloads it.
    const img = image.current;
    let alive = true;
    const load = () => {
      if (!img?.complete || img.naturalWidth === 0) return;
      img
        .decode()
        .then(() => {
          if (!alive) return;
          instance.setFrame(img, img.naturalWidth, img.naturalHeight);
          measure();
          setReady(true);
        })
        .catch(() => {});
    };
    img?.addEventListener('load', load);
    load();

    let onScreen = true;
    const sync = () => instance.setActive(onScreen && document.visibilityState === 'visible');
    const view = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      sync();
    });
    view.observe(element);
    document.addEventListener('visibilitychange', sync);
    const lost = (event: Event) => {
      event.preventDefault();
      setFlat(true);
    };
    element.addEventListener('webglcontextlost', lost);
    return () => {
      alive = false;
      reduced.removeEventListener('change', motion);
      resize.disconnect();
      view.disconnect();
      img?.removeEventListener('load', load);
      document.removeEventListener('visibilitychange', sync);
      element.removeEventListener('webglcontextlost', lost);
      instance.destroy();
      renderer.current = null;
    };
    // The color at start time only seeds the first frame; later colors go through the effect below.
  }, [started]);

  useLayoutEffect(() => {
    const instance = renderer.current;
    if (!started || !instance) return;
    if (!ready) {
      instance.paint({ lut: flatLut(flatOf(hex)!), invert: false }, false);
      return;
    }
    const still = window.matchMedia(REDUCED).matches;
    instance.paint({ lut: rampLut(ramp.stops), invert: ramp.invert }, (bleed.current || !shown.current) && !still);
    shown.current = true;
  }, [hex, ramp, ready, started, bleed]);

  // The header reads the hero's ink while the hero is under it.
  useEffect(() => {
    const host = section.current;
    if (!host) return;
    const root = document.documentElement;
    const observer = new IntersectionObserver(([entry]) => root.toggleAttribute('data-cp-top', entry?.isIntersecting ?? false), { rootMargin: '0px 0px -100% 0px' });
    observer.observe(host);
    return () => {
      observer.disconnect();
      root.removeAttribute('data-cp-top');
    };
  }, []);

  return (
    <section
      ref={section}
      id="hero"
      aria-labelledby="hero-title"
      className="cp-hero"
      data-flat={flat || undefined}
      data-ready={(ready && !flat) || undefined}
      data-started={started || undefined}
    >
      <canvas ref={canvas} className="cp-hero-canvas" aria-hidden="true" />
      {/* Never shown: the shader reads it. */}
      <picture hidden>
        <source media={PHONE} type="image/avif" srcSet="/picker/material-hero-tall-720.avif 720w, /picker/material-hero-tall-1440.avif 1440w" sizes="100vw" />
        <source media={PHONE} type="image/webp" srcSet="/picker/material-hero-tall-720.webp 720w, /picker/material-hero-tall-1440.webp 1440w" sizes="100vw" />
        <source type="image/avif" srcSet="/picker/material-hero-1280.avif 1280w, /picker/material-hero-2560.avif 2560w" sizes="100vw" />
        {/* eslint-disable-next-line @next/next/no-img-element -- a texture for WebGL, not an image on the page */}
        <img ref={image} src="/picker/material-hero-1280.webp" srcSet="/picker/material-hero-1280.webp 1280w, /picker/material-hero-2560.webp 2560w" sizes="100vw" alt="" decoding="async" />
      </picture>
      <div className="cp-hero-inner">
        <div ref={copy} className="cp-hero-copy">
          <h1 id="hero-title" className="cp-hero-title">
            pick a color,
            <br />
            paint the page
          </h1>
          <p className="cp-hero-lede">
            A color picker for React: hex, rgb, hsl and oklch, an eyedropper and full keyboard support. One shadcn item, no
            dependencies.
          </p>
        </div>
        <div ref={panel} className="cp-hero-panel" role="group" aria-label="Page color">
          <ColorPickerPanel color={value} onChange={pick} />
        </div>
      </div>
    </section>
  );
}
