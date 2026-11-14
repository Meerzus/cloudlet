'use client';

import { useRef } from 'react';
import { ColorPickerPanel } from '@/components/ui/color-picker/color-picker';
import { usePickerColor } from './picker-color';

/**
 * The landing's hero (COLOR_PICKER §8.4): the top of the paint under the whole page (paint-page.tsx),
 * with the picker panel open beside the headline. It has no canvas of its own: the page's paint shows
 * through it, and a jump made in the panel spreads out of the panel.
 */
export function PickerHero() {
  const { value, started, pick } = usePickerColor();
  const panel = useRef<HTMLDivElement>(null);

  return (
    <section id="hero" aria-labelledby="hero-title" className="cp-hero" data-started={started || undefined}>
      <div className="cp-hero-inner">
        <div className="cp-hero-copy">
          <h1 id="hero-title" className="cp-hero-title">
            pick a color,
            <br />
            paint the page
          </h1>
          <p className="cp-hero-lede">
            A color picker for React: hex, rgb, hsl and oklch, an eyedropper and full keyboard support. One shadcn item, no
            dependencies.
          </p>
        </div>
        <div ref={panel} className="cp-hero-panel" role="group" aria-label="Page color">
          <ColorPickerPanel color={value} onChange={(next) => pick(next, panel.current ?? undefined)} />
        </div>
      </div>
    </section>
  );
}
