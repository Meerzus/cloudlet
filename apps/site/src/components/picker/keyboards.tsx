'use client';

import { useEffect, useRef, useState } from 'react';
import { ColorPicker, ColorPickerPanel } from '@/components/ui/color-picker/color-picker';
import { usePickerColor } from './picker-color';

/** The cheat sheet: each row's keys (as `KeyboardEvent.key`), how they read and what they do. */
const KEYS: readonly { readonly keys: readonly (readonly [key: string, label: string])[]; readonly does: string }[] = [
  { keys: [['ArrowLeft', '←'], ['ArrowRight', '→']], does: 'Saturation in the area by 1%, hue on its slider by 1°, opacity by 1%' },
  { keys: [['ArrowUp', '↑'], ['ArrowDown', '↓']], does: 'Brightness in the area' },
  { keys: [['Shift', 'Shift']], does: 'With an arrow: ten steps at once' },
  { keys: [['Home', 'Home'], ['End', 'End']], does: 'A slider to its ends' },
  { keys: [['Tab', 'Tab']], does: 'Value field, area, hue, format, eyedropper, copy, in that order' },
  { keys: [['Enter', 'Enter'], [' ', 'Space']], does: 'Open the picker from its swatch' },
  { keys: [['Escape', 'Esc']], does: 'Revert the value field, then close and return to the swatch' },
];
const KNOWN = new Set(KEYS.flatMap((row) => row.keys.map(([key]) => key)));

/**
 * Built for keyboards (COLOR_PICKER §8.5): the inline panel on the page's color, a cheat sheet
 * that lights the keys being pressed anywhere in the section, and a reduce-motion switch next to a
 * swatch showing the morph go (`data-reduced-motion` on an ancestor, as an app's own setting would).
 */
export function Keyboards() {
  const { value, pick } = usePickerColor();
  const section = useRef<HTMLElement>(null);
  const [pressed, setPressed] = useState<ReadonlySet<string>>(new Set());
  const [still, setStill] = useState(false);

  useEffect(() => {
    const host = section.current;
    if (!host) return;
    const down = (event: KeyboardEvent) => {
      if (KNOWN.has(event.key)) setPressed((keys) => new Set(keys).add(event.key));
    };
    const up = (event: KeyboardEvent) =>
      setPressed((keys) => {
        if (!keys.has(event.key)) return keys;
        const next = new Set(keys);
        next.delete(event.key);
        return next;
      });
    // Focus leaving the section would strand a key lit up.
    const clear = () => setPressed(new Set());
    host.addEventListener('keydown', down);
    host.addEventListener('keyup', up);
    host.addEventListener('focusout', clear);
    window.addEventListener('blur', clear);
    return () => {
      host.removeEventListener('keydown', down);
      host.removeEventListener('keyup', up);
      host.removeEventListener('focusout', clear);
      window.removeEventListener('blur', clear);
    };
  }, []);

  return (
    <section ref={section} id="keyboards" aria-labelledby="keyboards-title" className="cp-section">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
        <h2 id="keyboards-title" className="cp-section-title">built for keyboards</h2>
        <p className="cp-section-lede">
          Every part of the picker answers the keys, and a screen reader hears what changed: “Saturation 40%, Brightness
          80%”, “Hue 48°”. Try it here — this panel paints the sky above.
        </p>
        <div className="cp-keyboards">
          <ColorPickerPanel color={value} onChange={pick} className="cp-keyboards-panel" />
          <table className="cp-keys">
            <caption className="sr-only">Keyboard shortcuts</caption>
            <tbody>
              {KEYS.map((row) => (
                <tr key={row.does}>
                  <th scope="row">
                    {row.keys.map(([key, label]) => (
                      <kbd key={key} data-pressed={pressed.has(key) || undefined}>
                        {label}
                      </kbd>
                    ))}
                  </th>
                  <td>{row.does}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="cp-motion-demo" data-reduced-motion={still ? '' : undefined}>
          <ColorPicker color={value} onChange={pick} labels={{ open: 'Open the motion demo picker', panel: 'Motion demo picker' }} />
          <button type="button" role="switch" aria-checked={still} className="cp-switch" onClick={() => setStill((current) => !current)}>
            <span className="cp-switch-track" aria-hidden="true">
              <span className="cp-switch-thumb" />
            </span>
            Reduce motion
          </button>
          <p className="text-sm text-muted-foreground">
            {still
              ? 'The swatch now opens in a single frame: no morph, no unblur, the same picker.'
              : 'The swatch morphs into the panel on springs. Turn this on, or the system setting, and it simply appears.'}
          </p>
        </div>
      </div>
    </section>
  );
}
