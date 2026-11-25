'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { detectFormat, formatColor, parseColor } from '@/components/ui/color-picker/color';
import { harmoniesOf, type HarmonyId } from '@/lib/harmonies';
import { heroRamp, paletteRamp, type Ramp } from '@/lib/picker-ramp';
import { PALETTE_MAX, paletteFromSearch, paletteParam, START_COLORS, START_GLOBAL, startColor } from '@/lib/picker-start';

const URL_DELAY = 250;

/** The harmony an untouched palette follows the page color with: three colors, all of them hues of their own. */
export const FOLLOW_HARMONY: HarmonyId = 'split-complement';

interface PickerColor {
  /** The value as the pickers last emitted it (any format): fed back to them unchanged. */
  readonly value: string;
  /** The picked color as `#rrggbb`, alpha dropped. */
  readonly hex: string;
  /** The hero's ramp for it, with its scene. */
  readonly ramp: Ramp;
  /** The palette (1–PALETTE_MAX values as emitted, any format); the first is `value`. */
  readonly palette: readonly string[];
  /** The palette as `#rrggbb`, in the visitor's order. */
  readonly paletteHex: readonly string[];
  /** The Palette card's ramp: the colors laid out by lightness. */
  readonly paletteRamp: Ramp;
  /** The visitor has edited the palette: until then its other colors follow the page color. */
  readonly own: boolean;
  /** The start color is known: before that the server's first curated color stands in. */
  readonly started: boolean;
  /** How the latest change shows: a jump bleeds out of where it was made, a slider moved repaints at once. */
  readonly change: MutableRefObject<PickerChange>;
  /**
   * Sets the page color (the palette's first); `from` is the control or the point it was picked at.
   * `bleed` overrides how it shows: by default a slider in focus repaints at once and anything else spreads.
   */
  readonly pick: (value: string, from?: ChangeSource, bleed?: boolean) => void;
  /** Sets the whole palette; its first color becomes the page color. `bleed` as for `pick`. */
  readonly setPalette: (colors: readonly string[], from?: ChangeSource, bleed?: boolean) => void;
  /** The page's paint, once it draws: the color it shows under a point (Tools takes it). */
  readonly paint: MutableRefObject<PaintProbe | null>;
}

/** What the page's paint tells the sections about itself. */
export interface PaintProbe {
  /** The color the paint shows under a point of the page (CSS px from its top-left), `#rrggbb`. */
  readonly colorAt: (x: number, pageY: number) => string;
}

/** Where a color was chosen: a control on the page, or a point in page coordinates (CSS px from its top-left). */
export type ChangeSource = Element | { readonly x: number; readonly y: number };

export interface PickerChange {
  /** A jump (typing, the eyedropper, a hint, a click on the paint): the new paint spreads; false for a slider. */
  readonly bleed: boolean;
  /** Where it spreads from; null leaves it to the reader (the hero's panel). */
  readonly from: ChangeSource | null;
}

const PickerColorContext = createContext<PickerColor | null>(null);

export function usePickerColor(): PickerColor {
  const context = useContext(PickerColorContext);
  if (!context) throw new Error('usePickerColor needs a PickerColorProvider');
  return context;
}

/**
 * `?c=` follows the page color — or the whole palette once the visitor made it theirs — without a
 * history entry per change (like the style editor's URL). Commas stay commas: the link is read by eye.
 */
function writeUrl(colors: readonly string[]) {
  const url = new URL(window.location.href);
  url.searchParams.set('c', paletteParam(colors));
  const search = url.search.replace(/%2C/giu, ',');
  if (`${url.pathname}${search}${url.hash}` !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, '', `${url.pathname}${search}${url.hash}`);
  }
}

/** Any color the pickers emit as `#rrggbb`, alpha dropped; null when it does not parse. */
const toHex = (value: string) => {
  const rgba = parseColor(value);
  return rgba ? formatColor({ ...rgba, a: 1 }, 'hex') : null;
};

/** The colors an untouched palette shows after the page color. */
export const followersOf = (hex: string): readonly string[] => harmoniesOf(hex).find((harmony) => harmony.id === FOLLOW_HARMONY)!.colors.slice(1);

/**
 * The followers as the palette shows them: each emitted color is one of them written in its own
 * format, exactly as the palette writes a color it re-emits. A nudge of one percent moves a channel
 * by a unit or two, as little as a trip through hsl() rounds, so only the string tells them apart.
 */
const same = (emitted: readonly string[], followers: readonly string[]) =>
  emitted.length === followers.length &&
  emitted.every((entry, index) => {
    const rgba = parseColor(followers[index]!);
    const format = detectFormat(entry);
    return rgba !== null && format !== null && entry === formatColor({ ...rgba, a: 1 }, format);
  });

/** Dragging or arrowing a slider repaints at once; typing, the eyedropper, a hint and the like bleed. */
const isJump = () => document.activeElement?.getAttribute('role') !== 'slider';

/**
 * The landing's state (COLOR_PICKER §8.5): a palette of one to four colors whose first is the page
 * color — the hero's panel, the inline panel in Built for keyboards and the Palette section read and
 * set it. Until the visitor edits the palette its other colors follow the page color by a harmony.
 * The page color lives on <html> too, as `--cp-color`, for the flat background of the page.
 *
 * `page={false}` keeps the state to a part of another page (the kit's landing): nothing is put on
 * <html> and the address is never written; the start color is still `?c=` when the link has one (how
 * an audit sets it), otherwise the start script's color when the page renders one, else a random
 * curated one.
 */
export function PickerColorProvider({ children, page = true }: { children: ReactNode; page?: boolean }) {
  // The server renders the first curated color; the start script has already painted the real one on <html>.
  const [value, setValue] = useState<string>(START_COLORS[0]);
  /** The palette after the first color, once the visitor owns it; null while it follows the page color. */
  const [rest, setRest] = useState<readonly string[] | null>(null);
  const [started, setStarted] = useState(false);
  const change = useRef<PickerChange>({ bleed: true, from: null });
  const paint = useRef<PaintProbe | null>(null);
  const changed = useRef(false);
  // Keyed by hex: a format switch re-emits the same color in other words, and the ramps stay.
  const hex = useMemo(() => (heroRamp(value) ? toHex(value)! : START_COLORS[0]), [value]);
  const ramp = useMemo(() => heroRamp(hex)!, [hex]);
  const followers = useMemo(() => followersOf(hex), [hex]);
  const palette = useMemo(() => [value, ...(rest ?? followers)], [value, rest, followers]);
  const paletteKey = palette.map((entry) => toHex(entry) ?? '').join();
  const paletteHex = useMemo(() => paletteKey.split(',').filter(Boolean), [paletteKey]);
  const ownRamp = useMemo(() => paletteRamp(paletteHex) ?? ramp, [paletteHex, ramp]);
  const own = rest !== null;

  useLayoutEffect(() => {
    // After a client navigation the start script did not run: pick the same way here.
    const globals = window as unknown as Record<string, unknown>;
    const fromScript = globals[START_GLOBAL];
    const linked = paletteFromSearch(window.location.search);
    setValue(typeof fromScript === 'string' ? fromScript : startColor(window.location.search, Math.random()));
    // A link with more than one color is a palette someone made: it is theirs, not a harmony.
    if (linked && linked.length > 1) setRest(linked.slice(1));
    setStarted(true);
    if (fromScript === undefined) return;
    // Used once: a later client navigation back here picks afresh. Cleared after a task, so StrictMode's
    // immediate second run of this effect still reads the same color.
    const consume = window.setTimeout(() => delete globals[START_GLOBAL]);
    return () => window.clearTimeout(consume);
    // Once, at mount: `page` is fixed for a provider's life.
  }, []);

  useLayoutEffect(() => {
    if (started && page) document.documentElement.style.setProperty('--cp-color', hex);
  }, [hex, started, page]);

  const linkKey = own ? paletteKey : hex;
  useEffect(() => {
    if (!changed.current || !page) return;
    const timer = window.setTimeout(() => writeUrl(linkKey.split(',')), URL_DELAY);
    return () => window.clearTimeout(timer);
  }, [linkKey, page]);

  const state = useMemo<PickerColor>(
    () => ({
      value,
      hex,
      ramp,
      palette,
      paletteHex,
      paletteRamp: ownRamp,
      own,
      started,
      change,
      paint,
      pick(next, from, bleed) {
        change.current = { bleed: bleed ?? isJump(), from: from ?? null };
        changed.current = true;
        setValue(next);
      },
      setPalette(colors, from, bleed) {
        const [first, ...others] = colors.slice(0, PALETTE_MAX);
        if (first === undefined) return;
        change.current = { bleed: bleed ?? isJump(), from: from ?? null };
        changed.current = true;
        setValue(first);
        // An untouched palette stays a harmony while only its first color (or the format) changes:
        // the others come back as they were shown.
        if (rest === null && same(others, followers)) return;
        setRest(others);
      },
    }),
    [value, hex, ramp, palette, paletteHex, ownRamp, own, started, rest, followers],
  );
  return <PickerColorContext.Provider value={state}>{children}</PickerColorContext.Provider>;
}
