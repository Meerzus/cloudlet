import type GsapCore from 'gsap';
import type { ScrollTrigger as ScrollTriggerPlugin } from 'gsap/ScrollTrigger';
import type LenisSmooth from 'lenis';

/**
 * GSAP, ScrollTrigger and Lenis are loaded after the first paint, not in the page's first
 * scripts (L05): the hero needs none of them, and on a throttled phone their download and
 * parsing pushed the largest paint past Lighthouse's budget. The bindings below are live —
 * they fill in when `loadMotionRuntime()` resolves. MotionProvider loads them and reports
 * `ready`; nothing may touch them before that (scenes run only once motion is on).
 */
export let gsap: typeof GsapCore = undefined as unknown as typeof GsapCore;
export let ScrollTrigger: typeof ScrollTriggerPlugin = undefined as unknown as typeof ScrollTriggerPlugin;
export type ScrollTrigger = ScrollTriggerPlugin;
export let Lenis: typeof LenisSmooth = undefined as unknown as typeof LenisSmooth;
export type Lenis = LenisSmooth;

let loading: Promise<void> | null = null;

export function loadMotionRuntime(): Promise<void> {
  loading ??= Promise.all([import('gsap'), import('gsap/ScrollTrigger'), import('lenis')]).then(
    ([core, plugin, smooth]) => {
      gsap = core.default;
      ScrollTrigger = plugin.ScrollTrigger;
      Lenis = smooth.default;
      gsap.registerPlugin(ScrollTrigger);
    },
  );
  return loading;
}
