'use client';

import { useMemo, useRef } from 'react';
import { ColorPalette } from '@/components/ui/color-palette/color-palette';
import { harmoniesOf } from '@/lib/harmonies';
import { usePickerColor } from './picker-color';

/**
 * Palette (COLOR_PICKER §8.5): the page's palette in a ColorPalette and the harmonies of the page
 * color as hints that fill it. There is no picture of its own: once the palette is the visitor's, the
 * page's paint takes it (components/picker/paint-page.tsx), the colors laid out by lightness. A hint,
 * typing or a new color spreads out of the palette's row; dragging a handle repaints at once.
 */
export function Palette() {
  const { hex, palette, paletteHex, setPalette } = usePickerColor();
  const hints = useMemo(() => harmoniesOf(hex), [hex]);
  const row = useRef<HTMLDivElement>(null);

  return (
    <section id="palette" aria-labelledby="palette-title" className="cp-section">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
        <h2 id="palette-title" className="cp-section-title">palette</h2>
        <p className="cp-section-lede">
          Up to four colors in one row, each its own picker. The first one paints this page; make the others yours and the whole page takes
          them, the darkest in the shadows.
        </p>
        <div className="cp-palette">
          <div ref={row} className="cp-palette-row">
            <ColorPalette colors={palette} onChange={(colors) => setPalette(colors, row.current ?? undefined)} labels={{ group: 'Page palette' }} />
          </div>
          <div className="cp-hints" role="group" aria-labelledby="palette-hints-title">
            <h3 id="palette-hints-title" className="cp-hints-title">
              Start from a harmony
            </h3>
            <ul className="cp-hints-list">
              {hints.map((hint) => (
                <li key={hint.id}>
                  <button
                    type="button"
                    className="cp-hint"
                    aria-pressed={hint.colors.length === paletteHex.length && hint.colors.every((color, index) => color === paletteHex[index])}
                    onClick={() => setPalette(hint.colors, row.current ?? undefined)}
                  >
                    <span className="cp-hint-chips" aria-hidden="true">
                      {hint.colors.map((color, index) => (
                        <span key={`${color}-${index}`} className="cp-hint-chip" style={{ background: color }} />
                      ))}
                    </span>
                    {hint.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
