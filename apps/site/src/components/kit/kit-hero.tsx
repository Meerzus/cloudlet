'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useScrollScene } from '@/components/site/motion';
import { usePageNotifications } from '@/components/site/notifications';
import { ColorPalette } from '@/components/ui/color-palette/color-palette';
import { ColorPicker } from '@/components/ui/color-picker/color-picker';
import { CLOUD_SHAPES, CLOUD_WIDTHS } from '@/lib/clouds.generated';
import { gsap, ScrollTrigger } from '@/lib/gsap';
import type { RegistryItem } from '@/lib/site';
import { springEasing } from '@/lib/spring';
import { InstallCommand } from './install-command';
import { ISLANDS, type CloudShape, type Island } from './islands';
import { KitName } from './kit-name';

const ASPECT = new Map<number, number>(CLOUD_SHAPES.map((shape) => [shape.id, shape.aspect]));

/** Pixels an island rises per scrolled pixel, on top of the page's own scroll, at depth 1. */
const RATE = { wide: 0.45, narrow: 0.2 } as const;
/** The layout with islands around the words (kit.css uses the same width). */
const WIDE = '(min-width: 64rem)';

/**
 * The name and the islands rise into place once, on a critically damped spring (no overshoot: an
 * arrival, not a bounce), the far ones a beat later.
 */
const APPROACH = springEasing({ stiffness: 60, damping: 15.5 });
/** Hover and press on what rests on the islands: quick, with a hint of give. */
const PRESS = springEasing({ stiffness: 520, damping: 34 });
const MOTION_STYLE = {
  '--approach-ease': APPROACH.easing,
  '--approach-duration': `${APPROACH.duration}ms`,
  '--press-ease': PRESS.easing,
  '--press-duration': `${PRESS.duration}ms`,
} as CSSProperties;

/**
 * An island's cloud. It is soft haze, so the small render is enough on most screens (`sizes` asks
 * for at most 400 CSS px): the first screen stays light. Lazy, so the other theme's render (hidden)
 * is never fetched. It fades in once decoded rather than popping in mid-rise.
 */
function IslandCloud({ shape, theme }: { shape: CloudShape; theme: 'day' | 'night' }) {
  const set = (format: 'avif' | 'webp') =>
    CLOUD_WIDTHS.map((width) => `/sky/cloud-${shape}-${theme}-${width}.${format} ${width}w`).join(', ');
  const sizes = '(max-width: 63.99rem) min(60vw, 260px), min(34vw, 400px)';
  const shown = useCallback((image: HTMLImageElement | null) => {
    if (!image) return;
    const show = () => image.setAttribute('data-loaded', '');
    if (image.complete && image.naturalWidth > 0) show();
    else image.addEventListener('load', show, { once: true });
  }, []);
  return (
    <picture className={`cloud-${theme}`}>
      <source type="image/avif" srcSet={set('avif')} sizes={sizes} />
      <img
        ref={shown}
        src={`/sky/cloud-${shape}-${theme}-${CLOUD_WIDTHS[0]}.webp`}
        srcSet={set('webp')}
        sizes={sizes}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    </picture>
  );
}

function place(island: Island): CSSProperties {
  const style: Record<string, string | number> = {
    '--depth': island.depth,
    '--x': `${island.wide.x}%`,
    '--y': `${island.wide.y}%`,
    '--w': `${island.wide.w}%`,
  };
  if (island.narrow) {
    style['--nx'] = `${island.narrow.x}%`;
    style['--ny'] = `${island.narrow.y}%`;
    style['--nw'] = `${island.narrow.w}%`;
  }
  return style as CSSProperties;
}

/** A cloud with something resting on it; scroll lifts it by its depth. */
function IslandView({ island, children }: { island: Island; children?: ReactNode }) {
  return (
    <div
      className="kit-island"
      data-island={island.id}
      data-depth={island.depth}
      data-narrow={island.narrow ? undefined : 'off'}
      style={place(island)}
    >
      <div className="kit-island-rise">
        <div className="kit-cloud" data-flip={island.flip ? '' : undefined} style={{ aspectRatio: String(ASPECT.get(island.shape)) }}>
          <IslandCloud shape={island.shape} theme="day" />
          <IslandCloud shape={island.shape} theme="night" />
        </div>
        {children ? <div className="kit-thing">{children}</div> : null}
      </div>
    </div>
  );
}

/** The Toaster's island: a notification resting on the cloud; a press sends the real one to the page's Toaster. */
function ToastOnCloud() {
  const controller = usePageNotifications();
  return (
    <button
      type="button"
      className="kit-pill kit-press"
      onClick={() =>
        controller?.show({
          title: 'Synced to the cloud',
          kind: 'success',
          description: { kind: 'text', text: 'Sent from a cloud on this page.' },
        })
      }
    >
      <span aria-hidden="true" className="kit-pill-icon">
        <svg viewBox="0 0 16 16">
          <path d="M4.5 8.5 7 11l4.5-5.5" />
        </svg>
      </span>
      <span>Synced to the cloud</span>
      <span className="sr-only">: send this notification</span>
    </button>
  );
}

function PickerOnCloud() {
  const [accent, setAccent] = useState('#4c94db');
  return (
    <div className="kit-tray">
      <ColorPicker color={accent} onChange={setAccent} labels={{ open: 'Pick a color' }} />
      <span className="kit-tray-value">{accent}</span>
    </div>
  );
}

function PaletteOnCloud() {
  const [colors, setColors] = useState<string[]>(['#4c94db', '#f5b83d', '#e5484d']);
  return (
    <div className="kit-tray">
      <ColorPalette colors={colors} onChange={setColors} labels={{ group: 'Palette on a cloud' }} />
    </div>
  );
}

/** What rests on each component's island: the component itself, live, with its own state. */
const RESTING: Readonly<Record<RegistryItem, () => ReactNode>> = {
  toaster: () => <ToastOnCloud />,
  'color-picker': () => <PickerOnCloud />,
  'color-palette': () => <PaletteOnCloud />,
};

/**
 * The top of the kit's landing, the sky: "Cloudlet" written in clouds, the slogan and the install
 * command in the middle, and the kit's components resting on clouds at different depths around them
 * (under them on narrow screens), each one live. The islands come from ISLANDS, one per component.
 * Scrolling lifts the near clouds faster than the far ones, vertically only. Reduced motion: still.
 */
export function KitHero() {
  const root = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  // The sky's own clouds stay hidden while the hero covers the screen and come in once its upper
  // part has scrolled away (kit.css): one attribute flip per crossing, with or without motion.
  useEffect(() => {
    const hero = root.current;
    const mark = sentinel.current;
    if (!hero || !mark) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      const covering = entry.isIntersecting || entry.boundingClientRect.top > 0;
      hero.setAttribute('data-sky-clouds', covering ? 'off' : 'on');
    });
    observer.observe(mark);
    return () => observer.disconnect();
  }, []);

  useScrollScene(root, () => {
    const hero = root.current;
    if (!hero) return;
    const islands = gsap.utils.toArray<HTMLElement>('.kit-island');
    const layers = islands.map((element) => ({
      depth: Number(element.dataset['depth']),
      set: gsap.quickSetter(element, 'y', 'px') as (value: number) => void,
    }));
    const wide = window.matchMedia(WIDE);
    const update = (scroll: number) => {
      const rate = wide.matches ? RATE.wide : RATE.narrow;
      for (const layer of layers) layer.set(-scroll * rate * layer.depth);
    };
    // Only while the hero is on screen: past it the islands are gone and rest where it left them.
    const trigger = ScrollTrigger.create({
      trigger: hero,
      start: 'top top',
      end: 'bottom top',
      onUpdate: (self) => update(Math.min(self.scroll(), self.end)),
      onRefresh: (self) => update(Math.min(self.scroll(), self.end)),
    });
    update(Math.min(window.scrollY, trigger.end));
    // quickSetter writes are not recorded by the context: clear them for the still hero.
    return () => gsap.set(islands, { clearProps: 'transform' });
  });

  return (
    <section ref={root} id="hero" aria-labelledby="kit-title" className="kit-hero" data-sky-clouds="off" style={MOTION_STYLE}>
      <div ref={sentinel} aria-hidden="true" className="kit-hero-sentinel" />
      <div className="kit-center">
        <KitName id="kit-title" />
        <p className="kit-title">
          <span>Everything floats.</span> <span>Nothing jumps.</span>
        </p>
        <p className="kit-lede">
          React components that drift in, settle softly and can be caught halfway. Install them with shadcn and own every
          line.
        </p>
        <InstallCommand align="center" className="kit-hero-install" />
      </div>
      <div className="kit-islands">
        {ISLANDS.map((island) => (
          <IslandView key={island.id} island={island}>
            {island.component ? RESTING[island.component]() : null}
          </IslandView>
        ))}
      </div>
    </section>
  );
}
