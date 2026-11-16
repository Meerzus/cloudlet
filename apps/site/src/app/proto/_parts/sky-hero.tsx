'use client';

import Link from 'next/link';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useScrollScene } from '@/components/site/motion';
import { usePageNotifications } from '@/components/site/notifications';
import { CloudImage } from '@/components/site/sky';
import { ColorPalette } from '@/components/ui/color-palette/color-palette';
import { ColorPicker } from '@/components/ui/color-picker/color-picker';
import { CLOUD_SHAPES } from '@/lib/clouds.generated';
import { gsap, ScrollTrigger } from '@/lib/gsap';
import { COLOR_PICKER_PATH, TOASTER_PATH } from '@/lib/site';
import { InstallCommand } from './install-command';
import { SloganSwitch, useSlogan } from './slogan-switch';

type Shape = (typeof CLOUD_SHAPES)[number]['id'];
const ASPECT = new Map<number, number>(CLOUD_SHAPES.map((shape) => [shape.id, shape.aspect]));

/** Pixels an island rises per scrolled pixel, on top of the page's own scroll, at depth 1. */
const RATE = 0.45;

/** A cloud with something resting on it; `depth` 0 is far, 1 is near (faster, sharper, bigger). */
function Island({ name, shape, depth, flip, children }: { name: string; shape: Shape; depth: number; flip?: boolean; children?: ReactNode }) {
  return (
    <div className={`pb-island pb-island-${name}`} data-depth={depth} style={{ '--depth': depth } as CSSProperties}>
      <div className="pb-island-rise">
        <div className="pb-cloud" data-flip={flip ? '' : undefined} style={{ aspectRatio: String(ASPECT.get(shape)) }}>
          <CloudImage shape={shape} theme="day" w={30} />
          <CloudImage shape={shape} theme="night" w={30} />
        </div>
        {children ? <div className="pb-thing">{children}</div> : null}
      </div>
    </div>
  );
}

/** The Toaster's island: a notification lying on the cloud; a press sends the real one. */
function ToastOnCloud() {
  const controller = usePageNotifications();
  return (
    <button
      type="button"
      className="proto-pill pb-toast"
      onClick={() => controller?.show({ title: 'Synced to the cloud', kind: 'success', description: { kind: 'text', text: 'Sent from a cloud on this page.' } })}
    >
      <span aria-hidden="true" className="proto-pill-icon" data-kind="success">
        <svg viewBox="0 0 16 16">
          <path d="M4.5 8.5 7 11l4.5-5.5" />
        </svg>
      </span>
      <span>Synced to the cloud</span>
      <span className="sr-only">: send this notification</span>
    </button>
  );
}

/**
 * Prototype B, the sky: the Toaster's sky over the whole first screen, Cloudlet written in clouds,
 * the three components resting on clouds at different depths. Scrolling lifts the near clouds
 * faster than the far ones (vertical only: clouds never move sideways); below, the sky gives way
 * to the world of each component.
 */
export function SkyHero() {
  const { slogan, index, select } = useSlogan('b');
  const [accent, setAccent] = useState('#4c94db');
  const [colors, setColors] = useState<string[]>(['#4c94db', '#f5b83d', '#e5484d']);
  const root = useRef<HTMLDivElement>(null);

  useScrollScene(root, () => {
    const islands = gsap.utils.toArray<HTMLElement>('[data-depth]');
    const layers = islands.map((element) => ({
      depth: Number(element.dataset['depth']),
      set: gsap.quickSetter(element, 'y', 'px') as (value: number) => void,
    }));
    const update = (scroll: number) => {
      for (const layer of layers) layer.set(-scroll * RATE * layer.depth);
    };
    ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (self) => update(self.scroll()) });
    update(window.scrollY);
    return () => gsap.set(islands, { clearProps: 'transform' });
  });

  return (
    <div ref={root} className="pb">
      <section aria-labelledby="proto-b-title" className="pb-hero">
        <div className="pb-islands">
          <Island name="far" shape={4} depth={0.15} />
          <Island name="palette" shape={5} depth={0.35}>
            <div className="pb-tray">
              <ColorPalette colors={colors} onChange={setColors} labels={{ group: 'Palette on a cloud' }} />
            </div>
          </Island>
          <Island name="picker" shape={6} depth={0.6} flip>
            <div className="pb-tray">
              <ColorPicker color={accent} onChange={setAccent} labels={{ open: 'Pick a color' }} />
              <span className="pb-tray-value">{accent}</span>
            </div>
          </Island>
          <Island name="toaster" shape={1} depth={1}>
            <ToastOnCloud />
          </Island>
          <Island name="near" shape={6} depth={1} />
        </div>
        <div className="pb-center">
          <h1 id="proto-b-title" className="pb-name">
            <span className="sr-only">Cloudlet</span>
            <picture aria-hidden="true" className="pb-wordmark cloud-day">
              <source type="image/avif" srcSet="/wordmark/wordmark-wide-day-800.avif 800w, /wordmark/wordmark-wide-day-1600.avif 1600w" sizes="(max-width: 640px) 88vw, 46vw" />
              {/* eslint-disable-next-line @next/next/no-img-element -- the name drawn in clouds, a picture */}
              <img src="/wordmark/wordmark-wide-day-800.webp" srcSet="/wordmark/wordmark-wide-day-800.webp 800w, /wordmark/wordmark-wide-day-1600.webp 1600w" sizes="(max-width: 640px) 88vw, 46vw" alt="" draggable={false} />
            </picture>
            <picture aria-hidden="true" className="pb-wordmark cloud-night">
              <source type="image/avif" srcSet="/wordmark/wordmark-wide-night-800.avif 800w, /wordmark/wordmark-wide-night-1600.avif 1600w" sizes="(max-width: 640px) 88vw, 46vw" />
              {/* eslint-disable-next-line @next/next/no-img-element -- the name drawn in clouds, a picture */}
              <img src="/wordmark/wordmark-wide-night-800.webp" srcSet="/wordmark/wordmark-wide-night-800.webp 800w, /wordmark/wordmark-wide-night-1600.webp 1600w" sizes="(max-width: 640px) 88vw, 46vw" alt="" draggable={false} />
            </picture>
          </h1>
          <p key={slogan.title} className="pb-title proto-swap">
            {slogan.title}
          </p>
          <p key={slogan.lede} className="pb-lede proto-swap">
            {slogan.lede}
          </p>
          <InstallCommand className="mt-8" align="center" />
        </div>
      </section>

      {/* A hint of what follows: the sky stays the Toaster's world, then gives way to the picker's paint. */}
      <section aria-label="What follows" className="pb-below">
        <div className="pb-world pb-world-sky">
          <h2>Toaster</h2>
          <p>Notifications that drift in, stack softly and open into a card when it matters.</p>
          <Link href={TOASTER_PATH}>Open Toaster →</Link>
        </div>
        <div className="pb-world pb-world-paint">
          <div className="pb-paint" aria-hidden="true" />
          <div className="pb-world-copy">
            <h2>Color picker and palette</h2>
            <p>A swatch that opens into a picker, and a row of them for a palette.</p>
            <Link href={COLOR_PICKER_PATH}>Open Color picker →</Link>
          </div>
        </div>
      </section>
      <SloganSwitch id="b" index={index} onSelect={select} />
    </div>
  );
}
