'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { softwareGL, watchScroll } from '@/lib/picker-motion';
import { ColorPalette } from '@/components/ui/color-palette/color-palette';
import { harmoniesOf } from '@/lib/harmonies';
import { flatLut, rampLut } from '@/lib/picker-ramp';
import { MaterialRenderer } from './material-renderer';
import { usePickerColor } from './picker-color';

const REDUCED = '(prefers-reduced-motion: reduce)';
/** The palette row's swatches are round: the bleed spreads from a pill. */
const ROW_RADIUS = 9999;

/** The flat card without WebGL 2 (and before the frame): the palette's colors as bands, darkest at the bottom. */
const bands = (stops: readonly { readonly at: number; readonly color: string }[]): CSSProperties => ({
  background: `linear-gradient(to top, ${stops.map((stop) => `${stop.color} ${(stop.at * 100).toFixed(1)}%`).join(', ')})`,
});

/**
 * Palette (COLOR_PICKER §8.5): the page's palette in a ColorPalette, the harmonies of the page color
 * as hints that fill it, and a card of viscous paint (the material-palette frame) recolored by the
 * palette's ramp — the colors laid out by lightness, the darkest in the shadows. A hint, typing or a
 * new color spreads out of the palette; dragging a handle repaints at once.
 */
export function Palette() {
  const { hex, palette, paletteHex, paletteRamp, started, change, setPalette } = usePickerColor();
  const hints = useMemo(() => harmoniesOf(hex), [hex]);
  const [flat, setFlat] = useState(false);
  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);
  const section = useRef<HTMLElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const renderer = useRef<MaterialRenderer | null>(null);
  const shown = useRef(false);

  // The frame is fetched once the section comes close: it is not needed for the hero.
  useEffect(() => {
    const host = section.current;
    if (!host || near) return;
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && setNear(true), { rootMargin: '100% 0px' });
    observer.observe(host);
    return () => observer.disconnect();
  }, [near]);

  useLayoutEffect(() => {
    const element = canvas.current;
    const box = card.current;
    if (!started || !near || !element || !box) return;
    const instance = MaterialRenderer.create(element, { lut: flatLut(paletteHex[0]!), invert: false });
    if (!instance) {
      setFlat(true);
      return;
    }
    renderer.current = instance;
    const reduced = window.matchMedia(REDUCED);
    const motion = () => instance.setMoving(!reduced.matches && !softwareGL());
    motion();
    reduced.addEventListener('change', motion);

    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0) return;
      const from = row.current?.getBoundingClientRect() ?? rect;
      instance.setLayout({
        width: rect.width,
        height: rect.height,
        focus: { x: 0.5, y: 0.5 },
        origin: { x: from.left - rect.left, y: from.top - rect.top, width: from.width, height: from.height, radius: Math.min(ROW_RADIUS, from.height / 2) },
        calm: [],
      });
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(box);
    if (row.current) resize.observe(row.current);

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
    let scrolling = false;
    // Held on its frame while the page scrolls (lib/picker-motion.ts); the flow's clock does not jump.
    const sync = () => instance.setActive(onScreen && !scrolling && document.visibilityState === 'visible');
    const unwatch = watchScroll((now) => {
      scrolling = now;
      sync();
    });
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
      unwatch();
      element.removeEventListener('webglcontextlost', lost);
      instance.destroy();
      renderer.current = null;
    };
    // The palette at start time only seeds the first frame; later palettes go through the effect below.
  }, [started, near]);

  useLayoutEffect(() => {
    const instance = renderer.current;
    if (!instance || !ready) return;
    const still = window.matchMedia(REDUCED).matches;
    instance.paint({ lut: rampLut(paletteRamp.stops), invert: paletteRamp.invert }, (change.current.bleed || !shown.current) && !still);
    shown.current = true;
  }, [paletteRamp, ready, change]);

  return (
    <section ref={section} id="palette" aria-labelledby="palette-title" className="cp-section">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
        <h2 id="palette-title" className="cp-section-title">palette</h2>
        <p className="cp-section-lede">
          Up to four colors in one row, each its own picker. The first one paints this page; the paint beside it takes them all, the
          darkest in the shadows.
        </p>
        <div className="cp-palette">
          <div className="cp-palette-controls">
            <div ref={row} className="cp-palette-row">
              <ColorPalette colors={palette} onChange={(colors) => setPalette(colors, row.current ?? undefined)} labels={{ group: 'Page palette' }} />
            </div>
            <div className="cp-hints" role="group" aria-labelledby="palette-hints-title">
              <h3 id="palette-hints-title" className="cp-hints-title">
                Start from a harmony
              </h3>
              <ul className="cp-hints-list">
                {hints.map((hint) => (
                  <li key={hint.id}>
                    <button
                      type="button"
                      className="cp-hint"
                      aria-pressed={hint.colors.length === paletteHex.length && hint.colors.every((color, index) => color === paletteHex[index])}
                      onClick={() => setPalette(hint.colors, row.current ?? undefined)}
                    >
                      <span className="cp-hint-chips" aria-hidden="true">
                        {hint.colors.map((color, index) => (
                          <span key={`${color}-${index}`} className="cp-hint-chip" style={{ background: color }} />
                        ))}
                      </span>
                      {hint.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div ref={card} className="cp-palette-card" data-flat={flat || undefined} data-ready={(ready && !flat) || undefined} style={bands(paletteRamp.stops)}>
            <canvas ref={canvas} className="cp-palette-canvas" aria-hidden="true" />
            {near && (
              <picture hidden>
                <source type="image/avif" srcSet="/picker/material-palette-1280.avif 1280w, /picker/material-palette-2560.avif 2560w" sizes="(min-width: 768px) 50vw, 100vw" />
                {/* eslint-disable-next-line @next/next/no-img-element -- a texture for WebGL, not an image on the page */}
                <img
                  ref={image}
                  src="/picker/material-palette-1280.webp"
                  srcSet="/picker/material-palette-1280.webp 1280w, /picker/material-palette-2560.webp 2560w"
                  sizes="(min-width: 768px) 50vw, 100vw"
                  alt=""
                  decoding="async"
                />
              </picture>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
