/**
 * A page's own "reduce motion" switch, beside the system preference: one attribute on `<html>`,
 * written once per change (never per frame). The page's motion owner (MotionProvider), its CSS and
 * the registry components (which honour any `data-reduced-motion` ancestor) read it like
 * `prefers-reduced-motion: reduce`. Only the kit's landing sets it; it is removed when that page goes.
 */
export const STILL_ATTRIBUTE = 'data-reduced-motion';
export const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/** What the switch asked for during this visit: it outlives the page, so coming back keeps it. */
let wanted = false;

/** The system asks for reduced motion. */
export function systemReduced(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(REDUCED_QUERY).matches === true;
}

/** The page's switch is on (the attribute is on `<html>`). */
export function switchedStill(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute(STILL_ATTRIBUTE);
}

/** Nothing on the page should move: the system or the page's switch asks for it. */
export function pageStill(): boolean {
  return systemReduced() || switchedStill();
}

/** The switch's choice for this visit, whether or not its page is on screen. */
export function stillWanted(): boolean {
  return wanted;
}

/** Turns the page's switch on or off: the attribute goes on `<html>` or comes off, once. */
export function setStill(on: boolean) {
  wanted = on;
  document.documentElement.toggleAttribute(STILL_ATTRIBUTE, on);
}

/** The switch's page is leaving: the attribute comes off, the choice is kept for a return. */
export function releaseStill() {
  document.documentElement.removeAttribute(STILL_ATTRIBUTE);
}

/** Calls `change` whenever the system preference or the page's switch changes. */
export function watchStill(change: () => void): () => void {
  const media = window.matchMedia?.(REDUCED_QUERY);
  media?.addEventListener?.('change', change);
  const observer = new MutationObserver(change);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [STILL_ATTRIBUTE] });
  return () => {
    media?.removeEventListener?.('change', change);
    observer.disconnect();
  };
}
