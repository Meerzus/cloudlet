import type { NotificationKind } from '@cloudlet/toast';
import { springEasing } from '@/lib/spring';

/** The kinds' glyphs, as the package draws them (16 px, stroked); loading is its spinner. */
export const TOAST_GLYPHS: Record<Exclude<NotificationKind, 'loading'>, string> = {
  success: 'M4.5 8.5 7 11l4.5-5.5',
  info: 'M8 7.5V11M8 5h.01',
  warning: 'M8 4.75V8.5M8 11.25h.01',
  error: 'm5.5 5.5 5 5m0-5-5 5',
};

/** A kind's glyph as SVG markup, for a node built outside React. */
export function glyphMarkup(kind: NotificationKind): string {
  return kind === 'loading'
    ? '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" stroke-dasharray="22 13" /></svg>'
    : `<svg viewBox="0 0 16 16"><path d="${TOAST_GLYPHS[kind]}" /></svg>`;
}

/** The flight from where a notification was sent to where the page's Toaster shows: critically damped, a little slow. */
const FLIGHT = springEasing({ stiffness: 170, damping: 26 });
/** The real notification is sent this far into the flight, so it lands as the ghost arrives. */
const HAND_OFF = 0.72;

/**
 * A pill that flies from `from` (a rectangle on screen, its left edge and middle) to where the page's
 * Toaster shows (top centre on wide screens, bottom on narrow ones, as the package's `auto` places
 * it), then hands over to the real notification: `land` sends it. The caller skips the flight under
 * reduced motion and simply sends.
 */
export function flyToast(from: DOMRect, title: string, kind: NotificationKind, land: () => void) {
  const wide = window.matchMedia('(min-width: 48rem)').matches;
  const ghost = document.createElement('div');
  ghost.className = 'ki-pill';
  ghost.setAttribute('aria-hidden', 'true');
  const icon = document.createElement('span');
  icon.className = 'ki-pill-icon';
  icon.dataset['kind'] = kind;
  icon.innerHTML = glyphMarkup(kind);
  const text = document.createElement('span');
  text.textContent = title;
  ghost.append(icon, text);
  document.body.append(ghost);
  const box = ghost.getBoundingClientRect();
  const startX = from.left;
  const startY = from.top + from.height / 2 - box.height / 2;
  const endX = window.innerWidth / 2 - box.width / 2;
  const endY = wide ? 16 : window.innerHeight - 16 - box.height;
  const flight = ghost.animate(
    [
      { transform: `translate(${startX}px, ${startY}px) scale(0.6)`, opacity: 0 },
      { transform: `translate(${startX}px, ${startY}px) scale(0.85)`, opacity: 1, offset: 0.08 },
      { transform: `translate(${endX}px, ${endY}px) scale(1)`, opacity: 1 },
    ],
    { duration: FLIGHT.duration, easing: FLIGHT.easing, fill: 'forwards' },
  );
  const timer = window.setTimeout(land, FLIGHT.duration * HAND_OFF);
  void flight.finished
    .then(() => ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).finished)
    .catch(() => {})
    .finally(() => {
      window.clearTimeout(timer);
      ghost.remove();
    });
}
