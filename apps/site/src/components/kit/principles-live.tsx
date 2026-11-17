'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { usePageStill } from '@/components/site/motion';
import { Segmented } from '@/components/site/segmented';
import { useTheme } from '@/components/site/theme';
import { useMediaQuery } from '@/components/site/use-media-query';
import { ColorPalette } from '@/components/ui/color-palette/color-palette';
import { ColorPicker } from '@/components/ui/color-picker/color-picker';
import { morphClock } from '@/components/ui/color-picker/morph';
import { REDUCED_QUERY, releaseStill, setStill, stillWanted } from '@/lib/reduced-motion';
import { TOASTER_DOCS_PATH } from '@/lib/site';
import { presetCss, presetStyle, THEME_PRESETS } from '@/lib/theme-presets';

/** Slow motion: every picker on the page at a quarter of its speed, so a turn-around is easy to see. */
const SLOW = 0.25;
/** The focus path keeps this many stops. */
const PATH_LENGTH = 7;

function Switch({ checked, onChange, disabled = false, describedBy, children }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; describedBy?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      aria-describedby={describedBy}
      className="kp-switch"
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
    >
      <span className="kp-switch-track" aria-hidden="true">
        <span className="kp-switch-thumb" />
      </span>
      {children}
    </button>
  );
}

/** Motion: a live picker to catch halfway, and a slow-motion switch for the springs. */
export function MotionProof() {
  const still = usePageStill();
  const [slow, setSlow] = useState(false);
  const [color, setColor] = useState('#2f6bff');

  useEffect(() => {
    morphClock.rate = slow ? SLOW : 1;
    return () => {
      morphClock.rate = 1;
    };
  }, [slow]);

  return (
    <div className="kp-sheet kp-motion">
      <div className="kp-motion-row">
        <ColorPicker color={color} onChange={setColor} labels={{ open: 'Open the picker to catch', panel: 'Picker to catch' }} />
        <Switch checked={slow && !still} onChange={setSlow} disabled={still}>
          Slow motion
        </Switch>
      </div>
      <p className="kp-note">
        {still
          ? 'Motion is off on this page, so the panel opens and closes in one frame: the same picker, nothing to catch.'
          : slow
            ? 'Every picker on the page now runs at a quarter speed. Open the swatch and press it again on the way.'
            : 'Press the swatch, then press it again before the panel lands.'}
      </p>
    </div>
  );
}

/** What a stop is called: its label, as a screen reader would start reading it. */
function stopName(element: EventTarget | null): string | null {
  if (!(element instanceof HTMLElement)) return null;
  const label = element.getAttribute('aria-label') ?? (element instanceof HTMLInputElement ? element.labels?.[0]?.textContent : null) ?? element.textContent;
  return label?.trim() || null;
}

/** Accessibility: the page's own reduce-motion switch, and the path Tab takes through a live picker. */
export function AccessProof() {
  const system = useMediaQuery(REDUCED_QUERY) === true;
  const [on, setOn] = useState(false);
  const [said, setSaid] = useState('');
  const note = useId();

  // The choice holds for the visit; leaving the page takes the attribute off <html> (only this page has it).
  useEffect(() => {
    if (stillWanted()) {
      setStill(true);
      setOn(true);
    }
    return () => releaseStill();
  }, []);

  const toggle = (next: boolean) => {
    setStill(next);
    setOn(next);
    setSaid(next ? 'Motion is reduced on this page.' : 'Motion is back on this page.');
  };

  return (
    <div className="kp-access">
      <div className="kp-sheet kp-still">
        <Switch checked={system || on} onChange={toggle} disabled={system} describedBy={note}>
          Reduce motion on this page
        </Switch>
        <p id={note} className="kp-note">
          {system
            ? 'Your system already asks for reduced motion, and the whole page follows it.'
            : 'Stops smooth scrolling, the sky’s parallax, the scenes, the paint’s spread and flow, and every entrance here. The Color picker and the Color palette follow it too; the Toaster, in the Island and on the phones, follows your system setting.'}
        </p>
        <span className="sr-only" role="status">
          {said}
        </span>
      </div>
      <FocusPath />
    </div>
  );
}

function FocusPath() {
  const [path, setPath] = useState<readonly string[]>([]);
  const [inside, setInside] = useState(false);
  const entered = useRef(false);
  const [color, setColor] = useState('#e0569b');

  const focus = (event: FocusEvent<HTMLDivElement>) => {
    const name = stopName(event.target);
    if (!name) return;
    const fresh = !entered.current;
    entered.current = true;
    setInside(true);
    setPath((current) => (fresh ? [name] : current.at(-1) === name ? current : [...current, name].slice(-PATH_LENGTH)));
  };
  const blur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    entered.current = false;
    setInside(false);
  };

  return (
    <div className="kp-sheet kp-focus">
      <div className="kp-focus-head">
        <p className="kp-note">
          Press <kbd>Tab</kbd> from the switch, <kbd>Enter</kbd> on the swatch, then <kbd>Tab</kbd> again: every stop the keys reach lines up here.
        </p>
      </div>
      <ol className="kp-path" aria-hidden="true" data-empty={path.length === 0 || undefined}>
        {path.length === 0 ? (
          <li className="kp-path-empty">No stops yet</li>
        ) : (
          path.map((name, index) => (
            <li key={`${index}-${name}`} data-current={(inside && index === path.length - 1) || undefined}>
              {name}
            </li>
          ))
        )}
      </ol>
      {/* Under the path, so the panel opens below it and the path stays in view. */}
      <div className="kp-focus-picker" onFocus={focus} onBlur={blur}>
        <ColorPicker color={color} onChange={setColor} labels={{ open: 'Open the picker to walk through', panel: 'Picker to walk through' }} />
      </div>
    </div>
  );
}

/** Your theme: presets on the shadcn tokens, on this block's wrapper only. */
export function ThemeProof() {
  const [id, setId] = useState(THEME_PRESETS[0]!.id);
  const [said, setSaid] = useState('');
  const [color, setColor] = useState('#d9480f');
  const [colors, setColors] = useState<string[]>(['#1f3a5f', '#4f7cac', '#c0d6df', '#f2a541']);
  const { resolved } = useTheme();
  const preset = THEME_PRESETS.find((candidate) => candidate.id === id) ?? THEME_PRESETS[0]!;
  const css = presetCss(preset, resolved);

  const choose = (next: string) => {
    setId(next);
    setSaid(`The picker and the palette now use ${THEME_PRESETS.find((candidate) => candidate.id === next)?.label ?? next}.`);
  };

  return (
    <div className="kp-theme-proof">
      <div className="kp-theme" data-preset={preset.tokens ? preset.id : undefined} style={presetStyle(preset)}>
        <div className="kp-sheet kp-theme-sheet">
          <Segmented legend="Theme" options={THEME_PRESETS.map((option) => ({ value: option.id, label: option.label }))} value={id} onChange={choose} />
          <div className="kp-theme-row">
            <span className="kp-theme-label">Accent</span>
            <ColorPicker color={color} onChange={setColor} labels={{ open: 'Pick the themed accent', panel: 'Themed accent' }} />
          </div>
          <div className="kp-theme-row">
            <span className="kp-theme-label">Palette</span>
            <ColorPalette colors={colors} onChange={setColors} labels={{ group: 'Themed palette' }} />
          </div>
          <span className="sr-only" role="status">
            {said}
          </span>
        </div>
      </div>
      <pre className="ki-code kp-theme-code" aria-label={`${preset.label} as your stylesheet holds it`}>
        <code>
          {css.length === 0 ? (
            <span className="kp-tok-comment">{'/* This page’s own tokens: nothing to override. */'}</span>
          ) : (
            <>
              <span className="kp-tok-selector">{resolved === 'dark' ? '.dark' : ':root'}</span>
              {' {\n'}
              {css.map(([name, value]) => (
                <span key={name}>
                  {'  '}
                  <span className="kp-tok-name">{name}</span>
                  {': '}
                  <span className="kp-tok-value">{value}</span>
                  {';\n'}
                </span>
              ))}
              {'}'}
            </>
          )}
        </code>
      </pre>
      <p className="kp-note">
        The Toaster draws from its own <code>--cloudlet-*</code> variables; its shadcn item bridges them to these tokens.{' '}
        <Link href={`${TOASTER_DOCS_PATH}/styling`} className="kit-open kp-link">
          Tune them in the style editor
          <ArrowRight className="kit-open-arrow" aria-hidden="true" />
        </Link>
      </p>
    </div>
  );
}
