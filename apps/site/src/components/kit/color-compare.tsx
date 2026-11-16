'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { usePickerColor } from '@/components/picker/picker-color';
import { usePageNotifications } from '@/components/site/notifications';
import { ColorPalette } from '@/components/ui/color-palette/color-palette';
import { ColorPicker } from '@/components/ui/color-picker/color-picker';
import { formatColor, parseColor } from '@/components/ui/color-picker/color';
import { createColorReport, type ColorChangeKind } from '@/lib/color-report';
import { harmoniesOf } from '@/lib/harmonies';
import { PALETTE_MAX } from '@/lib/picker-start';
import { COLOR_PALETTE_PATH, COLOR_PICKER_PATH, type RegistryItem } from '@/lib/site';
import { InstallCommand } from './install-command';

/** The colors one press sets on both sides: warm, cool, light and deep, all of them start colors of the color picker's landing. */
export const COLOR_CHIPS = ['#ff6a3d', '#f2b84b', '#7cc6fe', '#e8577e', '#2e8b57', '#3b2a6b'] as const;

/** Captions of the two sides of each comparison: neutral, no names of other libraries. */
export const COLOR_SIDES = {
  pickerPlain: { label: 'The browser’s color input', note: 'As this browser draws it.' },
  picker: { label: 'Color picker', note: 'Opens out of its swatch.' },
  palettePlain: { label: 'Color inputs and a plus', note: 'A row of the same input.' },
  palette: { label: 'Color palette', note: 'Each color its own picker.' },
} as const;

/** Any color the controls emit as `#rrggbb`, alpha dropped; null when it does not parse. */
const hexOf = (value: string) => {
  const rgba = parseColor(value);
  return rgba ? formatColor({ ...rgba, a: 1 }, 'hex') : null;
};

/** The page's Island answers a change of the visitor's once it has settled; loading and scrolling say nothing. */
function useColorReport() {
  const controller = usePageNotifications();
  const { hex, paletteHex } = usePickerColor();
  const latest = useRef({ controller, hex, count: paletteHex.length });
  useEffect(() => {
    latest.current = { controller, hex, count: paletteHex.length };
  });
  const report = useMemo(
    () => createColorReport({ controller: () => latest.current.controller, read: () => latest.current }),
    [],
  );
  useEffect(() => () => report.cancel(), [report]);
  return report.note;
}

/**
 * The color picker's and the palette's comparisons on the kit's landing, over the chapter's paint.
 * Each puts the plain way and the kit's component side by side on two identical sheets, and both
 * sides hold the same state: one input above them sets both at once, and a change on either side
 * shows on the other. Every change of the visitor's repaints the chapter (a press spreads out of the
 * control, a drag repaints at once) and, once it has settled, the page's Island reports it.
 */
export function ColorCompare() {
  const note = useColorReport();
  return (
    <>
      <PickerPair note={note} />
      <PalettePair note={note} />
    </>
  );
}

function Pair({
  id,
  title,
  lede,
  open,
  path,
  item,
  children,
}: {
  id: string;
  title: string;
  lede: string;
  open: string;
  path: string;
  item: RegistryItem;
  children: ReactNode;
}) {
  return (
    <div className="kc-pair" role="group" aria-labelledby={id}>
      <div className="kc-intro">
        <h3 id={id} className="kc-title">
          {title}
        </h3>
        <p className="kc-lede">{lede}</p>
      </div>
      <div className="kc-compare">{children}</div>
      <div className="kc-outro">
        <Link href={path} className="kit-open">
          {open}
          <ArrowRight className="kit-open-arrow" aria-hidden="true" />
        </Link>
        <InstallCommand initial={item} switcher={false} />
      </div>
    </div>
  );
}

function Side({ side, caption, children }: { side: 'plain' | 'cloudlet'; caption: { label: string; note: string }; children: ReactNode }) {
  return (
    <figure className="kc-side" data-side={side}>
      <figcaption className="kc-caption">
        <span className="kc-caption-label">{caption.label}</span>
        <span className="kc-caption-note">{caption.note}</span>
      </figcaption>
      <div className="kc-sheet">{children}</div>
    </figure>
  );
}

function PickerPair({ note }: { note: (kind: ColorChangeKind) => void }) {
  const { value, hex, pick } = usePickerColor();
  const kit = useRef<HTMLDivElement>(null);
  /** A new color repaints the chapter and is reported; the same one again (a format switch) is not. */
  const set = (next: string, from: Element | null, bleed?: boolean) => {
    const changed = hexOf(next) !== hex;
    pick(next, from ?? undefined, bleed);
    if (changed) note('accent');
  };

  return (
    <Pair
      id="kc-picker-title"
      title="Color picker"
      lede="The same accent on both sides. Pick a dot, or change either one: the other follows, and the paint takes it."
      open="Open Color picker"
      path={COLOR_PICKER_PATH}
      item="color-picker"
    >
      <div role="group" aria-label="Set both to a color" className="kc-try">
        <span aria-hidden="true" className="kc-try-label">
          Set both
        </span>
        <span className="kc-chips">
          {COLOR_CHIPS.map((color) => (
            <button
              key={color}
              type="button"
              className="kc-chip"
              style={{ '--kc-chip': color } as CSSProperties}
              aria-label={color}
              aria-pressed={hex === color}
              onClick={(event) => set(color, event.currentTarget, true)}
            />
          ))}
        </span>
      </div>
      <div className="kc-sides">
        <Side side="plain" caption={COLOR_SIDES.pickerPlain}>
          <div className="kc-field">
            <label htmlFor="kc-native-accent" className="kc-field-text">
              <span className="kc-field-label">Accent</span>
              <span className="kc-value">{hex}</span>
            </label>
            {/* As the browser draws it: the site's reset is undone for this input (kit.css). */}
            <input
              id="kc-native-accent"
              type="color"
              className="kc-native"
              value={hex}
              // Fires as the system's own picker moves: the paint follows at once, as under a slider.
              onChange={(event) => set(event.currentTarget.value, event.currentTarget, false)}
            />
          </div>
        </Side>
        <Side side="cloudlet" caption={COLOR_SIDES.picker}>
          <div className="kc-field">
            <div className="kc-field-text">
              <span className="kc-field-label">Accent</span>
              <span className="kc-value">{value}</span>
            </div>
            <div ref={kit} className="kc-kit-picker">
              <ColorPicker color={value} onChange={(next) => set(next, kit.current)} labels={{ open: 'Pick the accent', panel: 'Accent' }} />
            </div>
          </div>
        </Side>
      </div>
    </Pair>
  );
}

function PalettePair({ note }: { note: (kind: ColorChangeKind) => void }) {
  const { hex, palette, paletteHex, setPalette } = usePickerColor();
  const hints = useMemo(() => harmoniesOf(hex), [hex]);
  const plainRow = useRef<HTMLDivElement>(null);
  const kitRow = useRef<HTMLDivElement>(null);
  /** A palette that differs repaints the chapter in its colors (spreading out of the row) and is reported. */
  const set = (colors: readonly string[], from: Element | null, bleed?: boolean) => {
    const changed = colors.map((color) => hexOf(color) ?? '').join() !== paletteHex.join();
    setPalette(colors, from ?? undefined, bleed);
    if (changed) note('palette');
  };

  return (
    <Pair
      id="kc-palette-title"
      title="Color palette"
      lede="One palette on both sides, up to four colors. A harmony fills both, and once it is yours the whole paint is in it."
      open="Open Color palette"
      path={COLOR_PALETTE_PATH}
      item="color-palette"
    >
      <div role="group" aria-label="Fill both with a harmony" className="kc-try">
        <span aria-hidden="true" className="kc-try-label">
          Fill both
        </span>
        <span className="kc-hints">
          {hints.map((hint) => (
            <button
              key={hint.id}
              type="button"
              className="cp-hint"
              aria-pressed={hint.colors.length === paletteHex.length && hint.colors.every((color, index) => color === paletteHex[index])}
              onClick={(event) => set(hint.colors, event.currentTarget, true)}
            >
              <span className="cp-hint-chips" aria-hidden="true">
                {hint.colors.map((color, index) => (
                  <span key={`${color}-${index}`} className="cp-hint-chip" style={{ background: color }} />
                ))}
              </span>
              {hint.name}
            </button>
          ))}
        </span>
      </div>
      <div className="kc-sides kc-sides-stack">
        <Side side="plain" caption={COLOR_SIDES.palettePlain}>
          <div className="kc-field kc-field-column">
            <span id="kc-plain-palette" className="kc-field-label">
              Brand colors
            </span>
            <div ref={plainRow} className="kc-row">
              <PlainPalette colors={paletteHex} onChange={(colors, bleed) => set(colors, plainRow.current, bleed)} />
            </div>
          </div>
        </Side>
        <Side side="cloudlet" caption={COLOR_SIDES.palette}>
          <div className="kc-field kc-field-column">
            <span className="kc-field-label" aria-hidden="true">
              Brand colors
            </span>
            <div ref={kitRow} className="kc-row">
              <ColorPalette colors={palette} onChange={(colors) => set(colors, kitRow.current)} labels={{ group: 'Brand colors' }} />
            </div>
          </div>
        </Side>
      </div>
    </Pair>
  );
}

/**
 * The usual simple palette: one browser color input per color, a remove button on each and a plus
 * that repeats the last color, as far as PALETTE_MAX. Not made worse on purpose: after a removal the
 * focus goes to the neighbour, and the controls follow the theme.
 */
export function PlainPalette({ colors, onChange }: { colors: readonly string[]; onChange: (colors: string[], bleed: boolean) => void }) {
  const list = useRef<HTMLUListElement>(null);
  const focusAt = useRef<number | null>(null);

  useEffect(() => {
    const index = focusAt.current;
    if (index === null) return;
    focusAt.current = null;
    list.current?.querySelectorAll<HTMLInputElement>('input')[index]?.focus();
  });

  return (
    <div className="kc-plain" role="group" aria-labelledby="kc-plain-palette">
      <ul ref={list} className="kc-plain-list">
        {colors.map((color, index) => (
          // By position, as the simple version keys it.
          <li key={index} className="kc-plain-item">
            <input
              type="color"
              className="kc-native"
              value={color}
              aria-label={`Color ${index + 1}`}
              onChange={(event) => onChange(colors.map((entry, at) => (at === index ? event.currentTarget.value : entry)), false)}
            />
            {colors.length > 1 ? (
              <button
                type="button"
                className="kc-native kc-plain-remove"
                aria-label={`Remove color ${index + 1}`}
                onClick={() => {
                  focusAt.current = Math.max(0, index - 1);
                  onChange(colors.filter((_, at) => at !== index), true);
                }}
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {colors.length < PALETTE_MAX ? (
        <button type="button" className="kc-native kc-plain-add" aria-label="Add color" onClick={() => onChange([...colors, colors.at(-1) ?? '#000000'], true)}>
          +
        </button>
      ) : null}
    </div>
  );
}
