'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MORPH, SpringChannel } from '@/components/ui/color-picker/morph';
import { COMPONENTS, componentOf } from '@/lib/site';

type Phase = 'closed' | 'open' | 'closing';
/** Four insets (top, right, bottom, left) and a corner radius, CSS px, inside the panel's box. */
type Shape = readonly [number, number, number, number, number];

/** The card's width from `sm` up; below it the card spans the window less the gutters. */
const CARD_WIDTH = 340;
const GUTTER = 16;
/** Gap between the trigger (or, on phones, the header) and the card. */
const GAP = 8;
const CARD_RADIUS = 16;
const PHONE = 640;

const mix = (from: Shape, to: Shape, progress: number) => from.map((value, index) => value + ((to[index] ?? value) - value) * progress) as unknown as Shape;
const inset = ([top, right, bottom, left, radius]: Shape) => `inset(${top}px ${right}px ${bottom}px ${left}px round ${Math.max(0, radius)}px)`;
const drop = (progress: number) => {
  const p = Math.max(0, Math.min(1, progress));
  return `drop-shadow(0 ${12 * p}px ${28 * p}px rgb(0 0 0 / ${0.22 * p})) drop-shadow(0 ${p}px ${2 * p}px rgb(0 0 0 / ${0.1 * p}))`;
};

/**
 * Components in the header: a disclosure that opens a list of the kit's components, each a link
 * to its landing with one line of description; the current component is marked `aria-current`.
 * The panel is one shape that grows out of the button: its box spans the button and the card, and
 * its clip morphs from the button's pill into the card on the Island's springs, so a press mid-way
 * turns it back from wherever it is. The links unblur in after the shape has started to grow.
 * Escape closes and returns focus to the button; a press outside, focus leaving, a link and a new
 * page close it. Opens on click or tap only. Reduced motion: it appears and goes at once.
 */
export function ComponentsMenu({ className }: { className?: string }) {
  const pathname = usePathname();
  const current = componentOf(pathname);
  const id = useId();
  const [phase, setPhase] = useState<Phase>('closed');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const shape = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const geometry = useRef<{ collapsed: Shape; expanded: Shape } | null>(null);
  const progress = useRef(new SpringChannel(0));
  const running = useRef<Animation[]>([]);

  const close = (refocus: boolean) => {
    setPhase((now) => (now === 'open' ? 'closing' : now));
    if (refocus) trigger.current?.focus();
  };

  /** Lays the panel's box over the button and the card, in the header's coordinates; returns both shapes. */
  const place = () => {
    const box = wrapper.current;
    const card = nav.current;
    const button = trigger.current;
    const header = button?.closest('.site-header');
    if (!box || !card || !button || !header) return null;
    const head = header.getBoundingClientRect();
    const t = button.getBoundingClientRect();
    const view = document.documentElement.clientWidth;
    const phone = view < PHONE;
    const width = phone ? view - 2 * GUTTER : Math.min(CARD_WIDTH, view - 2 * GUTTER);
    const left = phone ? GUTTER : Math.min(Math.max(GUTTER, t.left), view - GUTTER - width);
    const top = (phone ? head.bottom : t.bottom) + GAP;
    card.style.width = `${width}px`;
    const height = card.offsetHeight;
    const bounds = { left: Math.min(t.left, left), top: Math.min(t.top, top), right: Math.max(t.right, left + width), bottom: Math.max(t.bottom, top + height) };
    Object.assign(box.style, {
      left: `${bounds.left - head.left}px`,
      top: `${bounds.top - head.top}px`,
      width: `${bounds.right - bounds.left}px`,
      height: `${bounds.bottom - bounds.top}px`,
    });
    card.style.left = `${left - bounds.left}px`;
    card.style.top = `${top - bounds.top}px`;
    const collapsed: Shape = [t.top - bounds.top, bounds.right - t.right, bounds.bottom - t.bottom, t.left - bounds.left, t.height / 2];
    const expanded: Shape = [top - bounds.top, bounds.right - left - width, bounds.bottom - top - height, left - bounds.left, CARD_RADIUS];
    geometry.current = { collapsed, expanded };
    return geometry.current;
  };

  useLayoutEffect(() => {
    const box = wrapper.current;
    const clip = shape.current;
    const card = nav.current;
    if (phase === 'closed' || !box || !clip || !card) return;
    const fresh = !box.hasAttribute('data-placed');
    const items = Array.from(card.querySelectorAll('li'));
    // How far the links had faded in, read before their animations are cancelled: a fresh panel starts from nothing.
    const seen = fresh ? 0 : parseFloat(getComputedStyle(items[0] ?? card).opacity);
    for (const animation of running.current) animation.cancel();
    running.current = [];
    const opening = phase === 'open';
    const target = opening ? 1 : 0;
    // Placed once per opening: an open that interrupts a close keeps the shapes it had.
    const shapes = (fresh ? place() : geometry.current) ?? place();
    if (!shapes) return;
    box.setAttribute('data-placed', '');
    const at = (value: number) => inset(mix(shapes.collapsed, shapes.expanded, value));
    // The resting state, under whatever animates: the card when open.
    clip.style.clipPath = at(target);
    box.style.filter = drop(target);
    const still = typeof clip.animate !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || clip.closest('[data-reduced-motion]') !== null;
    if (still) {
      progress.current.settle(target);
      if (!opening) setPhase('closed');
      return;
    }
    const animations: Animation[] = [];
    const play = (node: Element, keyframes: PropertyIndexedKeyframes, timing: KeyframeAnimationOptions) => {
      const animation = node.animate(keyframes, { fill: 'both', ...timing });
      animations.push(animation);
      return animation;
    };
    const move = progress.current.retarget(target, opening ? MORPH.sizeOpen : MORPH.sizeClose);
    let last: Animation | null = null;
    if (move) {
      last = play(clip, { clipPath: [at(move.from), at(move.to)] }, { duration: move.duration, easing: move.easing });
      play(box, { filter: [drop(move.from), drop(move.to)] }, { duration: move.duration, easing: move.easing });
    }
    // The links unblur in one after another once the shape has started to grow, and blur out faster.
    const blur = (from: number, to: number) => ({ opacity: [from, to], filter: [`blur(${MORPH.blur * (1 - from)}px)`, `blur(${MORPH.blur * (1 - to)}px)`] });
    const shown = Number.isFinite(seen) ? seen : opening ? 0 : 1;
    items.forEach((item, index) => {
      if (opening) play(item, blur(shown, 1), { duration: MORPH.contentIn, delay: shown > 0 ? 0 : MORPH.contentDelay + index * MORPH.stagger, easing: 'ease-out' });
      else play(item, blur(shown, 0), { duration: MORPH.contentOut, easing: 'ease-in' });
    });
    running.current = animations;
    if (!opening) {
      if (last) last.finished.then(() => setPhase('closed'), () => {});
      else setPhase('closed');
    }
  }, [phase]);

  // While open: a press or focus outside (the docs' drawer takes focus as it opens), Escape anywhere and a resize.
  useEffect(() => {
    if (phase !== 'open') return;
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) close(false);
    };
    // Safari does not focus a clicked button, so Escape may arrive with focus on the page.
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) close(true);
    };
    const resize = () => {
      const shapes = place();
      if (shapes && shape.current) shape.current.style.clipPath = inset(shapes.expanded);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', resize);
    };
  }, [phase]);

  // A new page closes the panel.
  const seenPath = useRef(pathname);
  useEffect(() => {
    if (seenPath.current === pathname) return;
    seenPath.current = pathname;
    close(false);
  }, [pathname]);

  const links = () => Array.from(nav.current?.querySelectorAll<HTMLAnchorElement>('a') ?? []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && phase === 'open') {
      event.preventDefault();
      close(true);
      return;
    }
    if (phase !== 'open' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const all = links();
    if (all.length === 0) return;
    const index = all.indexOf(document.activeElement as HTMLAnchorElement);
    const next =
      event.key === 'Home' ? 0
      : event.key === 'End' ? all.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % all.length
      : index < 0 ? all.length - 1 : (index - 1 + all.length) % all.length;
    event.preventDefault();
    all[next]?.focus();
  };

  return (
    <div
      ref={root}
      className={className}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        // Focus moved on to something outside the button and the panel: close, leave focus there.
        const next = event.relatedTarget;
        if (phase === 'open' && next instanceof Node && !event.currentTarget.contains(next)) close(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={phase === 'open'}
        aria-controls={phase === 'closed' ? undefined : id}
        onClick={() => setPhase((now) => (now === 'open' ? 'closing' : 'open'))}
        className="components-trigger relative z-[3] inline-flex h-8 items-center gap-1 rounded-full px-3 text-sm font-medium outline-none transition-[color,background-color] hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60 aria-expanded:bg-accent aria-expanded:text-accent-foreground max-sm:px-2.5 max-[23.75rem]:px-2"
      >
        Components
        <ChevronDown className="components-chevron size-3.5 opacity-60" aria-hidden="true" />
      </button>
      {phase === 'closed' ? null : (
        // The box spans the button and the card; the clip draws the shape, the filter its shadow.
        <div ref={wrapper} className="components-panel" data-phase={phase}>
          <div ref={shape} className="components-panel-shape">
            <nav ref={nav} id={id} aria-label="Components" className="components-panel-card">
              <ul>
                {COMPONENTS.map((component) => (
                  <li key={component.id}>
                    <Link
                      href={component.path}
                      aria-current={component.id === current?.id ? 'page' : undefined}
                      onClick={() => close(false)}
                      className="components-panel-link"
                    >
                      <span className="block text-sm font-medium text-foreground">{component.name}</span>
                      <span className="mt-0.5 block text-[0.8125rem] leading-snug text-pretty text-muted-foreground">{component.description}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
