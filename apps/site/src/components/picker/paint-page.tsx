'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { boxRects, CALM_HEADER, CALM_REACH, CALM_TEXT, calmMap, lineRects, type CalmMap } from '@/lib/paint-calm';
import { tileSize } from '@/lib/paint-layout';
import { paintColorAt, readPixels, type Pixels } from '@/lib/paint-sample';
import { softwareGL } from '@/lib/picker-motion';
import { flatLut, flatOf, pageRamp, rampLut, themeOf } from '@/lib/picker-ramp';
import { LIFT, PaintRenderer, type BleedOrigin, type PaintLayout } from './paint-renderer';
import { usePickerColor, type ChangeSource } from './picker-color';

const REDUCED = '(prefers-reduced-motion: reduce)';
/** Where a jump with no source of its own spreads from, and the frame's first appearance: the hero's panel. */
const HERO_PANEL = '.cp-hero-panel';
/** A mouse or a trackpad: on a touch screen a finger scrolls the page, so it stirs nothing. */
const FINE_POINTER = '(hover: hover) and (pointer: fine)';
/** Where a click does not swirl the paint: in Tools it takes the color under the point, which must hold still. */
const NO_SWIRL = '#tools';


/** How the paint is drawn: on a canvas fixed to the window, on one over the whole page (software WebGL), or not at all (flat). */
export type PaintMode = 'fixed' | 'page' | 'flat';

/** A source of a change as the renderer takes it: a box in page coordinates with its corner radius. */
export function bleedOrigin(source: ChangeSource): BleedOrigin {
  if (!('getBoundingClientRect' in source)) return { x: source.x, y: source.y, width: 0, height: 0, radius: 0 };
  // A wrapper round an inline panel spreads from the panel itself, with its rounded corners.
  const target = source.matches('.color-picker-inline') ? source : (source.querySelector('.color-picker-inline') ?? source);
  const box = target.getBoundingClientRect();
  const radius = Number.parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;
  return { x: box.left + window.scrollX, y: box.top + window.scrollY, width: box.width, height: box.height, radius };
}

/**
 * The paint under the whole color picker landing (COLOR_PICKER §8.2–§8.3): the long frame recolored
 * by the page color's ramp — or by the palette's once the visitor made it theirs — with the paper
 * lifted under every line of copy and under the header's controls. The theme picks the scene: the dark theme
 * reads the frame upside down. A jump spreads out of the control that made it; dragging a handle
 * repaints at once. Without WebGL 2 the flat background of picker.css stays.
 */
export function PaintPage() {
  const state = usePickerColor();
  const { hex, started, change, paint } = state;
  const ramp = pageRamp(state);
  /** What the probe reads: the paint on screen now (the effects below keep these current). */
  const current = useRef<{ hex: string; lut: Uint8Array | null; calm: CalmMap | null }>({ hex, lut: null, calm: null });
  current.current.hex = hex;
  const [mode, setMode] = useState<PaintMode>('fixed');
  const [ready, setReady] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const renderer = useRef<PaintRenderer | null>(null);
  /** The frame has been shown once: its first appearance always bleeds, later ones follow the change. */
  const shown = useRef(false);

  // The renderer: created once the start color is known, its first (flat) frame drawn before paint.
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!started || !element) return;
    const root = document.documentElement;
    /** Without the frame the page shows one flat color: that is what a click on it takes. */
    const flat = () => flatOf(current.current.hex, themeOf(root))!;
    const instance = PaintRenderer.create(element, flatLut(flatOf(hex, themeOf(root))!));
    if (!instance) {
      setMode('flat');
      paint.current = { colorAt: flat };
      return () => {
        paint.current = null;
      };
    }
    renderer.current = instance;
    // One full-screen pass on a software WebGL costs 60–80 ms: there the paint covers the page and stands still.
    const software = softwareGL();
    const kind = software ? 'page' : 'fixed';
    setMode(kind);
    const reduced = window.matchMedia(REDUCED);
    const motion = () => instance.setMoving(!reduced.matches && !software);
    motion();
    reduced.addEventListener('change', motion);
    instance.setInvert(themeOf(root) === 'dark');

    const measure = () => {
      const viewport = { width: root.clientWidth, height: window.innerHeight };
      const pageHeight = root.scrollHeight;
      const calm = calmMap(lineRects(document.querySelectorAll(CALM_TEXT), window.scrollX, window.scrollY), viewport.width, pageHeight);
      // The header stays at the window's top: its controls get a map of their own, in window coordinates.
      const header = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
      const headerCalm = kind === 'fixed' && header > 0 ? calmMap(boxRects(document.querySelectorAll(CALM_HEADER), 0, 0), viewport.width, header + CALM_REACH) : null;
      if (kind === 'page') element.style.height = `${pageHeight}px`;
      const layout: PaintLayout = { mode: kind, viewport, pageHeight, calm, headerCalm };
      current.current.calm = calm;
      instance.setScroll(window.scrollY);
      instance.setLayout(layout);
      root.dataset.cpPaint = kind;
    };
    let pending = 0;
    // Resizes come in bursts (fonts, an opened answer, a section's lazy chunk): one map per frame.
    const remeasure = () => {
      if (!pending) pending = requestAnimationFrame(() => {
        pending = 0;
        measure();
      });
    };
    measure();
    const resize = new ResizeObserver(remeasure);
    resize.observe(document.body);
    window.addEventListener('resize', remeasure);
    void document.fonts?.ready.then(remeasure);
    const scroll = () => instance.setScroll(window.scrollY);
    window.addEventListener('scroll', scroll, { passive: true });

    // The cursor stirs the paint like a liquid: a mouse or a trackpad only.
    const fine = window.matchMedia(FINE_POINTER);
    const mouse = (event: PointerEvent) => event.pointerType === 'mouse' && fine.matches;
    const move = (event: PointerEvent) => {
      if (mouse(event)) instance.pointerMove(event.clientX, event.clientY);
    };
    const down = (event: PointerEvent) => {
      const still = event.target instanceof Element && event.target.closest(NO_SWIRL) !== null;
      if (mouse(event) && !still) instance.pointerDown(event.clientX, event.clientY);
    };
    const leave = () => instance.pointerLeave();
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', down, { passive: true });
    root.addEventListener('pointerleave', leave);

    // The theme picks the scene, shown at once.
    const theme = () => instance.setInvert(themeOf(root) === 'dark');
    const watchTheme = new MutationObserver(theme);
    watchTheme.observe(root, { attributes: true, attributeFilter: ['class'] });
    const visible = () => instance.setActive(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', visible);

    // The frame: the <picture> picks its width and format.
    const img = image.current;
    let alive = true;
    const load = () => {
      if (!img?.complete || img.naturalWidth === 0) return;
      img
        .decode()
        .then(() => {
          if (!alive) return;
          instance.setFrame(img, img.naturalWidth, img.naturalHeight);
          setReady(true);
        })
        .catch(() => {});
    };
    img?.addEventListener('load', load);
    load();

    // The color under a point, worked out as the shader draws it (lib/paint-sample.ts); the frame's pixels are read once.
    // Keyed by the source: a wider window can swap the <picture>'s candidate, and the texture with it.
    let pixels: { src: string; data: Pixels | null } | null = null;
    let gone = false;
    paint.current = {
      colorAt(x, pageY) {
        const { lut, calm } = current.current;
        if (gone || !lut || !img || img.naturalWidth === 0) return flat();
        if (pixels?.src !== img.currentSrc) pixels = { src: img.currentSrc, data: readPixels(img) };
        const frame = pixels.data;
        if (!frame) return flat();
        const { phase, flow, invert } = instance.flowState;
        const viewport = { width: root.clientWidth, height: window.innerHeight };
        const layout = { width: viewport.width, tile: tileSize(viewport, img.naturalWidth / img.naturalHeight), phase, flow };
        // The paint shows what the cursor stirred there: read where it came from.
        const stirred = instance.stirredAt(x - window.scrollX, pageY - window.scrollY);
        return paintColorAt(x, pageY, { frame, layout, calm, lift: LIFT, invert, lut, stirred });
      },
    };

    const lost = (event: Event) => {
      event.preventDefault();
      gone = true;
      delete root.dataset.cpPaint;
      setMode('flat');
    };
    element.addEventListener('webglcontextlost', lost);
    return () => {
      alive = false;
      cancelAnimationFrame(pending);
      reduced.removeEventListener('change', motion);
      resize.disconnect();
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('scroll', scroll);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', down);
      root.removeEventListener('pointerleave', leave);
      watchTheme.disconnect();
      document.removeEventListener('visibilitychange', visible);
      img?.removeEventListener('load', load);
      element.removeEventListener('webglcontextlost', lost);
      element.style.height = '';
      paint.current = null;
      delete root.dataset.cpPaint;
      instance.destroy();
      renderer.current = null;
    };
    // The color at start time only seeds the first frame; later colors go through the effect below.
  }, [started]);

  useLayoutEffect(() => {
    const instance = renderer.current;
    if (!started || !instance) return;
    if (!ready) {
      current.current.lut = null;
      instance.paint(flatLut(flatOf(hex, themeOf(document.documentElement))!), null);
      return;
    }
    const { bleed, from } = change.current;
    let origin: BleedOrigin | null = null;
    if (bleed || !shown.current) {
      const source = from ?? document.querySelector(HERO_PANEL);
      origin = source ? bleedOrigin(source) : null;
    }
    const lut = rampLut(ramp.stops);
    current.current.lut = lut;
    instance.paint(lut, origin);
    shown.current = true;
  }, [hex, ramp, ready, started, change]);

  return (
    <>
      <canvas ref={canvas} className="cp-paint" data-mode={mode} aria-hidden="true" />
      {/* Never shown: the shader reads it. The flat color paints first and the paint bleeds in after,
          so its request stays behind the scripts and fonts that the headline waits for. */}
      <picture hidden>
        <source type="image/avif" srcSet="/picker/material-page-640.avif 640w, /picker/material-page-1280.avif 1280w" sizes="100vw" />
        {/* eslint-disable-next-line @next/next/no-img-element -- a texture for WebGL, not an image on the page */}
        <img ref={image} src="/picker/material-page-1280.webp" srcSet="/picker/material-page-640.webp 640w, /picker/material-page-1280.webp 1280w" sizes="100vw" alt="" decoding="async" fetchPriority="low" />
      </picture>
    </>
  );
}
