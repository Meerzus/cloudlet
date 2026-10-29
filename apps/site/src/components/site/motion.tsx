'use client';

import { usePathname } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { gsap, Lenis, loadMotionRuntime, ScrollTrigger } from '@/lib/gsap';
import { isQuietPath } from '@/lib/site';

interface MotionState {
  /** GSAP, ScrollTrigger and Lenis have loaded (`@/lib/gsap`); false on reading pages. */
  readonly ready: boolean;
  /** True until the client proves `prefers-reduced-motion: no-preference`. */
  readonly reduced: boolean;
  /** Smooth wheel scrolling; null with reduced motion and on touch/coarse pointers. */
  readonly lenis: Lenis | null;
}

const INITIAL: MotionState = { ready: false, reduced: true, lenis: null };
const MotionContext = createContext<MotionState>(INITIAL);

const QUERIES = {
  motion: '(prefers-reduced-motion: no-preference)',
  fine: '(pointer: fine)',
} as const;

/** Runs `task` after the next frame has been presented (rAF, then a task after it). */
function afterFirstPaint(task: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(task, 0);
  });
  return {
    cancel() {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    },
  };
}

/**
 * The single owner of page motion. Lenis follows the official ScrollTrigger
 * integration (GSAP ticker drives Lenis, Lenis scroll updates ScrollTrigger).
 * gsap.matchMedia re-runs on preference changes, so switching to reduced motion
 * at runtime destroys Lenis and every scene reverts to its static layout.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MotionState>(INITIAL);
  // Reading pages (DOCS.md §7) get native scrolling and no scenes; leaving them re-runs the setup.
  const quiet = isQuietPath(usePathname());

  useEffect(() => {
    if (quiet) {
      setState(INITIAL);
      return;
    }
    let live = true;
    let mm: gsap.MatchMedia | null = null;
    const setup = () => {
      if (!live) return;
      mm = gsap.matchMedia();
      mm.add(QUERIES, (context) => {
        const { motion, fine } = context.conditions ?? {};
        if (!motion) {
          setState({ ready: true, reduced: true, lenis: null });
          return;
        }
        if (!fine) {
          // Touch keeps native scrolling; scenes still run on scroll position.
          setState({ ready: true, reduced: false, lenis: null });
          return;
        }
        const lenis = new Lenis({ syncTouch: false, anchors: true, autoRaf: false });
        lenis.on('scroll', ScrollTrigger.update);
        const tick = (time: number) => lenis.raf(time * 1000);
        gsap.ticker.add(tick);
        gsap.ticker.lagSmoothing(0);
        setState({ ready: true, reduced: false, lenis });
        return () => {
          gsap.ticker.remove(tick);
          gsap.ticker.lagSmoothing(500, 33);
          lenis.destroy();
        };
      });
    };
    // The runtime loads once the first frame is on screen, not during hydration. If it fails to
    // load the page keeps its static, reduced-motion layout, which is complete on its own.
    const start = afterFirstPaint(() => void loadMotionRuntime().then(setup, () => {}));
    return () => {
      live = false;
      start.cancel();
      mm?.revert();
    };
  }, [quiet]);

  return <MotionContext.Provider value={state}>{children}</MotionContext.Provider>;
}

export function useMotion() {
  return useContext(MotionContext);
}

/**
 * Runs a GSAP setup scoped to `scope` only when motion is allowed. Everything
 * created inside (tweens, ScrollTriggers) is reverted when motion turns off,
 * `enabled` turns false or the component unmounts, restoring the static, reduced-motion layout.
 */
export function useScrollScene(
  scope: RefObject<HTMLElement | null>,
  setup: (context: gsap.Context) => void | (() => void),
  enabled = true,
) {
  const { reduced } = useMotion();
  const latest = useRef(setup);
  useLayoutEffect(() => {
    latest.current = setup;
  });
  useEffect(() => {
    if (reduced || !enabled || !scope.current) return;
    const context = gsap.context((self) => latest.current(self), scope.current);
    return () => context.revert();
  }, [reduced, enabled, scope]);
}
