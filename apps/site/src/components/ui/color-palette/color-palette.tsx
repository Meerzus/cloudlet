'use client';

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { springEasing } from '@/lib/spring';
import { ColorPicker, type ColorFormat, type ColorPickerLabels } from '@/components/ui/color-picker/color-picker';
import { COLOR_FORMATS, detectFormat, formatColor, oklchToRgb, parseColor, rgbToOklch } from '@/components/ui/color-picker/color';
import { morphClock } from '@/components/ui/color-picker/morph';
import './color-palette.css';

export interface ColorPaletteLabels {
  /** Name of the whole palette, e.g. "Brand palette". */
  readonly group: string;
  /** Name of a swatch before its value; `{n}` is its place and `{total}` the count: "Color 2 of 3". */
  readonly color: string;
  /** Name of the button that adds a color. */
  readonly add: string;
  /** Name of the pointer's remove button on a swatch. */
  readonly remove: string;
  /** Spoken once a color has been removed. */
  readonly removed: string;
  /** Labels of every swatch's picker; `open` is the swatch's name above and is ignored here. */
  readonly picker: Partial<ColorPickerLabels>;
}

export const DEFAULT_PALETTE_LABELS: ColorPaletteLabels = {
  group: 'Palette',
  color: 'Color {n} of {total}',
  add: 'Add color',
  remove: 'Remove color',
  removed: 'Color removed',
  picker: {},
};

export interface ColorPaletteProps {
  /** The colors (controlled): one to `max` strings in hex, rgb(), hsl() or oklch(). An empty array is one default color. */
  readonly colors?: readonly string[];
  /** The initial colors when the palette owns them (uncontrolled). */
  readonly defaultColors?: readonly string[];
  /** Called with every color in `format`, in the user's order, on any change, addition or removal. */
  readonly onChange?: (colors: string[]) => void;
  /** Most colors the palette holds; the add button is gone at this count. Defaults to 4. */
  readonly max?: number;
  /** The output format of every color (controlled); one for the whole palette. */
  readonly format?: ColorFormat;
  /** The initial format when the palette owns it; defaults to the first of `formats`. */
  readonly defaultFormat?: ColorFormat;
  readonly onFormatChange?: (format: ColorFormat) => void;
  /** The formats every picker's switch offers; a single entry hides the switch. */
  readonly formats?: readonly ColorFormat[];
  /** Shows the opacity slider in every picker; without it alpha is dropped. */
  readonly alpha?: boolean;
  /** Renders one hidden input per color under this name: `FormData.getAll(name)` gives the array. */
  readonly name?: string;
  readonly labels?: Partial<ColorPaletteLabels>;
  readonly className?: string;
}

const DEFAULT_COLOR = '#ffffff';
/** A new swatch grows in with a hint of overshoot; a removed one folds away without it. */
const GROW = springEasing({ stiffness: 380, damping: 26 });
const FOLD = springEasing({ stiffness: 420, damping: 42 });

/**
 * The color in `format`, alpha dropped unless the palette shows it. A string already in `format` is
 * kept as written, so a picker gets back exactly what it emitted (a round trip could move the last
 * digit and make it re-read the color); one that does not parse stays as it is.
 */
function reformat(color: string, format: ColorFormat, alpha: boolean): string {
  const rgba = parseColor(color);
  if (!rgba || (detectFormat(color) === format && (alpha || rgba.a >= 1))) return color;
  return formatColor(alpha ? rgba : { ...rgba, a: 1 }, format);
}

/** The next color: the last one turned by `turn` degrees of OKLCH hue; a grey has no hue to turn, so it steps in lightness. */
function nextColor(last: string, turn: number, format: ColorFormat, alpha: boolean): string {
  const oklch = rgbToOklch(parseColor(last) ?? { r: 1, g: 1, b: 1, a: 1 });
  const next = oklch.c < 0.02 ? { ...oklch, l: oklch.l > 0.6 ? oklch.l - 0.3 : oklch.l + 0.3 } : { ...oklch, h: (oklch.h + turn) % 360 };
  const rgba = oklchToRgb(next);
  return formatColor(alpha ? rgba : { ...rgba, a: 1 }, format);
}

/** Without the Web Animations API, under reduced motion or inside a `data-reduced-motion` ancestor nothing moves. */
const still = (element: Element) =>
  typeof (element as HTMLElement).animate !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true || element.closest('[data-reduced-motion]') !== null;

/** The picker's own swatch inside a palette item: the roving stop of that color. */
const swatchOf = (item: Element | null | undefined) => item?.querySelector<HTMLButtonElement>(':scope > .color-picker > .color-picker-swatch') ?? null;

/** How far a swatch reaches into the row: its width and the gap after it. */
function reach(item: HTMLElement) {
  const row = item.parentElement;
  const gap = row ? parseFloat(getComputedStyle(row).columnGap) || 0 : 0;
  return item.offsetWidth + gap;
}

function play(element: Element, keyframes: PropertyIndexedKeyframes, timing: { duration: number; easing: string }) {
  const animation = element.animate(keyframes, { ...timing, fill: 'both' });
  animation.playbackRate = morphClock.rate;
  return animation;
}

interface Ghost {
  readonly key: number;
  readonly color: string;
  /** The place in the row it folds away from. */
  readonly index: number;
  /** Its trailing margin when it was removed, in px: a swatch removed while growing in folds from there. */
  readonly from: number;
}

/**
 * One to `max` swatches, each a `ColorPicker`, with an add button. One Tab stop for the whole row
 * (roving tabindex): ← and → move between the swatches and the add button, Home and End jump to the
 * ends, Enter or Space opens the picker, Delete or Backspace removes the color. The add button opens
 * the new color's picker at once; a removed color hands the focus to its neighbour and is announced.
 * Swatches grow in and fold away on springs, interruptibly; under reduced motion or inside a
 * `data-reduced-motion` ancestor they appear and go instantly. The pickers keep their own behaviour
 * and API; only one is open at a time because each closes when the press or focus leaves it.
 * Styles: color-palette.css, imported here (shadcn tokens: background, foreground, border, ring).
 */
export function ColorPalette({ colors, defaultColors, onChange, max = 4, format, defaultFormat, onFormatChange, formats = COLOR_FORMATS, alpha = false, name, labels: partial, className }: ColorPaletteProps) {
  const labels = { ...DEFAULT_PALETTE_LABELS, ...partial };
  const [ownFormat, setOwnFormat] = useState<ColorFormat>(() => defaultFormat ?? formats[0] ?? 'hex');
  const currentFormat = format ?? ownFormat;
  const [ownColors, setOwnColors] = useState<readonly string[]>(() => defaultColors ?? []);
  const given = colors ?? ownColors;
  const list = given.length > 0 ? given : [DEFAULT_COLOR];
  const shown = list.map((color) => reformat(color, currentFormat, alpha));
  const canAdd = list.length < max;

  // The latest list, so a second event in the same tick (the picker reports its format, then its value) builds on the first.
  const latest = useRef(list);
  latest.current = list;
  const latestFormat = useRef(currentFormat);
  latestFormat.current = currentFormat;
  // Stable keys by place: the palette moves them on add and remove, a change of length from outside appends or drops.
  const keys = useRef<number[]>([]);
  const counter = useRef(0);
  while (keys.current.length < list.length) keys.current.push(counter.current++);
  if (keys.current.length > list.length) keys.current = keys.current.slice(0, list.length);
  // Keys rendered before: only a swatch that arrives later grows in.
  const known = useRef<Set<number> | null>(null);
  const [active, setActive] = useState(0);
  const stops = list.length + (canAdd ? 1 : 0);
  const current = Math.min(active, stops - 1);
  const [ghosts, setGhosts] = useState<readonly Ghost[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const row = useRef<HTMLDivElement>(null);
  const openKey = useRef<number | null>(null);
  const focusIndex = useRef<number | null>(null);

  const commit = (next: string[]) => {
    latest.current = next;
    if (colors === undefined) setOwnColors(next);
    onChange?.(next);
  };

  const change = (index: number, value: string) => {
    const base = latest.current.map((color) => reformat(color, latestFormat.current, alpha));
    if (base[index] === value) return;
    base[index] = value;
    commit(base);
  };

  const changeFormat = (next: ColorFormat) => {
    latestFormat.current = next;
    if (format === undefined) setOwnFormat(next);
    onFormatChange?.(next);
    commit(latest.current.map((color) => reformat(color, next, alpha)));
  };

  const add = () => {
    const base = latest.current;
    if (base.length >= max) return;
    const key = counter.current++;
    keys.current = [...keys.current, key];
    openKey.current = key;
    setActive(base.length);
    commit([...base.map((color) => reformat(color, latestFormat.current, alpha)), nextColor(base[base.length - 1] ?? DEFAULT_COLOR, 360 / Math.max(max, 2), latestFormat.current, alpha)]);
  };

  const remove = (index: number) => {
    const base = latest.current;
    if (base.length <= 1) return;
    const key = keys.current[index];
    const item = row.current?.querySelector<HTMLElement>(`[data-key="${key}"]`);
    if (key !== undefined && item && !still(item)) {
      setGhosts((previous) => [...previous, { key, color: shown[index] ?? DEFAULT_COLOR, index, from: parseFloat(getComputedStyle(item).marginInlineEnd) || 0 }]);
    }
    keys.current = keys.current.filter((_, place) => place !== index);
    const neighbour = Math.min(index, base.length - 2);
    focusIndex.current = neighbour;
    setActive(neighbour);
    setAnnouncement((previous) => (previous === labels.removed ? `${labels.removed} ` : labels.removed));
    commit(base.filter((_, place) => place !== index).map((color) => reformat(color, latestFormat.current, alpha)));
  };

  useLayoutEffect(() => {
    const root = row.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(':scope > [data-key]:not([data-leaving])'));
    items.forEach((item, index) => swatchOf(item)?.setAttribute('tabindex', index === current ? '0' : '-1'));
    // Swatches that arrived after the first render grow in: the row makes room for them on a spring.
    const seen = known.current;
    known.current = new Set(keys.current);
    if (seen) {
      for (const item of items) {
        if (seen.has(Number(item.dataset.key)) || still(item)) continue;
        play(item, { marginInlineEnd: [`${-reach(item)}px`, '0px'] }, GROW);
        // A swatch whose picker opens at once grows under the panel; any other fades in.
        const swatch = swatchOf(item);
        if (swatch && Number(item.dataset.key) !== openKey.current) play(swatch, { opacity: [0, 1], scale: [0.6, 1] }, GROW);
      }
    }
    if (focusIndex.current !== null) {
      swatchOf(items[focusIndex.current])?.focus();
      focusIndex.current = null;
    }
    if (openKey.current !== null) {
      swatchOf(root.querySelector(`[data-key="${openKey.current}"]`))?.click();
      openKey.current = null;
    }
  });

  const fold = (ghost: Ghost) => (element: HTMLElement | null) => {
    if (!element || element.dataset.folding !== undefined) return;
    element.dataset.folding = '';
    const done = () => setGhosts((previous) => previous.filter((entry) => entry.key !== ghost.key));
    play(element, { marginInlineEnd: [`${ghost.from}px`, `${-reach(element)}px`] }, FOLD);
    const dot = element.firstElementChild;
    const fading = dot ? play(dot, { opacity: [1, 0], scale: [1, 0.6] }, FOLD) : null;
    if (fading) fading.finished.then(done, done);
    else done();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const items = Array.from(row.current?.querySelectorAll<HTMLElement>(':scope > [data-key]:not([data-leaving])') ?? []);
    const isAdd = target.classList.contains('color-palette-add');
    const index = isAdd ? list.length : items.findIndex((item) => swatchOf(item) === target);
    if (index < 0) return;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft': next = Math.max(0, index - 1); break;
      case 'ArrowRight': next = Math.min(stops - 1, index + 1); break;
      case 'Home': next = 0; break;
      case 'End': next = stops - 1; break;
      case 'Delete':
      case 'Backspace':
        if (isAdd) return;
        event.preventDefault();
        remove(index);
        return;
      default: return;
    }
    event.preventDefault();
    setActive(next);
    (next === list.length ? row.current?.querySelector<HTMLElement>(':scope > .color-palette-add') : swatchOf(items[next]))?.focus();
  };

  const pickerLabels = labels.picker;
  const total = list.length;
  const cells = list.map((_, index) => {
    const key = keys.current[index] ?? index;
    const value = shown[index] ?? DEFAULT_COLOR;
    const label = `${labels.color.replace('{n}', String(index + 1)).replace('{total}', String(total))}, ${value}`;
    return (
      <div key={key} data-key={key} className="color-palette-item" onFocus={(event) => { if ((event.target as Element) === swatchOf(event.currentTarget)) setActive(index); }}>
        <ColorPicker color={value} onChange={(next) => change(index, next)} format={currentFormat} onFormatChange={changeFormat} formats={formats} alpha={alpha} labels={{ ...pickerLabels, open: label }} />
        {total > 1 ? (
          <button type="button" className="color-palette-remove" aria-label={labels.remove} tabIndex={-1} onClick={() => remove(index)}>
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l6 6M9 3 3 9" /></svg>
          </button>
        ) : null}
      </div>
    );
  });
  // Removed swatches fold away where they stood, outside the roving order and the accessibility tree.
  for (const ghost of [...ghosts].sort((a, b) => b.index - a.index)) {
    cells.splice(Math.min(ghost.index, cells.length), 0, (
      <div key={`ghost-${ghost.key}`} ref={fold(ghost)} className="color-palette-item" data-leaving="" aria-hidden="true" inert>
        <span className="color-palette-ghost" style={{ background: ghost.color }} />
      </div>
    ));
  }

  return (
    <div ref={row} role="group" aria-label={labels.group} className={`color-palette${className ? ` ${className}` : ''}`} onKeyDown={onKeyDown}>
      {cells}
      {canAdd ? (
        <button type="button" className="color-palette-add" aria-label={labels.add} tabIndex={current === list.length ? 0 : -1} onFocus={() => setActive(list.length)} onClick={add}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
        </button>
      ) : null}
      <span className="color-palette-sr-only" aria-live="polite">{announcement}</span>
      {name ? shown.map((value, index) => <input key={keys.current[index] ?? index} type="hidden" name={name} value={value} />) : null}
    </div>
  );
}
