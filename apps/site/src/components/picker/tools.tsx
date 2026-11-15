'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { COLOR_FORMATS, formatColor, parseColor } from '@/components/ui/color-picker/color';
import { ColorPicker } from '@/components/ui/color-picker/color-picker';
import { useCopy } from './copy-value';
import { usePickerColor } from './picker-color';

/** The crosshair's step under the arrow keys, and with Shift, as a share of the section. */
const AIM_STEP = 0.02;
const AIM_BIG_STEP = 0.1;
/** The crosshair starts in the open paint right of the controls. */
export const START_AIM = { x: 0.72, y: 0.6 } as const;

/** A click on these is theirs, not the paint's. */
const CONTROLS = 'a, button, input, select, textarea, summary, [role="slider"], [role="radio"], [tabindex], [data-paint-skip]';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Tools (COLOR_PICKER §8.7): the compact ColorPicker as a developer gets it — swatch, morph, the
 * eyedropper where the browser has one, copy, formats — and the same color in all four formats, each
 * copied by a click. A click on the paint anywhere in the section (not on its controls) takes the
 * color the paint shows there and makes it the page color, spreading out of that point; the color is
 * worked out from the frame and the ramp (lib/paint-sample.ts), so every browser gets it. From the
 * keyboard the paint is one button whose arrows move a crosshair over the section and whose Enter
 * takes the color under it.
 */
export function Tools() {
  const { value, hex, pick, paint } = usePickerColor();
  const section = useRef<HTMLElement>(null);
  const [aim, setAim] = useState<{ x: number; y: number }>(START_AIM);
  const [taken, setTaken] = useState<string | null>(null);
  const hint = useId();
  const swatch = useRef<HTMLDivElement>(null);
  const rgb = useMemo(() => parseColor(hex)!, [hex]);
  const { copied, copy } = useCopy();

  /** Takes the paint's color at (x, y) CSS px from the section's top-left. */
  const take = (x: number, y: number) => {
    const host = section.current;
    const probe = paint.current;
    if (!host || !probe) return;
    const box = host.getBoundingClientRect();
    const point = { x: box.left + x + window.scrollX, y: box.top + y + window.scrollY };
    const color = probe.colorAt(point.x, point.y);
    // The new paint spreads out of the point it was taken at, in page coordinates.
    pick(color, point);
    setTaken(color);
  };

  const click = (event: MouseEvent<HTMLElement>) => {
    const host = section.current;
    if (!host) return;
    const target = event.target as Element;
    const own = target.closest('.cp-paint-pick') !== null;
    // Enter and Space on the paint's button click with no pointer position: the crosshair says where.
    if (event.detail === 0) {
      if (own) {
        const box = host.getBoundingClientRect();
        take(aim.x * box.width, aim.y * box.height);
      }
      return;
    }
    if (!own && target.closest(CONTROLS)) return;
    // Selecting the copy is not a pick.
    if (!(window.getSelection()?.isCollapsed ?? true)) return;
    const box = host.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    setAim({ x: clamp01(x / box.width), y: clamp01(y / box.height) });
    take(x, y);
  };

  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? AIM_BIG_STEP : AIM_STEP;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!move) return;
    event.preventDefault();
    setAim((current) => ({ x: clamp01(current.x + move[0]!), y: clamp01(current.y + move[1]!) }));
  };

  return (
    // The section takes a click on the paint; its button below is the same thing for the keyboard.
    <section ref={section} id="tools" aria-labelledby="tools-title" className="cp-section cp-pick-section" onClick={click}>
      <button type="button" className="cp-paint-pick" aria-label="Take a color from the paint" aria-describedby={hint} onKeyDown={key}>
        <span className="cp-aim" style={{ left: `${aim.x * 100}%`, top: `${aim.y * 100}%` }} aria-hidden="true" />
      </button>
      <span id={hint} className="sr-only">
        Arrow keys move the crosshair, Enter takes the color under it.
      </span>
      <span className="sr-only" aria-live="polite">
        {taken ? `Page color ${taken}` : ''}
      </span>
      <div className="cp-section-content mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
        <h2 id="tools-title" className="cp-section-title">tools</h2>
        <p className="cp-section-lede">
          The eyedropper where the browser has one, a copy button and four formats. Click anywhere on the paint around them to take its
          color: that part works in every browser.
        </p>
        <div className="cp-section-layout">
          <div className="cp-section-controls">
            <div ref={swatch} className="cp-tools-picker" data-paint-skip>
              <ColorPicker color={value} onChange={(next) => pick(next, swatch.current ?? undefined)} labels={{ open: 'Open the tools picker', panel: 'Tools picker' }} />
              <p className="text-sm text-muted-foreground">The swatch as you get it: it opens into the picker.</p>
            </div>
            <div role="group" aria-labelledby="tools-formats-title">
              <h3 id="tools-formats-title" className="cp-hints-title">
                The same color in four formats
              </h3>
              <ul className="cp-formats" data-paint-skip>
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
        </div>
      </div>
    </section>
  );
}
