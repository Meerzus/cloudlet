import { useEffect, useRef, useState } from 'react';
import { ColorPalette } from '@/components/ui/color-palette/color-palette';
import type { ColorFormat } from '@/components/ui/color-picker/color-picker';
import { morphClock } from '@/components/ui/color-picker/morph';

const RATES = [1, 0.5, 0.25, 0.1] as const;
const MAXES = [2, 3, 4, 6] as const;

/**
 * `?fixture=color-palette`: the palette on top of the color picker, in a card, to try by trackpad
 * and keyboard before it reaches the landing — add, change, remove, the format shared by every
 * picker, slow motion, the app's own reduce-motion switch, light and dark, and what a form receives.
 */
export function ColorPaletteFixture() {
  const [rate, setRate] = useState<number>(1);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [reduced, setReduced] = useState(false);
  const [alpha, setAlpha] = useState(false);
  const [max, setMax] = useState<number>(4);
  const [format, setFormat] = useState<ColorFormat>('hex');
  const [colors, setColors] = useState<string[]>(['#ff6a3d', '#2f8f9d']);
  const [submitted, setSubmitted] = useState<string[]>([]);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    morphClock.rate = rate;
    return () => { morphClock.rate = 1; };
  }, [rate]);
  useEffect(() => {
    if (form.current) setSubmitted(new FormData(form.current).getAll('palette').map(String));
  }, [colors]);
  return (
    <main className="lab-cp" data-theme={theme} data-reduced-motion={reduced ? '' : undefined}>
      <header className="lab-cp-header">
        <div>
          <p className="lab-cp-kicker">Color palette</p>
          <h1>One to {max} colors</h1>
          <p>+ adds the last color turned in hue and opens its picker; × or Delete removes a color. Tab reaches the row once, ← → Home End move inside it, Enter opens a picker. The format switch in any picker changes every color.</p>
        </div>
        <div className="lab-cp-controls">
          <div className="lab-cp-buttons">
            <button type="button" onClick={() => setColors(['#ff6a3d', '#2f8f9d'])}>Reset</button>
            <button type="button" onClick={() => setColors([])}>Empty array</button>
          </div>
          <fieldset className="lab-cp-choice">
            <legend>Speed</legend>
            {RATES.map((option) => (
              <label key={option}><input type="radio" name="rate" checked={rate === option} onChange={() => setRate(option)} />×{option}</label>
            ))}
          </fieldset>
          <fieldset className="lab-cp-choice">
            <legend>Max</legend>
            {MAXES.map((option) => (
              <label key={option}><input type="radio" name="max" checked={max === option} onChange={() => setMax(option)} />{option}</label>
            ))}
          </fieldset>
          <fieldset className="lab-cp-choice">
            <legend>Theme</legend>
            {(['light', 'dark'] as const).map((option) => (
              <label key={option}><input type="radio" name="theme" checked={theme === option} onChange={() => setTheme(option)} />{option}</label>
            ))}
          </fieldset>
          <fieldset className="lab-cp-choice">
            <legend>Options</legend>
            <label><input type="checkbox" checked={alpha} onChange={(event) => setAlpha(event.target.checked)} />alpha</label>
            <label><input type="checkbox" checked={reduced} onChange={(event) => setReduced(event.target.checked)} />data-reduced-motion</label>
          </fieldset>
        </div>
      </header>
      <section className="lab-cp-grid" aria-label="Scene">
        <article className="lab-cp-card">
          <h2>Palette</h2>
          <p>Swatches grow in and fold away on springs; slow it down to watch a removal interrupt an addition.</p>
          <form ref={form} className="lab-cpal-stage" onSubmit={(event) => event.preventDefault()}>
            <ColorPalette colors={colors} onChange={setColors} max={max} format={format} onFormatChange={setFormat} alpha={alpha} name="palette" labels={{ group: 'Stand palette' }} />
          </form>
          <dl className="lab-cpal-readout">
            <dt>onChange</dt><dd data-testid="palette-value">{JSON.stringify(colors)}</dd>
            <dt>format</dt><dd>{format}</dd>
            <dt>FormData.getAll</dt><dd>{JSON.stringify(submitted)}</dd>
          </dl>
        </article>
      </section>
    </main>
  );
}
