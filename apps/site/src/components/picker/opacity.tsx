'use client';

import { useMemo, useState } from 'react';
import { formatColor, parseColor, type ColorFormat } from '@/components/ui/color-picker/color';
import { ColorPickerPanel } from '@/components/ui/color-picker/color-picker';
import { CopyValue } from './copy-value';
import type { GlassLook } from './fluted-glass';
import { GlassCard } from './glass-card';
import { usePickerColor } from './picker-color';

/** The film starts half dense: `#rrggbb80`, the scene and the color both in view. */
export const START_ALPHA = 0.5;

/** The glass over the Opacity scene (COLOR_PICKER §8.8). */
export const OPACITY_GLASS: GlassLook = {
  size: 0.75,
  shape: 'lines',
  distortionShape: 'prism',
  distortion: 0.5,
  angle: 0,
  shift: 0,
  blur: 0,
  edges: 0.25,
  stretch: 0,
  highlights: 0.1,
  shadows: 0.25,
  grainMixer: 0,
  grainOverlay: 0.04,
};

/**
 * Opacity (COLOR_PICKER §8.6): a scene in its own colors behind fluted glass, and over it a film of
 * the page color whose density is the alpha of the panel beside it — at 0 % the scene, at 100 % the
 * color. The alpha lives in this section and never changes the page color; moving the panel's color
 * itself does paint the page, as every other panel on it does.
 */
export function Opacity() {
  const { hex, pick } = usePickerColor();
  const [alpha, setAlpha] = useState(START_ALPHA);
  const [format, setFormat] = useState<ColorFormat>('hex');
  const rgb = useMemo(() => parseColor(hex)!, [hex]);
  const value = formatColor({ ...rgb, a: alpha }, format);

  const change = (next: string) => {
    const rgba = parseColor(next);
    if (!rgba) return;
    setAlpha(rgba.a);
    // hsl() and oklch() round: the same color read back can move a channel by a digit, and only
    // the alpha moved then. A real move of the color paints the page.
    const moved = Math.abs(rgba.r - rgb.r) + Math.abs(rgba.g - rgb.g) + Math.abs(rgba.b - rgb.b) >= 4 / 255;
    if (moved) pick(formatColor({ ...rgba, a: 1 }, format));
  };

  return (
    <section id="opacity" aria-labelledby="opacity-title" className="cp-section">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
        <h2 id="opacity-title" className="cp-section-title">opacity</h2>
        <p className="cp-section-lede">
          Turn on <code className="cp-code">alpha</code> and the picker gets an opacity slider, with the alpha in every format. Here it sets how thick the page
          color lies over the glass.
        </p>
        <div className="cp-glass-layout">
          <div className="cp-glass-controls">
            <div role="group" aria-label="Film color">
              <ColorPickerPanel
                alpha
                color={value}
                onChange={change}
                format={format}
                onFormatChange={setFormat}
                labels={{ alpha: 'Film opacity' }}
              />
            </div>
            <CopyValue value={value} />
          </div>
          <GlassCard frame="opacity" look={OPACITY_GLASS}>
            <div className="cp-film" data-testid="opacity-film" style={{ opacity: alpha }} aria-hidden="true" />
          </GlassCard>
        </div>
      </div>
    </section>
  );
}
