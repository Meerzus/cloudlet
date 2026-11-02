'use client';

import { useMemo, useState, type ComponentType, type SVGProps } from 'react';
import { useCopy } from '@/components/site/notifications';
import { Segmented } from '@/components/site/segmented';
import { COLOR_FORMATS, formatColor, parseColor, type ColorFormat } from '@/components/ui/color-picker/color';
import { harmoniesOf, inkOn, type Harmony } from '@/lib/harmonies';
import { Cloud, Drop, Moon, Reflection, Star } from './glyphs';
import { usePickerColor } from './picker-color';

const as = (hex: string, format: ColorFormat) => formatColor(parseColor(hex)!, format);

interface Poster {
  readonly title: string;
  readonly harmony: Harmony['id'];
  /** Indexes into the harmony's colors: the paper, then each glyph's ink. */
  readonly paper: number;
  readonly glyphs: readonly (readonly [ComponentType<SVGProps<SVGSVGElement>>, number, string])[];
}

/** Three small riso posters, each printed in one harmony (glyph, color index, placement class). */
const POSTERS: readonly Poster[] = [
  { title: 'night swim', harmony: 'complement', paper: 0, glyphs: [[Moon, 1, 'cp-glyph-moon'], [Reflection, 1, 'cp-glyph-reflection']] },
  { title: 'after the rain', harmony: 'split-complement', paper: 1, glyphs: [[Drop, 0, 'cp-glyph-drop'], [Star, 2, 'cp-glyph-star']] },
  { title: 'slow cloud', harmony: 'analogous', paper: 0, glyphs: [[Cloud, 2, 'cp-glyph-cloud'], [Star, 1, 'cp-glyph-star-small']] },
];

/**
 * Combinations (COLOR_PICKER §8.5): the picked color's harmonies as swatches that copy their value
 * in the format chosen here, and three posters printed in them with the landing's glyphs and grain.
 */
export function Combinations() {
  const { landscape } = usePickerColor();
  const [format, setFormat] = useState<ColorFormat>('hex');
  const harmonies = useMemo(() => harmoniesOf(landscape.hex), [landscape.hex]);
  const copy = useCopy();

  return (
    <section id="combinations" aria-labelledby="combinations-title" className="cp-section">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
        <h2 id="combinations-title" className="cp-section-title">combinations</h2>
        <p className="cp-section-lede">
          Every color brings company. Here is yours, turned in OKLCH so each hue keeps its lightness — click a swatch to copy it.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Segmented legend="Values in" options={COLOR_FORMATS.map((value) => ({ value, label: value }))} value={format} onChange={setFormat} />
          <p className="text-sm text-muted-foreground">
            In your app the format is yours to pick with <code className="cp-code">format</code>, and your users&apos; with the switch.
          </p>
        </div>
        <div className="cp-harmonies">
          {harmonies.map((harmony) => (
            <div key={harmony.id} className="cp-harmony">
              <h3 className="cp-harmony-name">{harmony.name}</h3>
              <ul className="cp-harmony-swatches">
                {harmony.colors.map((hex, index) => {
                  const value = as(hex, format);
                  return (
                    <li key={`${hex}-${index}`}>
                      <button type="button" className="cp-swatch" onClick={() => void copy(value)} aria-label={`Copy ${value}`}>
                        <span className="cp-swatch-chip" style={{ background: hex }} aria-hidden="true" />
                        <span className="cp-swatch-value">{value}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <div className="cp-posters">
          {POSTERS.map((poster) => {
            const colors = harmonies.find((harmony) => harmony.id === poster.harmony)!.colors;
            const paper = colors[poster.paper]!;
            return (
              <figure key={poster.title} className="cp-poster" style={{ background: paper, color: inkOn(paper) }}>
                {poster.glyphs.map(([Glyph, index, place]) => (
                  <Glyph key={place} className={`cp-glyph ${place}`} style={{ color: colors[index] }} />
                ))}
                <span className="cp-poster-grain" aria-hidden="true" />
                <figcaption className="cp-poster-caption">
                  <span className="cp-poster-title">{poster.title}</span>
                  <span className="cp-poster-meta">{poster.harmony.replace('-', ' ')}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </div>
    </section>
  );
}
