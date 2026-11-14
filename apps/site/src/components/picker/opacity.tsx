'use client';

import { useMemo, useRef, useState } from 'react';
import { formatColor, parseColor, type ColorFormat } from '@/components/ui/color-picker/color';
import { ColorPickerPanel } from '@/components/ui/color-picker/color-picker';
import { CopyValue } from './copy-value';
import { usePickerColor } from './picker-color';

/** The paint starts half there: `#rrggbb80`, the paint and the page under it both in view. */
export const START_ALPHA = 0.5;

/**
 * Opacity (COLOR_PICKER §8.6): within this section the page's own paint is as opaque as the alpha of
 * the panel — at 100 % all of it, at 0 % the bare page. A veil of the theme's background lies over the
 * paint, under the section's copy and panel, at 1 − alpha, fading in and out at the section's edges.
 * The alpha lives in this section and never changes the page color; moving the panel's color itself
 * does paint the page, as every other panel on it does.
 */
export function Opacity() {
  const { hex, pick } = usePickerColor();
  const [alpha, setAlpha] = useState(START_ALPHA);
  const [format, setFormat] = useState<ColorFormat>('hex');
  const rgb = useMemo(() => parseColor(hex)!, [hex]);
  const value = formatColor({ ...rgb, a: alpha }, format);
  const panel = useRef<HTMLDivElement>(null);

  const change = (next: string) => {
    const rgba = parseColor(next);
    if (!rgba) return;
    setAlpha(rgba.a);
    // hsl() and oklch() round: the same color read back can move a channel by a digit, and only
    // the alpha moved then. A real move of the color paints the page.
    const moved = Math.abs(rgba.r - rgb.r) + Math.abs(rgba.g - rgb.g) + Math.abs(rgba.b - rgb.b) >= 4 / 255;
    if (moved) pick(formatColor({ ...rgba, a: 1 }, format), panel.current ?? undefined);
  };

  return (
    <section id="opacity" aria-labelledby="opacity-title" className="cp-section cp-veil-section">
      <div className="cp-veil" data-testid="opacity-veil" style={{ opacity: 1 - alpha }} aria-hidden="true" />
      <div className="cp-section-content mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
        <h2 id="opacity-title" className="cp-section-title">opacity</h2>
        <p className="cp-section-lede">
          Turn on <code className="cp-code">alpha</code> and the picker gets an opacity slider, with the alpha in every format. Here it sets how much of the paint
          shows behind this section.
        </p>
        <div className="cp-section-layout">
          <div className="cp-section-controls">
            <div ref={panel} role="group" aria-label="Paint color">
              <ColorPickerPanel
                alpha
                color={value}
                onChange={change}
                format={format}
                onFormatChange={setFormat}
                labels={{ alpha: 'Paint opacity' }}
              />
            </div>
            <CopyValue value={value} />
          </div>
        </div>
      </div>
    </section>
  );
}
