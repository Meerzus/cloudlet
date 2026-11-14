'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { COLOR_FORMATS, formatColor, parseColor } from '@/components/ui/color-picker/color';
import { ColorPicker } from '@/components/ui/color-picker/color-picker';
import { averageHex, framePoint, readPixels } from '@/lib/frame-sample';
import { useCopy } from './copy-value';
import type { FlutedScene, GlassLook } from './fluted-glass';
import { GlassCard } from './glass-card';
import { usePickerColor } from './picker-color';

/** The glass over the Tools flowers (COLOR_PICKER §8.8): thin prism ribs, the owner's pick B. */
export const TOOLS_GLASS: GlassLook = {
  size: 0.7,
  shape: 'lines',
  distortionShape: 'prism',
  distortion: 0.4,
  angle: 0,
  shift: 0,
  blur: 0,
  edges: 0.25,
  stretch: 0,
  highlights: 0.12,
  shadows: 0.2,
  grainMixer: 0,
  grainOverlay: 0,
};

/** The crosshair's step under the arrow keys, and with Shift, as a share of the card. */
const AIM_STEP = 0.02;
const AIM_BIG_STEP = 0.1;
/** The crosshair starts on the red flower left of the middle. */
export const START_AIM = { x: 0.38, y: 0.42 } as const;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Tools (COLOR_PICKER §8.7): flowers in their own colors behind fluted glass. A click on the card
 * takes the color under the pointer off the source picture (a 2D canvas, so every browser) and makes
 * it the page color, bleeding out from there; from the keyboard the card is one button whose arrow
 * keys move a crosshair and whose Enter takes the color under it. Beside it the compact ColorPicker as
 * a developer gets it — swatch, morph, eyedropper where the browser has one, copy, formats — and the
 * same color in all four formats, each copied by a click.
 */
export function Tools() {
  const { value, hex, pick } = usePickerColor();
  const scene = useRef<FlutedScene | null>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const pixels = useRef<ReturnType<typeof readPixels>>(null);
  const [aim, setAim] = useState<{ x: number; y: number }>(START_AIM);
  const [taken, setTaken] = useState<string | null>(null);
  const hint = useId();
  const swatch = useRef<HTMLDivElement>(null);
  const rgb = useMemo(() => parseColor(hex)!, [hex]);
  const { copied, copy } = useCopy();

  const take = (x: number, y: number, box: DOMRect) => {
    const picture = image.current;
    if (!picture || picture.naturalWidth === 0) return;
    pixels.current ??= readPixels(picture);
    const source = pixels.current;
    if (!source) return;
    const glass = scene.current;
    const point = framePoint(x, y, box, { width: source.width, height: source.height }, glass?.drift, glass?.zoom);
    const color = averageHex(source.data, source.width, source.height, Math.round(point.u * (source.width - 1)), Math.round(point.v * (source.height - 1)), 2);
    // The new paint spreads out of the point it was taken at, in page coordinates.
    pick(color, { x: box.left + x + window.scrollX, y: box.top + y + window.scrollY });
    setTaken(color);
  };

  const click = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    // Enter and Space click with no pointer position: the crosshair says where.
    if (event.detail === 0) {
      take(aim.x * box.width, aim.y * box.height, box);
      return;
    }
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    setAim({ x: clamp01(x / box.width), y: clamp01(y / box.height) });
    take(x, y, box);
  };

  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? AIM_BIG_STEP : AIM_STEP;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!move) return;
    event.preventDefault();
    setAim((current) => ({ x: clamp01(current.x + move[0]!), y: clamp01(current.y + move[1]!) }));
  };

  return (
    <section id="tools" aria-labelledby="tools-title" className="cp-section">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
        <h2 id="tools-title" className="cp-section-title">tools</h2>
        <p className="cp-section-lede">
          The eyedropper where the browser has one, a copy button and four formats. Click the flowers to take their color: that part works in
          every browser.
        </p>
        <div className="cp-glass-layout">
          <div className="cp-glass-controls">
            <div ref={swatch} className="cp-tools-picker">
              <ColorPicker color={value} onChange={(next) => pick(next, swatch.current ?? undefined)} labels={{ open: 'Open the tools picker', panel: 'Tools picker' }} />
              <p className="text-sm text-muted-foreground">The swatch as you get it: it opens into the picker.</p>
            </div>
            <div role="group" aria-labelledby="tools-formats-title">
              <h3 id="tools-formats-title" className="cp-hints-title">
                The same color in four formats
              </h3>
              <ul className="cp-formats">
                {COLOR_FORMATS.map((format) => {
                  const text = formatColor(rgb, format);
                  const done = copied === text;
                  return (
                    <li key={format}>
                      {/* The name is the visible text with "Copy" before it (WCAG 2.5.3); "copied" is a CSS badge the live region below says aloud. */}
                      <button type="button" className="cp-format" onClick={() => void copy(text)} data-copied={done || undefined}>
                        <span className="sr-only">Copy </span>
                        <span className="cp-format-name">{format}</span> <span className="cp-format-value">{text}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <span className="sr-only" aria-live="polite">
                {copied ? `Copied ${copied}` : ''}
              </span>
            </div>
          </div>
          <GlassCard frame="tools" look={TOOLS_GLASS} scene={scene} image={image}>
            <button type="button" className="cp-frame-pick" aria-label="Take a color from the flowers" aria-describedby={hint} onClick={click} onKeyDown={key}>
              <span className="cp-aim" style={{ left: `${aim.x * 100}%`, top: `${aim.y * 100}%` }} aria-hidden="true" />
            </button>
            <span id={hint} className="sr-only">
              Arrow keys move the crosshair, Enter takes the color under it.
            </span>
            <span className="sr-only" aria-live="polite">
              {taken ? `Page color ${taken}` : ''}
            </span>
          </GlassCard>
        </div>
      </div>
    </section>
  );
}
