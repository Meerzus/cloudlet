import { boxRects, CALM_HEADER, CALM_REACH, calmMap, lineRects, type CalmMap } from '@/lib/paint-calm';
import type { BleedOrigin } from '@/lib/paint-origin';
import { readPixels, type Pixels } from '@/lib/paint-sample';
import { sectionEdges, sectionScroll, stillPaint, type SectionEdges } from '@/lib/paint-section';
import { softwareGL } from '@/lib/picker-motion';
import { flatLut, flatOf, rampLut, themeOf, type RampStop } from '@/lib/picker-ramp';
import { pageStill, watchStill } from '@/lib/reduced-motion';
import { LIFT, PaintRenderer } from './paint-renderer';

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
  /** The paint's box (the section's first child, over the whole section): it gets `data-paint` and `data-state`, and the WebGL canvas while it draws. */
  readonly box: HTMLElement;
  /** The section whose rectangle the paint fills. */
  readonly section: HTMLElement;
  /** The still frame's canvas, in `box`. */
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

/** A section's paint as the shared renderer sees it. */
interface Member {
  /** The section is within ACTIVE_MARGIN of the window. */
  readonly near: boolean;
  /** CSS px of the section in the window now. */
  visible(): number;
  /** Takes the renderer: the canvas moves into its box and draws its section. */
  claim(): void;
  /** Gives it up: its box shows the flat color again. */
  release(): void;
  /** The frame is in the renderer: the section holding it shows the ramp. */
  framed(): void;
  /** The context is gone: it draws a still frame from now on. */
  lose(): void;
}

/**
 * One WebGL context for every section's paint on the page (the kit's landing paints its hero and the
 * color picker's chapter): one canvas and one renderer, lent to the section nearest the window — the
 * one most on screen when two are near. The canvas moves into that section's box (moving a canvas
 * keeps its context); the other sections show their flat color, which only the edge of a band between
 * two near sections ever shows. Created with the first section, gone with the last.
 */
interface Host {
  readonly canvas: HTMLCanvasElement;
  renderer: PaintRenderer | null;
  readonly software: boolean;
  /** The frame is decoded and in the renderer. */
  frame: boolean;
  owner: Member | null;
  readonly members: Set<Member>;
  readonly dispose: () => void;
}

let host: Host | null = null;

function openHost(lut: Uint8Array): Host {
  if (host) return host;
  const canvas = document.createElement('canvas');
  canvas.className = 'paint-section-gl';
  canvas.setAttribute('aria-hidden', 'true');
  const renderer = PaintRenderer.create(canvas, lut, { transparent: true });
  const members = new Set<Member>();
  // A lost context leaves every section its still frame.
  const lost = (event: Event) => {
    event.preventDefault();
    const current = host;
    if (!current) return;
    current.renderer?.destroy();
    current.renderer = null;
    current.owner = null;
    canvas.remove();
    for (const member of current.members) member.lose();
  };
  canvas.addEventListener('webglcontextlost', lost);
  // Two sections near at once (a short page between them): the one more on screen draws.
  const scroll = () => arbitrate();
  window.addEventListener('scroll', scroll, { passive: true });
  host = {
    canvas,
    renderer,
    software: renderer ? softwareGL() : false,
    frame: false,
    owner: null,
    members,
    dispose() {
      window.removeEventListener('scroll', scroll);
      canvas.removeEventListener('webglcontextlost', lost);
      this.renderer?.destroy();
      this.renderer = null;
      canvas.remove();
    },
  };
  return host;
}

/** Lends the renderer to the near section most on screen; keeps it where it is when none is near. */
function arbitrate() {
  if (!host?.renderer) return;
  const near = [...host.members].filter((member) => member.near);
  if (near.length === 0) return;
  let best = host.owner && host.owner.near ? host.owner : near[0]!;
  if (near.length > 1) {
    let most = best.visible();
    for (const member of near) {
      const seen = member.visible();
      if (seen > most) {
        most = seen;
        best = member;
      }
    }
  }
  if (best === host.owner) return;
  host.owner?.release();
  host.owner = best;
  best.claim();
}

/** A registered length (`@property … syntax: '<length>'`) reads as px; anything else falls back. */
function lengthOf(element: Element, property: string): number {
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(property));
  return Number.isFinite(value) && value >= 0 ? Math.max(1, value) : EDGE_FALLBACK;
}

/**
 * The color picker's paint inside one section (paint-section.tsx mounts it as the section comes near):
 * a WebGL 2 canvas fixed to the window that draws only the section's rectangle — the section's
 * coordinates are the paint's page, the paper lies under the section's copy (and under the header's
 * controls while the section is under the header), and the paint fades out above and below the
 * section. The canvas and its renderer are shared by every section of the page (Host): it draws only
 * while its section is near the window and the tab is visible. A software WebGL gets one canvas over
 * the section drawn once per change; without WebGL 2 a still frame is worked out on the CPU
 * (lib/paint-section.ts). The cursor stirs it (a mouse or a trackpad, over the section, with motion on
 * and a GPU), as on the color picker landing.
 */
export function mountSectionPaint(options: SectionPaintOptions): SectionPaint {
  const { box, section, still, frame, calm: calmText } = options;
  const root = document.documentElement;
  const fine = window.matchMedia(FINE_POINTER);
  let hex = options.hex;
  let stops = options.stops;
  const flat = () => flatLut(flatOf(hex, themeOf(root))!);

  const shared = openHost(flat());
  let mode: SectionPaintMode = shared.renderer ? (shared.software ? 'page' : 'fixed') : 'still';
  /** This section holds the renderer. */
  let owning = false;
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
  setState('flat');
  /** The renderer, while this section holds it. */
  const mine = () => (owning ? shared.renderer : null);

  // --- The still frame ---------------------------------------------------------------------------
  let stillPending = 0;
  const drawStill = () => {
    stillPending = 0;
    if (!alive || mode !== 'still' || !pixels || edges.height <= 0) return;
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
  /** Hands this section's rectangle, paper and bands to the renderer. */
  const layout = () => {
    const gl = mine();
    if (!gl || mode === 'still') return;
    const viewport = { width: root.clientWidth, height: window.innerHeight };
    // The header stays at the window's top: under it the paper lifts under its controls, wherever the section is.
    const header = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
    const headerCalm = mode === 'fixed' && header > 0 ? calmMap(boxRects(document.querySelectorAll(CALM_HEADER), 0, 0), viewport.width, header + CALM_REACH) : null;
    gl.setScroll(sectionScroll(window.scrollY, sectionTop));
    gl.setLayout({ mode, viewport, pageHeight: edges.height, calm: calm ?? calmMap([], 1, 1), headerCalm, edges });
  };
  const measure = () => {
    const rect = section.getBoundingClientRect();
    sectionTop = rect.top + window.scrollY;
    sectionLeft = rect.left + window.scrollX;
    edges = sectionEdges(rect.height, lengthOf(section, '--paint-edge-top'), lengthOf(section, '--paint-edge-bottom'));
    // The section's own coordinates: line boxes relative to its top-left corner.
    calm = calmMap(lineRects(section.querySelectorAll(calmText), -rect.left, -rect.top), Math.max(1, rect.width), Math.max(1, rect.height));
    layout();
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
  const scroll = () => mine()?.setScroll(sectionScroll(window.scrollY, sectionTop));
  window.addEventListener('scroll', scroll, { passive: true });

  // --- When it draws -----------------------------------------------------------------------------
  /** The renderer shows this section's colors: the flat color until the ramp first spreads, the ramp after. */
  const repaint = () => {
    const gl = mine();
    if (!gl) return;
    if (!shared.frame || !shown) gl.paint(flat(), null);
    else gl.paint(rampLut(stops), null);
  };
  /** The first appearance: the ramp spreads out of the section's origin (`[data-paint-origin]`), once it is on screen. */
  const firstShow = () => {
    const gl = mine();
    if (!gl || !shared.frame || shown || !seen) return;
    shown = true;
    const target = section.querySelector('[data-paint-origin]') ?? section;
    const rect = target.getBoundingClientRect();
    gl.paint(rampLut(stops), { x: rect.left - sectionLeft + window.scrollX, y: rect.top - sectionTop + window.scrollY, width: rect.width, height: rect.height, radius: 0 });
  };
  const activity = () => mine()?.setActive(near && document.visibilityState === 'visible');
  // The system setting or the page's own switch: the paint stands still and repaints at once.
  const motion = () => mine()?.setMoving(!pageStill() && !shared.software);

  const member: Member = {
    get near() {
      return near;
    },
    visible: () => {
      const top = sectionTop - window.scrollY;
      return Math.max(0, Math.min(window.innerHeight, top + edges.height) - Math.max(0, top));
    },
    claim() {
      if (!alive || !shared.renderer || mode === 'still') return;
      owning = true;
      if (shared.canvas.parentElement !== box) box.prepend(shared.canvas);
      box.dataset.active = near ? 'true' : 'false';
      shared.renderer.setInvert(themeOf(root) === 'dark');
      motion();
      layout();
      repaint();
      setState('drawn');
      activity();
      firstShow();
    },
    framed() {
      repaint();
      firstShow();
    },
    release() {
      shared.renderer?.pointerLeave();
      owning = false;
      setState('flat');
    },
    lose() {
      owning = false;
      setMode('still');
      setState('flat');
      if (frame.complete && frame.naturalWidth > 0) pixels = readPixels(frame);
      scheduleStill();
    },
  };
  shared.members.add(member);

  const nearby = new IntersectionObserver(
    ([entry]) => {
      near = entry?.isIntersecting ?? false;
      if (owning) box.dataset.active = near ? 'true' : 'false';
      if (near) arbitrate();
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
  const unwatchStill = watchStill(motion);

  // The theme picks the scene, shown at once; the flat color and the still frame follow it.
  const theme = () => {
    const gl = mine();
    gl?.setInvert(themeOf(root) === 'dark');
    if (gl && !shown) gl.paint(flat(), null);
    scheduleStill();
  };
  const watchTheme = new MutationObserver(theme);
  watchTheme.observe(root, { attributes: true, attributeFilter: ['class'] });

  // The cursor stirs the paint like a liquid, over the section: a mouse or a trackpad only.
  const mouse = (event: PointerEvent) => event.pointerType === 'mouse' && fine.matches;
  const move = (event: PointerEvent) => {
    if (mouse(event)) mine()?.pointerMove(event.clientX, event.clientY);
  };
  const down = (event: PointerEvent) => {
    if (mouse(event)) mine()?.pointerDown(event.clientX, event.clientY);
  };
  const leave = () => mine()?.pointerLeave();
  section.addEventListener('pointermove', move, { passive: true });
  section.addEventListener('pointerdown', down, { passive: true });
  section.addEventListener('pointerleave', leave);

  // --- The frame ---------------------------------------------------------------------------------
  // Every section brings the same frame (one fetch): the first decoded goes into the shared renderer.
  const load = () => {
    if (!frame.complete || frame.naturalWidth === 0) return;
    frame
      .decode()
      .then(() => {
        if (!alive) return;
        if (mode === 'still') {
          pixels ??= readPixels(frame);
          scheduleStill();
          return;
        }
        if (shared.frame || !shared.renderer) return;
        shared.renderer.setFrame(frame, frame.naturalWidth, frame.naturalHeight);
        shared.frame = true;
        // Whichever section holds the renderer now (not necessarily this one) shows its ramp.
        for (const other of shared.members) other.framed();
      })
      .catch(() => {});
  };
  frame.addEventListener('load', load);
  load();
  arbitrate();

  return {
    show(nextHex, nextStops, origin) {
      hex = nextHex;
      stops = nextStops;
      const gl = mine();
      if (gl) {
        // Before the frame (and before the section was seen) the canvas shows the flat color.
        if (!shared.frame || !shown) gl.paint(flat(), null);
        else gl.paint(rampLut(stops), origin && { ...origin, x: origin.x - sectionLeft, y: origin.y - sectionTop });
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
      unwatchStill();
      watchTheme.disconnect();
      section.removeEventListener('pointermove', move);
      section.removeEventListener('pointerdown', down);
      section.removeEventListener('pointerleave', leave);
      frame.removeEventListener('load', load);
      shared.members.delete(member);
      if (shared.owner === member) {
        shared.owner = null;
        if (shared.canvas.parentElement === box) shared.canvas.remove();
        shared.renderer?.setActive(false);
        arbitrate();
      }
      if (shared.members.size === 0) {
        shared.dispose();
        if (host === shared) host = null;
      }
      owning = false;
      delete box.dataset.paint;
      delete box.dataset.state;
      delete box.dataset.active;
    },
  };
}
