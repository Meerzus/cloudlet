'use client';

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import Link from 'next/link';
import { gsap, ScrollTrigger } from '@/lib/gsap';
import { DOCS_PATH, LICENSE_URL } from '@/lib/site';
import { WORDMARK_HALO_PAD, WORDMARK_WIDTHS, WORDMARKS } from '@/lib/wordmark.generated';
import { ExternalLink } from './external-link';
import { BANK, FooterClouds } from './footer-clouds';
import { CloudletIcon } from './icons';
import { useMotion, useScrollScene } from './motion';

/** The owner's wordmark, Figma 37:1195 (`wide`), picked over 37:1197; the manifest holds just it. */
const [WORDMARK] = WORDMARKS;

const LINK =
  'rounded-sm font-normal text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60';

/**
 * The wordmark's motions (owner's picks from a side-by-side of four; a spring "landing" was dropped):
 * - approach: as the footer enters it rises from `rise`% of its height below its place and grows
 *   from `scale` to full size;
 * - pointer: at the end it shifts up to POINTER px after the pointer (fine pointers only); the cloud
 *   bank ignores the pointer and only drifts;
 * - breathe: at the end it bobs slowly, BREATHE.amplitude px over BREATHE.period seconds.
 */
const APPROACH = { rise: 45, scale: 0.7 } as const;
const POINTER = { x: 14, y: 8, smoothing: 0.25 } as const;
const BREATHE = { amplitude: 6, period: 6 } as const;
/** The end of the page: the rise's progress past which the drift and the end-only motions start. */
const END = 0.985;
/** Time constant of easing into and out of the end (seconds): the drift reaches speed in ~1.5 s. */
const END_EASE = 0.5;
/** Bank parallax: a layer of depth d starts d × BANK_RISE viewport heights low. */
const BANK_RISE = 0.5;
/** Drift speed of the nearest bank layer, px per second, left to right; farther layers scale by depth. */
const DRIFT = 15;

/** True while `element` is in the viewport, grown by `margin` (an IntersectionObserver rootMargin). */
function useOnScreen(element: RefObject<HTMLElement | null>, margin = '0px'): boolean {
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting ?? false), { rootMargin: margin });
    observer.observe(target);
    return () => observer.disconnect();
  }, [element, margin]);
  return onScreen;
}

/** The halo cut out of the clouds around the letters, made by export-wordmark.mjs. */
const HALO = `/wordmark/wordmark-${WORDMARK.id}-halo.png`;

/**
 * The halo as a data: URL, or null until it has been fetched. Chrome skips painting an element
 * whose mask image is still loading, and a CSS image by URL is fetched again (revalidated) on first
 * use even when it was preloaded, so masking by URL blinks every cloud in the sky away for a network
 * round trip as the footer arrives. A data: URL is loaded synchronously: the mask paints at once.
 */
function useHalo(near: boolean): string | null {
  const [halo, setHalo] = useState<string | null>(null);
  useEffect(() => {
    // Fetched as the footer nears, not with the first screen (L05: it competed with the hero).
    if (!near || halo) return;
    let live = true;
    fetch(HALO)
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(response.statusText))))
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          }),
      )
      // Without the halo the clouds simply don't part around the letters.
      .then((url) => live && setHalo(url), () => {});
    return () => {
      live = false;
    };
  }, [near, halo]);
  return halo;
}

/**
 * While the footer is on screen, the sky's clouds (`.sky-clouds`) and the footer's own bank are cut
 * by a soft halo shaped like the letters (`/wordmark/wordmark-<id>-halo.png`, made by
 * export-wordmark.mjs): clouds keep drifting everywhere else but part around the wordmark. The halo
 * follows the drawn image (object-fit: contain, centred, plus every motion) frame by frame.
 */
function useWordmarkMask(
  drawn: RefObject<HTMLDivElement | null>,
  bank: RefObject<HTMLDivElement | null>,
  halo: string | null,
  onScreen: boolean,
) {
  const { ready } = useMotion();
  useEffect(() => {
    const element = drawn.current;
    const sky = document.querySelector<HTMLElement>('.sky-clouds');
    const frame = bank.current;
    if (!ready || !halo || !onScreen || !element || !sky || !frame) return;
    const { aspect } = WORDMARK;
    const root = document.documentElement;
    const masked = [sky, frame];
    // The box goes straight into the two masked elements' own mask-position and mask-size, and
    // only when it moved. A custom property on <html> would be inherited by every element of the
    // page: writing it each frame restyled the whole document, and the end of the page ran at
    // ~25 fps even at rest on a laptop without a fast GPU.
    let last = '';
    const place = () => {
      const box = element.getBoundingClientRect();
      const width = Math.min(box.width, box.height * aspect);
      const height = width / aspect;
      const pad = width * WORDMARK_HALO_PAD;
      const x = box.left + (box.width - width) / 2 - pad;
      const y = box.top + (box.height - height) / 2 - pad;
      const bankBox = frame.getBoundingClientRect();
      const size = `100% 100%, ${width + 2 * pad}px ${height + 2 * pad}px`;
      const next = `${x} ${y} ${bankBox.left} ${bankBox.top} ${size}`;
      if (next === last) return;
      last = next;
      sky.style.maskPosition = `0 0, ${x}px ${y}px`;
      frame.style.maskPosition = `0 0, ${x - bankBox.left}px ${y - bankBox.top}px`;
      for (const target of masked) target.style.maskSize = size;
    };
    root.style.setProperty('--wordmark-mask', `url("${halo}")`);
    root.dataset.wordmarkMask = '';
    place();
    // Every frame while the footer is on screen: scroll, the rise and the motions all move it.
    gsap.ticker.add(place);
    return () => {
      gsap.ticker.remove(place);
      delete root.dataset.wordmarkMask;
      root.style.removeProperty('--wordmark-mask');
      for (const target of masked) {
        target.style.removeProperty('mask-position');
        target.style.removeProperty('mask-size');
      }
    };
  }, [ready, drawn, bank, halo, onScreen]);
}

function WordmarkImage({ theme }: { theme: 'day' | 'night' }) {
  const { id } = WORDMARK;
  const set = (format: 'avif' | 'webp') =>
    WORDMARK_WIDTHS.map((width) => `/wordmark/wordmark-${id}-${theme}-${width}.${format} ${width}w`).join(', ');
  return (
    <picture className={`cloud-${theme}`}>
      <source type="image/avif" srcSet={set('avif')} sizes="100vw" />
      <img
        src={`/wordmark/wordmark-${id}-${theme}-${WORDMARK_WIDTHS[1]}.webp`}
        srcSet={set('webp')}
        sizes="100vw"
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    </picture>
  );
}

/**
 * The end of the page: one line of links, then the owner's wordmark rendered as cloud above a bank
 * of sky clouds. On screens wider than tall the wordmark gets a whole screen (100dvh), as large as
 * it fits and centred, so the sky gets a long last stretch of parallax; on portrait screens it spans
 * the width at its own aspect. As the footer scrolls in the letters rise and grow into place (APPROACH)
 * and the bank's layers rise by depth; over the last header-height the header (with its blur strip)
 * slides up and away; at the very end the bank drifts left to right while the wordmark follows the
 * pointer and breathes. The sky's clouds part around the letters (useWordmarkMask). Reduced motion
 * keeps everything still.
 */
export function Footer() {
  const footer = useRef<HTMLElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const drawn = useRef<HTMLDivElement>(null);
  const bank = useRef<HTMLDivElement>(null);
  const layers = useRef<(HTMLDivElement | null)[]>([]).current;
  useWordmarkMask(drawn, bank, useHalo(useOnScreen(footer, '200% 0px')), useOnScreen(footer));

  useScrollScene(footer, () => {
    const rising = art.current;
    const moving = drawn.current;
    const header = document.querySelector<HTMLElement>('.site-header');
    const strip = document.querySelector<HTMLElement>('.site-edge');
    const bankLayers = layers.filter((layer): layer is HTMLDivElement => layer !== null);
    if (!rising || !moving || !header || !strip || !bank.current) return;
    const lift = gsap.quickSetter([header, strip], 'yPercent') as (value: number) => void;
    const setRise = gsap.quickSetter(rising, 'yPercent') as (value: number) => void;
    // quickSetter ignores the `scale` alias: set both axes.
    const setScaleX = gsap.quickSetter(rising, 'scaleX') as (value: number) => void;
    const setScaleY = gsap.quickSetter(rising, 'scaleY') as (value: number) => void;
    const setX = gsap.quickSetter(moving, 'x', 'px') as (value: number) => void;
    const setY = gsap.quickSetter(moving, 'y', 'px') as (value: number) => void;
    const bankX = bankLayers.map((layer) => gsap.quickSetter(layer, 'x', 'px') as (value: number) => void);
    const bankY = bankLayers.map((layer) => gsap.quickSetter(layer, 'y', 'px') as (value: number) => void);

    let progress = 0;
    // Both triggers sit below the pinned scenes, whose spacers move them: measure them last.
    ScrollTrigger.create({
      trigger: footer.current,
      refreshPriority: -1,
      start: 'top bottom',
      end: 'bottom bottom',
      onUpdate: (self) => (progress = self.progress),
      onRefresh: (self) => (progress = self.progress),
    });
    // The wordmark's top edge pushes the header out: from the header's bottom to the very top.
    ScrollTrigger.create({
      trigger: box.current,
      refreshPriority: -1,
      start: () => `top ${header.offsetHeight}px`,
      end: 'top top',
      onUpdate: (self) => lift(-100 * self.progress),
      onRefresh: (self) => lift(-100 * self.progress),
    });

    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    const fine = window.matchMedia('(pointer: fine)').matches;
    const follow = (event: PointerEvent) => {
      pointer.targetX = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.targetY = (event.clientY / window.innerHeight) * 2 - 1;
    };
    if (fine) window.addEventListener('pointermove', follow, { passive: true });

    const drift = BANK.map(() => 0);
    let end = 0;
    const tick = (time: number, deltaMs: number) => {
      const dt = Math.min(deltaMs / 1000, 0.05);
      const ease = (constant: number) => 1 - Math.exp(-dt / constant);
      end += ((progress > END ? 1 : 0) - end) * ease(END_EASE);

      setRise(APPROACH.rise * (1 - progress));
      const scale = APPROACH.scale + (1 - APPROACH.scale) * progress;
      setScaleX(scale);
      setScaleY(scale);

      pointer.x += (pointer.targetX - pointer.x) * ease(POINTER.smoothing);
      pointer.y += (pointer.targetY - pointer.y) * ease(POINTER.smoothing);
      const bob = Math.sin((time * 2 * Math.PI) / BREATHE.period) * BREATHE.amplitude * end;
      setX(pointer.x * POINTER.x * end);
      setY(pointer.y * POINTER.y * end + bob);

      const width = bank.current?.clientWidth ?? 1;
      BANK.forEach((layer, index) => {
        drift[index] = ((drift[index] ?? 0) + DRIFT * layer.depth * end * dt) % width;
        bankX[index]?.(drift[index] ?? 0);
        bankY[index]?.((1 - progress) * layer.depth * BANK_RISE * window.innerHeight);
      });
    };
    gsap.ticker.add(tick);

    // FAQ answers open and close above the footer: re-measure once the page height settles.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const resize = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => ScrollTrigger.refresh(), 150);
    });
    resize.observe(document.body);
    // quickSetter writes are not recorded by the context: clear them for the still layout.
    return () => {
      gsap.ticker.remove(tick);
      window.removeEventListener('pointermove', follow);
      resize.disconnect();
      clearTimeout(timer);
      gsap.set([rising, moving, header, strip, ...bankLayers], { clearProps: 'transform' });
    };
  });

  return (
    <>
      <footer ref={footer} className="site-footer" style={{ '--wordmark-aspect': WORDMARK.aspect } as CSSProperties}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 pt-12 pb-6 font-semibold tracking-tight sm:px-6">
          <CloudletIcon idPrefix="footer-icon" className="size-6" />
          Cloudlet
          <span className="font-normal text-muted-foreground" aria-hidden="true">
            ·
          </span>
          <ExternalLink href={LICENSE_URL} className={LINK}>
            MIT License
          </ExternalLink>
          <span className="font-normal text-muted-foreground" aria-hidden="true">
            ·
          </span>
          <Link href={DOCS_PATH} className={LINK}>
            Docs
          </Link>
        </div>
        <div ref={box} className="footer-wordmark" aria-hidden="true">
          <FooterClouds bankRef={bank} layerRefs={layers} />
          <div ref={art} className="footer-wordmark-art">
            <div ref={drawn} className="footer-wordmark-drawn">
              <WordmarkImage theme="day" />
              <WordmarkImage theme="night" />
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
