import { boxRects, CALM_HEADER, CALM_REACH, calmMap, lineRects, type CalmMap } from '@/lib/paint-calm';
import type { BleedOrigin } from '@/lib/paint-origin';
import { readPixels, type Pixels } from '@/lib/paint-sample';
import { sectionEdges, sectionScroll, stillPaint, type SectionEdges } from '@/lib/paint-section';
import { softwareGL } from '@/lib/picker-motion';
import { flatLut, flatOf, rampLut, themeOf, type RampStop } from '@/lib/picker-ramp';
import { LIFT, PaintRenderer } from './paint-renderer';

const REDUCED = '(prefers-reduced-motion: reduce)';
/** A mouse or a trackpad: on a touch screen a finger scrolls the page, so it stirs nothing. */
const FINE_POINTER = '(hover: hover) and (pointer: fine)';
/** The paint draws while the section is this close to the window: a frame fixed to the window is right before it shows. */
const ACTIVE_MARGIN = '25% 0px';
/** Its first appearance spreads once this much of the section is on screen. */
const SEEN = 0.12;
/** The still frame, device px per CSS px: the airbrush is soft, and it is drawn on the CPU. */
const STILL_SCALE = 0.5;
/** Fallback bands (CSS px) when the page does not set `--paint-edge-top` / `--paint-edge-bottom`. */
const EDGE_FALLBACK = 240;

/** How the section's paint is drawn: WebGL on a canvas fixed to the window, WebGL over the section drawn once per change (a software WebGL), or a still frame drawn on the CPU (no WebGL 2). */
export type SectionPaintMode = 'fixed' | 'page' | 'still';

export interface SectionPaintOptions {
  /** The paint's box (the section's first child, over the whole section): it gets `data-paint` and `data-state`. */
  readonly box: HTMLElement;
  /** The section whose rectangle the paint fills. */
  readonly section: HTMLElement;
  /** The WebGL canvas and the still frame's canvas, both in `box`. */
  readonly canvas: HTMLCanvasElement;
  readonly still: HTMLCanvasElement;
  /** The long frame (an <img> its <picture> picked). */
  readonly frame: HTMLImageElement;
  /** The copy in the section that gets paper under its lines (a selector inside the section). */
  readonly calm: string;
  /** The colors at mount. */
  readonly hex: string;
  readonly stops: readonly RampStop[];
}

export interface SectionPaint {
  /**
   * Shows a color: `hex` is the flat color before the frame arrives, `stops` the ramp after it;
   * `origin` (page coordinates) spreads the new ramp out of a control, null shows it at once.
   */
  show(hex: string, stops: readonly RampStop[], origin: BleedOrigin | null): void;
  destroy(): void;
}

/** A registered length (`@property … syntax: '<length>'`) reads as px; anything else falls back. */
function lengthOf(element: Element, property: string): number {
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(property));
  return Number.isFinite(value) && value > 0 ? value : EDGE_FALLBACK;
}

/**
 * The color picker's paint inside one section (paint-section.tsx mounts it as the section comes near):
 * a WebGL 2 canvas fixed to the window that draws only the section's rectangle — the section's
 * coordinates are the paint's page, the paper lies under the section's copy (and under the header's
 * controls while the section is under the header), and the paint fades out above and below the
 * section. It draws only while the section is near the window and the tab is visible. A software
 * WebGL gets one canvas over the section drawn once per change; without WebGL 2 a still frame is
 * worked out on the CPU (lib/paint-section.ts). The cursor stirs it (a mouse or a trackpad, over the
 * section, with motion on and a GPU), as on the color picker landing.
 */
export function mountSectionPaint(options: SectionPaintOptions): SectionPaint {
  const { box, section, canvas, still, frame, calm: calmText } = options;
  const root = document.documentElement;
  const reduced = window.matchMedia(REDUCED);
  const fine = window.matchMedia(FINE_POINTER);
  let hex = options.hex;
  let stops = options.stops;
  const flat = () => flatLut(flatOf(hex, themeOf(root))!);

  let renderer = PaintRenderer.create(canvas, flat(), { transparent: true });
  const software = renderer ? softwareGL() : false;
  let mode: SectionPaintMode = renderer ? (software ? 'page' : 'fixed') : 'still';
  /** The frame is decoded and in the renderer (or read for the still frame). */
  let ready = false;
  /** The ramp has been shown once: its first appearance spreads, as on the landing. */
  let shown = false;
  let near = false;
  let seen = false;
  let sectionTop = 0;
  let sectionLeft = 0;
  let edges: SectionEdges = { top: 1, height: 0, bottom: 1 };
  let calm: CalmMap | null = null;
  let pixels: Pixels | null = null;
  let alive = true;

  const setMode = (next: SectionPaintMode) => {
    mode = next;
    box.dataset.paint = next;
  };
  setMode(mode);
  /** `drawn` hides the flat background under the canvas: the canvas has drawn its own (flat, then the frame). */
  const setState = (state: 'flat' | 'drawn') => {
    if (box.dataset.state !== state) box.dataset.state = state;
  };
  setState(renderer ? 'drawn' : 'flat');

  // --- The still frame ---------------------------------------------------------------------------
  let stillPending = 0;
  const drawStill = () => {
    stillPending = 0;
    if (!alive || mode !== 'still' || !ready || !pixels || edges.height <= 0) return;
    const invert = themeOf(root) === 'dark';
    const image = stillPaint(
      { frame: pixels, size: { width: section.clientWidth, height: edges.height }, windowHeight: window.innerHeight, calm, lift: LIFT, invert, lut: rampLut(stops), edges },
      STILL_SCALE,
    );
    still.width = image.width;
    still.height = image.height;
    still.getContext('2d')?.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    setState('drawn');
  };
  const scheduleStill = () => {
    if (mode === 'still' && !stillPending) stillPending = requestAnimationFrame(drawStill);
  };

  // --- Layout ------------------------------------------------------------------------------------
  const measure = () => {
    const rect = section.getBoundingClientRect();
    sectionTop = rect.top + window.scrollY;
    sectionLeft = rect.left + window.scrollX;
    edges = sectionEdges(rect.height, lengthOf(section, '--paint-edge-top'), lengthOf(section, '--paint-edge-bottom'));
    // The section's own coordinates: line boxes relative to its top-left corner.
    calm = calmMap(lineRects(section.querySelectorAll(calmText), -rect.left, -rect.top), Math.max(1, rect.width), Math.max(1, rect.height));
    if (renderer && mode !== 'still') {
      const viewport = { width: root.clientWidth, height: window.innerHeight };
      // The header stays at the window's top: under it the paper lifts under its controls, wherever the section is.
      const header = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
      const headerCalm = mode === 'fixed' && header > 0 ? calmMap(boxRects(document.querySelectorAll(CALM_HEADER), 0, 0), viewport.width, header + CALM_REACH) : null;
      renderer.setScroll(sectionScroll(window.scrollY, sectionTop));
      renderer.setLayout({ mode, viewport, pageHeight: rect.height, calm, headerCalm, edges });
    }
    scheduleStill();
  };
  let pending = 0;
  // Resizes come in bursts (fonts, the page above the section settling): one map per frame.
  const remeasure = () => {
    if (!pending) pending = requestAnimationFrame(() => {
      pending = 0;
      measure();
    });
  };
  measure();
  const resize = new ResizeObserver(remeasure);
  resize.observe(document.body);
  resize.observe(section);
  window.addEventListener('resize', remeasure);
  void document.fonts?.ready.then(() => alive && remeasure());
  const scroll = () => renderer?.setScroll(sectionScroll(window.scrollY, sectionTop));
  window.addEventListener('scroll', scroll, { passive: true });

  // --- When it draws -----------------------------------------------------------------------------
  /** The first appearance: the ramp spreads out of the section's origin (`[data-paint-origin]`), once it is on screen. */
  const firstShow = () => {
    if (!renderer || !ready || shown || !seen) return;
    shown = true;
    const target = section.querySelector('[data-paint-origin]') ?? section;
    const rect = target.getBoundingClientRect();
    renderer.paint(rampLut(stops), { x: rect.left - sectionLeft + window.scrollX, y: rect.top - sectionTop + window.scrollY, width: rect.width, height: rect.height, radius: 0 });
  };
  const activity = () => renderer?.setActive(near && document.visibilityState === 'visible');
  const nearby = new IntersectionObserver(
    ([entry]) => {
      near = entry?.isIntersecting ?? false;
      box.dataset.active = near ? 'true' : 'false';
      activity();
    },
    { rootMargin: ACTIVE_MARGIN },
  );
  nearby.observe(section);
  const onScreen = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) return;
      seen = true;
      onScreen.disconnect();
      firstShow();
    },
    { threshold: SEEN },
  );
  onScreen.observe(section);
  document.addEventListener('visibilitychange', activity);
  const motion = () => renderer?.setMoving(!reduced.matches && !software);
  motion();
  reduced.addEventListener('change', motion);

  // The theme picks the scene, shown at once; the flat color and the still frame follow it.
  const theme = () => {
    renderer?.setInvert(themeOf(root) === 'dark');
    if (renderer && !shown) renderer.paint(flat(), null);
    scheduleStill();
  };
  theme();
  const watchTheme = new MutationObserver(theme);
  watchTheme.observe(root, { attributes: true, attributeFilter: ['class'] });

  // The cursor stirs the paint like a liquid, over the section: a mouse or a trackpad only.
  const mouse = (event: PointerEvent) => event.pointerType === 'mouse' && fine.matches;
  const move = (event: PointerEvent) => {
    if (mouse(event)) renderer?.pointerMove(event.clientX, event.clientY);
  };
  const down = (event: PointerEvent) => {
    if (mouse(event)) renderer?.pointerDown(event.clientX, event.clientY);
  };
  const leave = () => renderer?.pointerLeave();
  section.addEventListener('pointermove', move, { passive: true });
  section.addEventListener('pointerdown', down, { passive: true });
  section.addEventListener('pointerleave', leave);

  // --- The frame ---------------------------------------------------------------------------------
  const load = () => {
    if (!frame.complete || frame.naturalWidth === 0) return;
    frame
      .decode()
      .then(() => {
        if (!alive || ready) return;
        ready = true;
        if (mode === 'still') {
          pixels = readPixels(frame);
          scheduleStill();
          return;
        }
        renderer?.setFrame(frame, frame.naturalWidth, frame.naturalHeight);
        firstShow();
      })
      .catch(() => {});
  };
  frame.addEventListener('load', load);
  load();

  // A lost context leaves the still frame.
  const lost = (event: Event) => {
    event.preventDefault();
    renderer?.destroy();
    renderer = null;
    setMode('still');
    setState('flat');
    if (ready) pixels = readPixels(frame);
    scheduleStill();
  };
  canvas.addEventListener('webglcontextlost', lost);

  return {
    show(nextHex, nextStops, origin) {
      hex = nextHex;
      stops = nextStops;
      if (renderer) {
        // Before the frame (and before the section was seen) the canvas shows the flat color.
        if (!ready || !shown) renderer.paint(flat(), null);
        else renderer.paint(rampLut(stops), origin && { ...origin, x: origin.x - sectionLeft, y: origin.y - sectionTop });
      }
      scheduleStill();
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(pending);
      cancelAnimationFrame(stillPending);
      resize.disconnect();
      nearby.disconnect();
      onScreen.disconnect();
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('scroll', scroll);
      document.removeEventListener('visibilitychange', activity);
      reduced.removeEventListener('change', motion);
      watchTheme.disconnect();
      section.removeEventListener('pointermove', move);
      section.removeEventListener('pointerdown', down);
      section.removeEventListener('pointerleave', leave);
      frame.removeEventListener('load', load);
      canvas.removeEventListener('webglcontextlost', lost);
      renderer?.destroy();
      renderer = null;
      delete box.dataset.paint;
      delete box.dataset.state;
      delete box.dataset.active;
    },
  };
}
