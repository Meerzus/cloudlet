'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ColorPicker } from '@/components/ui/color-picker/color-picker';
import { parseColor } from '@/components/ui/color-picker/color';
import { flatSky, landscapeFor, START_COLORS, START_GLOBAL, startColor, type Landscape } from '@/lib/landscape';
import { flatPaint, LandscapeRenderer, paintOf, type LandscapeLayout } from './landscape-renderer';

/** Phones get a lower lake and hills, the disc a little below the centre (§8.2). */
const PHONE = '(max-width: 639px)';
const URL_DELAY = 250;

const rgbOf = (color: string): [number, number, number] => {
  const rgb = parseColor(color) ?? { r: 0, g: 0, b: 0 };
  return [rgb.r, rgb.g, rgb.b];
};

/** The page's color lives on <html>: the flat sky, the ink and (later) the tint of the other sections read it from there. */
function publish(landscape: Landscape) {
  const root = document.documentElement;
  root.style.setProperty('--cp-color', landscape.hex);
  root.setAttribute('data-cp-hour', landscape.hour);
}

/** `?c=` follows the color, without a history entry per change (like the style editor's URL). */
function writeUrl(hex: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('c', hex.slice(1));
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/**
 * The landing's hero (COLOR_PICKER §8.2–8.4): a paper landscape in one shader, recolored by the
 * picked color. The sun (or the moon) is the ColorPicker's swatch, so the picker morphs out of it
 * over the landscape. Dragging a handle repaints at once; a jump (typing, the eyedropper, the start)
 * bleeds out of the disc. Without WebGL 2 the flat sky of picker.css stays.
 */
export function PickerHero() {
  // The server renders the first curated color; the start script has already painted the real one on <html>.
  const [value, setValue] = useState<string>(START_COLORS[0]);
  const [started, setStarted] = useState(false);
  const [flat, setFlat] = useState(false);
  const section = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const disc = useRef<HTMLDivElement>(null);
  const renderer = useRef<LandscapeRenderer | null>(null);
  /** How the next landscape arrives: at once while a slider has focus, bleeding otherwise. */
  const bleedNext = useRef(true);
  const changed = useRef(false);
  // Keyed by hex: a format switch re-emits the same color in other words, and the landscape stays.
  const hex = useMemo(() => landscapeFor(value)?.hex ?? START_COLORS[0], [value]);
  const landscape = useMemo(() => landscapeFor(hex)!, [hex]);

  useLayoutEffect(() => {
    const fromScript = (window as unknown as Record<string, unknown>)[START_GLOBAL];
    setValue(typeof fromScript === 'string' ? fromScript : startColor(window.location.search, Math.random()));
    setStarted(true);
  }, []);

  // The renderer: created once the start color is known, its first frame drawn before paint.
  useLayoutEffect(() => {
    const element = canvas.current;
    const host = section.current;
    if (!started || !element || !host) return;
    // The first frame is the flat sky the page already shows; the landscape then bleeds out of the disc.
    const instance = LandscapeRenderer.create(element, flatPaint(rgbOf(flatSky(landscape)), rgbOf(landscape.hex)));
    if (!instance) {
      setFlat(true);
      return;
    }
    renderer.current = instance;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const swatch = disc.current?.querySelector<HTMLElement>('.color-picker-swatch')?.getBoundingClientRect();
      if (!swatch || box.width === 0) return;
      const phone = window.matchMedia(PHONE).matches;
      const layout: LandscapeLayout = {
        disc: { x: swatch.left + swatch.width / 2 - box.left, y: swatch.top + swatch.height / 2 - box.top, r: swatch.width / 2 },
        // The cloud keeps clear of the copy: right of the disc and below it.
        cloud: phone ? { x: box.width * 0.8, y: box.height * 0.5, width: box.width * 0.42 } : { x: box.width * 0.86, y: box.height * 0.56, width: Math.min(box.width * 0.26, 400) },
        // Phones: the copy spans the width, so the bolt leaves the cloud below it instead of the top of the sky.
        bolt: phone ? { x: box.width * 0.78, top: box.height * 0.52 } : { x: box.width * 0.8, top: 0 },
        horizon: phone ? 0.24 : 0.3,
        hills: phone ? 0.12 : 0.16,
      };
      instance.setLayout(box.width, box.height, layout);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(host);
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
      resize.disconnect();
      view.disconnect();
      document.removeEventListener('visibilitychange', sync);
      element.removeEventListener('webglcontextlost', lost);
      instance.destroy();
      renderer.current = null;
    };
    // The landscape at start time only seeds the first frame; later colors go through the effect below.
  }, [started]);

  useLayoutEffect(() => {
    if (!started) return;
    publish(landscape);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderer.current?.paint(paintOf(landscape), bleedNext.current && !still);
  }, [landscape, started]);

  useEffect(() => {
    if (!changed.current) return;
    const timer = window.setTimeout(() => writeUrl(landscape.hex), URL_DELAY);
    return () => window.clearTimeout(timer);
  }, [landscape.hex]);

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

  const onChange = (next: string) => {
    const active = document.activeElement;
    bleedNext.current = active?.getAttribute('role') !== 'slider';
    changed.current = true;
    setValue(next);
  };

  return (
    <section ref={section} id="hero" aria-labelledby="hero-title" className="cp-hero" data-flat={flat || undefined}>
      <canvas ref={canvas} className="cp-hero-canvas" aria-hidden="true" />
      <div className="cp-hero-copy">
        <h1 id="hero-title" className="cp-hero-title">
          pick a color,
          <br />
          paint the sky
        </h1>
        <p className="cp-hero-lede">
          The sun is the swatch: it opens into a full picker with hex, rgb, hsl and oklch, opacity, the eyedropper and the
          keyboard. One shadcn item, no dependencies.
        </p>
      </div>
      <div ref={disc} className="cp-hero-disc">
        <ColorPicker
          color={value}
          onChange={onChange}
          {...(started ? {} : { swatch: 'var(--cp-color)' })}
          labels={{ open: 'Pick the sky color', panel: 'Sky color' }}
        />
      </div>
    </section>
  );
}
