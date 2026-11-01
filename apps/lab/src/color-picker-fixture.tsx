import { useEffect, useState } from 'react';
import { ColorPicker } from '@/components/ui/color-picker/color-picker';
import { morphClock } from '@/components/ui/color-picker/morph';
import '@/components/ui/color-picker/color-picker.css';

export interface ColorPickerFixtureApi {
  open: () => void;
  close: () => void;
  /** Opens the picker and closes it again after `afterMs`: the interruption test. */
  interrupt: (afterMs: number) => void;
  setRate: (rate: number) => void;
}

declare global {
  interface Window { colorPickerFixture?: ColorPickerFixtureApi; }
}

const RATES = [1, 0.5, 0.25, 0.1] as const;

function trigger() {
  return document.querySelector<HTMLButtonElement>('.lab-cp-stage > .color-picker > button.color-picker-swatch');
}
function open() {
  const button = trigger();
  if (button && button.getAttribute('aria-expanded') !== 'true') button.click();
}
function close() {
  document.querySelector<HTMLElement>('.lab-cp-stage [role="dialog"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

/**
 * `?fixture=color-picker`: the morph scene — the owner's pick (V3 of C03: interruptible, size and
 * radius on their own springs, rows unblurring one after another, the shadow growing with the
 * panel) in slow motion, light and dark, with an interruption button. Kept as the regression scene.
 */
export function ColorPickerFixture() {
  const [rate, setRate] = useState<number>(1);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [color, setColor] = useState('#007aff');
  useEffect(() => {
    morphClock.rate = rate;
    return () => { morphClock.rate = 1; };
  }, [rate]);
  useEffect(() => {
    const api: ColorPickerFixtureApi = {
      open,
      close,
      interrupt: (afterMs) => { open(); window.setTimeout(close, afterMs); },
      setRate: (next) => setRate(next),
    };
    window.colorPickerFixture = api;
    return () => { delete window.colorPickerFixture; };
  }, []);
  return (
    <main className="lab-cp" data-theme={theme}>
      <header className="lab-cp-header">
        <div>
          <p className="lab-cp-kicker">Color picker · morph</p>
          <h1>Swatch → panel</h1>
          <p>Click the swatch or open it from here; interrupt an opening with Escape or a closing with a second click. Slow it down to watch the two springs.</p>
        </div>
        <div className="lab-cp-controls">
          <div className="lab-cp-buttons">
            <button type="button" onClick={open}>Open</button>
            <button type="button" onClick={close}>Close</button>
            <button type="button" onClick={() => { open(); window.setTimeout(close, 140 / rate); }}>Open → close at 140 ms</button>
          </div>
          <fieldset className="lab-cp-choice">
            <legend>Speed</legend>
            {RATES.map((option) => (
              <label key={option}><input type="radio" name="rate" checked={rate === option} onChange={() => setRate(option)} />×{option}</label>
            ))}
          </fieldset>
          <fieldset className="lab-cp-choice">
            <legend>Theme</legend>
            {(['light', 'dark'] as const).map((option) => (
              <label key={option}><input type="radio" name="theme" checked={theme === option} onChange={() => setTheme(option)} />{option}</label>
            ))}
          </fieldset>
        </div>
      </header>
      <section className="lab-cp-grid" aria-label="Scene">
        <article className="lab-cp-card">
          <h2>Interruptible · two springs · staggered rows · growing shadow</h2>
          <p>The clip grows out of the swatch on the Island's shape spring, the radius on its own; the rows unblur 40 ms apart.</p>
          <div className="lab-cp-stage">
            <ColorPicker color={color} onChange={setColor} alpha labels={{ open: 'Open the picker', panel: 'Morph scene picker' }} />
            <span className="lab-cp-value">{color}</span>
          </div>
        </article>
      </section>
    </main>
  );
}
