'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { addTransitionType, startTransition, useEffect, useLayoutEffect, useState, ViewTransition, type MouseEvent, type ReactNode } from 'react';
import { pageStill, REDUCED_QUERY, stillWanted } from '@/lib/reduced-motion';
import { openTypes, SCENE_BACK, SCENE_OPEN, sceneOfTypes, traversalTypes, type SceneId } from '@/lib/scene-transition';
import { springEasing } from '@/lib/spring';
import { useMediaQuery } from './use-media-query';


/** The landing grows on this spring (CSS `linear()`), the feel of the Toaster's device morph. */
const GROW = springEasing({ stiffness: 190, damping: 24 });
/** Content settles in on a softer one. */
const SETTLE = springEasing({ stiffness: 150, damping: 22 });

interface Leaving {
  /** The scene's link in the window, when the kit's page is the one being left and the link is on screen. */
  readonly link: DOMRect | null;
  readonly scroll: number;
}
/** The page being left, as the navigation starts. */
let leaving: Leaving = { link: null, scroll: 0 };
/** The page and hash the visitor is on, for the next move through history. */
let here = '';

const inView = (element: Element | null) => {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
};

/** The scene's link on the kit's page. */
const linkOf = (scene: SceneId) => document.querySelector(`[data-scene-link='${scene}']`);

/** Notes the page being left, as a navigation with a scene's type starts. */
function leave(link: Element | null) {
  leaving = { link: inView(link) ? link!.getBoundingClientRect() : null, scroll: window.scrollY };
}

/**
 * Back and forward: the browser puts back the scroll of the page it returns to before the page has
 * changed, so the picture of the page being left would show it somewhere else. The first frame puts
 * the page being left back where it was, and the stage scrolls to the restored place once the new
 * page is in (in the transition's commit, before the new picture is taken).
 */
let restore: number | null = null;
function holdScroll() {
  const kept = window.scrollY;
  restore = null;
  requestAnimationFrame(() => {
    if (window.scrollY === kept) return;
    restore = window.scrollY;
    window.scrollTo({ top: kept, behavior: 'instant' });
  });
}

/*
 * The page's two pictures (old and new) are as tall as the page: a box in the window is a box in the
 * picture moved down by how far that page was scrolled.
 */
const OLD = '::view-transition-old(scene-page)';
const NEW = '::view-transition-new(scene-page)';
/** Every animation a transition starts, cancelled when it ends: they target the pseudo-elements by name and would outlive it. */
let running: Animation[] = [];
const run = (pseudoElement: string, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
  running.push(document.documentElement.animate(keyframes, { ...options, pseudoElement, fill: 'both' }));
};
const stop = () => {
  for (const animation of running) animation.cancel();
  running = [];
};

interface Box {
  readonly top: number;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
}

/** `inset()` of a window box in a picture of a page scrolled by `scroll`, its corners rounded by `round`. */
function insetOf(box: Box, scroll: number, round: number) {
  return `inset(${box.top + scroll}px calc(100% - ${box.right}px) calc(100% - ${box.bottom + scroll}px) ${box.left}px round ${round}px)`;
}

/** The whole page goes soft and the next one settles in out of the blur; the header holds still. */
function blur(open: boolean, shift: number) {
  const away = `translateY(${shift}px)`;
  run(OLD, [{ opacity: 1, filter: 'blur(0px)', transform: away }, { opacity: 0, filter: 'blur(12px)', transform: away }], { duration: 220, easing: 'cubic-bezier(0.4, 0, 1, 1)' });
  run(
    NEW,
    [
      { opacity: 0, filter: 'blur(12px)', transform: `translateY(${open ? 18 : -18}px)` },
      { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0px)' },
    ],
    { duration: SETTLE.duration, easing: SETTLE.easing, delay: 70 },
  );
}

/**
 * The landing grows out of the link that opened it, like the Island out of its pill; the page left
 * behind sinks back a little. Back is the same in reverse: the landing shrinks into the link.
 */
function grow(open: boolean, link: DOMRect, scrolls: { old: number; new: number }) {
  const pad = 10;
  const pill = { top: link.top - pad, left: link.left - pad, right: link.right + pad, bottom: link.bottom + pad };
  const round = (link.height + pad * 2) / 2;
  const screen = { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
  const options = { duration: GROW.duration, easing: GROW.easing };
  // The kit's page, behind: it sinks back around the link (the old picture going, or the new one coming back).
  const kit = open ? { picture: OLD, scroll: scrolls.old, shift: scrolls.new - scrolls.old } : { picture: NEW, scroll: scrolls.new, shift: 0 };
  const origin = `${link.left + link.width / 2}px ${link.top + link.height / 2 + kit.scroll}px`;
  const near = { transform: `translateY(${kit.shift}px) scale(1)`, transformOrigin: origin, opacity: 1, filter: 'blur(0px)' };
  const far = { transform: `translateY(${kit.shift}px) scale(0.94)`, transformOrigin: origin, opacity: 0.5, filter: 'blur(6px)' };
  if (open) {
    run(NEW, [{ clipPath: insetOf(pill, scrolls.new, round) }, { clipPath: insetOf(screen, scrolls.new, 0) }], options);
    run(kit.picture, [near, far], options);
    return;
  }
  // The landing leaves over the kit's page, from where it was scrolled.
  const from = `translateY(${scrolls.new - scrolls.old}px)`;
  run(
    OLD,
    [
      { clipPath: insetOf(screen, scrolls.old, 0), transform: from, opacity: 1 },
      { clipPath: insetOf(pill, scrolls.old, round), transform: from, opacity: 1, offset: 0.8 },
      { clipPath: insetOf(pill, scrolls.old, round), transform: from, opacity: 0 },
    ],
    options,
  );
  run(kit.picture, [far, near], options);
}

/** Plays the transition the navigation's types ask for, once both pictures are taken. */
function play(types: readonly string[]) {
  const open = types.includes(SCENE_OPEN);
  if (!open && !types.includes(SCENE_BACK)) return;
  stop();
  // The transition running now (the standard property, or the one React keeps), to clean up after it.
  const live = document as Document & { activeViewTransition?: { finished: Promise<void> } | null; __reactViewTransition?: { finished: Promise<void> } | null };
  void (live.activeViewTransition ?? live.__reactViewTransition)?.finished.finally(stop);
  const scrolls = { old: leaving.scroll, new: window.scrollY };
  const scene = sceneOfTypes(types);
  // The kit's page shows the link: the landing grows out of it. Otherwise (a link scrolled away) a soft swap.
  const back = !open && scene ? linkOf(scene) : null;
  const link = open ? leaving.link : inView(back) ? back!.getBoundingClientRect() : null;
  if (link) grow(open, link, scrolls);
  else blur(open, scrolls.new - scrolls.old);
}

const PAGE = { [SCENE_OPEN]: 'scene-page', [SCENE_BACK]: 'scene-page', default: 'none' };

/** Moves the stage in the navigation's own transition (SceneStage sets it). */
let kick: (() => void) | null = null;

/** Starts a navigation with the scene's types; `go` runs inside the same transition (the router's push, or nothing for history). */
function navigate(types: readonly string[], go: () => void) {
  startTransition(() => {
    for (const type of types) addTransitionType(type);
    kick?.();
    go();
  });
}

/**
 * A scene's "Open …" link: the only link that turns the kit's page into a landing. Nothing moves
 * with reduced motion, the page’s own switch on (or before the preference is known).
 */
export function SceneLink({ scene, href, className, children }: { scene: SceneId; href: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  const reduced = useMediaQuery(REDUCED_QUERY);
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    // A new tab or window, or no motion: the link as it is.
    if (reduced !== false || pageStill() || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    leave(event.currentTarget);
    navigate(openTypes(scene), () => router.push(href));
  };
  return (
    <Link href={href} className={className} data-scene-link={scene} onClick={open}>
      {children}
    </Link>
  );
}

/**
 * The stage every page stands on (the root layout's child): one picture of the whole page that the
 * scene transition moves — React keeps the document root out of its view transitions. It becomes a
 * named picture only for a navigation with a scene's type, whatever the two pages are made of.
 *
 * It also gives the browser's back and forward between the kit's page and a landing those types: its
 * popstate listener runs before the router's (capture), and the stage's own update in the same
 * transition keeps the types for the router's render that follows.
 */
export function SceneStage({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [count, bump] = useState(0);

  useEffect(() => {
    here = `${window.location.pathname}${window.location.hash}`;
  }, [pathname]);

  useEffect(() => {
    kick = () => bump((value) => value + 1);
    const hash = () => {
      here = `${window.location.pathname}${window.location.hash}`;
    };
    const traverse = () => {
      const from = here;
      const to = `${window.location.pathname}${window.location.hash}`;
      here = to;
      const types = traversalTypes(from, to);
      if (!types || window.matchMedia(REDUCED_QUERY).matches || stillWanted() || !('startViewTransition' in document)) return;
      const open = types.includes(SCENE_OPEN);
      const scene = sceneOfTypes(types);
      leave(open && scene ? linkOf(scene) : null);
      holdScroll();
      navigate(types, () => {});
    };
    window.addEventListener('hashchange', hash);
    window.addEventListener('popstate', traverse, { capture: true });
    return () => {
      kick = null;
      window.removeEventListener('hashchange', hash);
      window.removeEventListener('popstate', traverse, { capture: true });
    };
  }, []);

  // In the commit of a move through history: the restored scroll, before the new picture is taken.
  useLayoutEffect(() => {
    if (restore === null) return;
    window.scrollTo({ top: restore, behavior: 'instant' });
    restore = null;
  }, [pathname]);

  return (
    <ViewTransition name="scene-page" update={PAGE} default="none" onUpdate={(_, types) => play(types)}>
      <div className="scene-page" data-scene-run={count}>
        {children}
      </div>
    </ViewTransition>
  );
}
