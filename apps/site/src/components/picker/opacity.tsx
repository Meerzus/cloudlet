'use client';

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { formatColor, parseColor, type ColorFormat } from '@/components/ui/color-picker/color';
import { ColorPickerPanel } from '@/components/ui/color-picker/color-picker';
import { CALM_TEXT, calmMap, lineRects, type CalmMap } from '@/lib/paint-calm';
import { CopyValue } from './copy-value';
import { usePickerColor } from './picker-color';

/** The film starts half dense: `#rrggbb80`, the paint and the color both in view. */
export const START_ALPHA = 0.5;

const smoothstep = (value: number) => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};

/**
 * The film's mask: opaque everywhere but under the section's copy, where it opens as the page's paper
 * is lifted there (the same calm map, the same shoulder), so the copy stays on paper at any density.
 * A PNG data URL sized in CSS px; null where a 2D canvas cannot be had.
 */
export function filmMask(map: CalmMap): { readonly image: string; readonly width: number; readonly height: number } | null {
  const canvas = document.createElement('canvas');
  canvas.width = map.width;
  canvas.height = map.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const pixels = context.createImageData(map.width, map.height);
  for (let index = 0; index < map.data.length; index += 1) pixels.data[index * 4 + 3] = Math.round(255 * (1 - smoothstep(map.data[index]! / 255)));
  context.putImageData(pixels, 0, 0);
  return { image: canvas.toDataURL('image/png'), width: map.width * map.scale, height: map.height * map.scale };
}

/**
 * Opacity (COLOR_PICKER §8.6): a film of the page color over the page's own paint within this
 * section, under its copy and its panel, whose density is the alpha of the panel — at 0 % the paint,
 * at 100 % the color. Under the copy the film opens, as the paint's paper is lifted there. The alpha
 * lives in this section and never changes the page color; moving the panel's color itself does paint
 * the page, as every other panel on it does.
 */
export function Opacity() {
  const { hex, pick } = usePickerColor();
  const [alpha, setAlpha] = useState(START_ALPHA);
  const [format, setFormat] = useState<ColorFormat>('hex');
  const rgb = useMemo(() => parseColor(hex)!, [hex]);
  const value = formatColor({ ...rgb, a: alpha }, format);

  const panel = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const [mask, setMask] = useState<ReturnType<typeof filmMask>>(null);

  // The windows follow the copy: rebuilt when the section changes size (fonts, wrapping, the window).
  useLayoutEffect(() => {
    const host = section.current;
    if (!host) return;
    let pending = 0;
    const measure = () => {
      pending = 0;
      const box = host.getBoundingClientRect();
      if (box.width === 0) return;
      const copy = [...document.querySelectorAll(CALM_TEXT)].filter((element) => host.contains(element));
      setMask(filmMask(calmMap(lineRects(copy, -box.left, -box.top), box.width, box.height)));
    };
    const remeasure = () => {
      if (!pending) pending = requestAnimationFrame(measure);
    };
    measure();
    const resize = new ResizeObserver(remeasure);
    resize.observe(host);
    void document.fonts?.ready.then(remeasure);
    return () => {
      cancelAnimationFrame(pending);
      resize.disconnect();
    };
  }, []);

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
    <section ref={section} id="opacity" aria-labelledby="opacity-title" className="cp-section cp-film-section">
      <div
        className="cp-film"
        data-testid="opacity-film"
        style={{
          opacity: alpha,
          ...(mask && { '--cp-film-mask': `url("${mask.image}")`, '--cp-film-mask-size': `${mask.width}px ${mask.height}px` }),
        } as CSSProperties}
        aria-hidden="true"
      />
      <div className="cp-section-content mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
        <h2 id="opacity-title" className="cp-section-title">opacity</h2>
        <p className="cp-section-lede">
          Turn on <code className="cp-code">alpha</code> and the picker gets an opacity slider, with the alpha in every format. Here it sets how thick the page
          color lies over the paint.
        </p>
        <div className="cp-section-layout">
          <div className="cp-section-controls">
            <div ref={panel} role="group" aria-label="Film color">
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
        </div>
      </div>
    </section>
  );
}
