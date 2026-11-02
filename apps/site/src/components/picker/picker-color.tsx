'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { landscapeFor, START_COLORS, START_GLOBAL, startColor, type Landscape } from '@/lib/landscape';

const URL_DELAY = 250;

interface PickerColor {
  /** The value as the pickers last emitted it (any format): fed back to them unchanged. */
  readonly value: string;
  readonly landscape: Landscape;
  /** The start color is known: before that the server's first curated color stands in. */
  readonly started: boolean;
  /** Whether the latest change should bleed (a jump) or repaint at once (a slider moved). */
  readonly bleed: MutableRefObject<boolean>;
  readonly pick: (value: string) => void;
}

const PickerColorContext = createContext<PickerColor | null>(null);

export function usePickerColor(): PickerColor {
  const context = useContext(PickerColorContext);
  if (!context) throw new Error('usePickerColor needs a PickerColorProvider');
  return context;
}

/** `?c=` follows the color, without a history entry per change (like the style editor's URL). */
function writeUrl(hex: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('c', hex.slice(1));
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/**
 * The landing's one color (COLOR_PICKER §8): the hero's disc, the inline panel in Built for
 * keyboards and the Combinations read and set it. It lives on <html> too — `--cp-color` and
 * `data-cp-hour` — for the flat sky, the ink and the tint of the neutral sections.
 */
export function PickerColorProvider({ children }: { children: ReactNode }) {
  // The server renders the first curated color; the start script has already painted the real one on <html>.
  const [value, setValue] = useState<string>(START_COLORS[0]);
  const [started, setStarted] = useState(false);
  const bleed = useRef(true);
  const changed = useRef(false);
  // Keyed by hex: a format switch re-emits the same color in other words, and the landscape stays.
  const hex = useMemo(() => landscapeFor(value)?.hex ?? START_COLORS[0], [value]);
  const landscape = useMemo(() => landscapeFor(hex)!, [hex]);

  useLayoutEffect(() => {
    // After a client navigation the start script did not run: pick the same way here.
    const globals = window as unknown as Record<string, unknown>;
    const fromScript = globals[START_GLOBAL];
    setValue(typeof fromScript === 'string' ? fromScript : startColor(window.location.search, Math.random()));
    setStarted(true);
    // Used once: a later client navigation back here picks afresh. Cleared after a task, so StrictMode's
    // immediate second run of this effect still reads the same color.
    const consume = window.setTimeout(() => delete globals[START_GLOBAL]);
    return () => window.clearTimeout(consume);
  }, []);

  useLayoutEffect(() => {
    if (!started) return;
    const root = document.documentElement;
    root.style.setProperty('--cp-color', landscape.hex);
    root.setAttribute('data-cp-hour', landscape.hour);
  }, [landscape, started]);

  useEffect(() => {
    if (!changed.current) return;
    const timer = window.setTimeout(() => writeUrl(landscape.hex), URL_DELAY);
    return () => window.clearTimeout(timer);
  }, [landscape.hex]);

  const state = useMemo<PickerColor>(
    () => ({
      value,
      landscape,
      started,
      bleed,
      pick(next) {
        // Dragging or arrowing a slider repaints at once; typing, the eyedropper and the like bleed.
        bleed.current = document.activeElement?.getAttribute('role') !== 'slider';
        changed.current = true;
        setValue(next);
      },
    }),
    [value, landscape, started],
  );
  return <PickerColorContext.Provider value={state}>{children}</PickerColorContext.Provider>;
}
