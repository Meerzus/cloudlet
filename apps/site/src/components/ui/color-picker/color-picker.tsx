'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { springEasing } from '@/lib/spring';
import { COLOR_FORMATS, formatHsva, hsvToRgb, parseToHsva, type ColorFormat, type Hsva } from './color';

export type { ColorFormat } from './color';

/** The Cloudlet Island's opening spring: the swatch opens the way a pill does. */
const MORPH = springEasing({ stiffness: 900, damping: 60, mass: 2 });
/** The format highlight slides between segments on this spring: a hint of overshoot, settled in about 400 ms. */
const SEGMENT = springEasing({ stiffness: 420, damping: 30 });

export interface ColorPickerLabels {
  /** Name of the swatch button that opens the picker, e.g. "Pick background color". */
  readonly open: string;
  /** Name of the picker dialog, e.g. "Background color picker". */
  readonly panel: string;
  /** Name of the swatch inside the panel that closes it. */
  readonly close: string;
  /** Name of the saturation × brightness area. */
  readonly area: string;
  /** Name of the hue slider. */
  readonly hue: string;
  /** Name of the opacity slider. */
  readonly alpha: string;
  /** Name of the editable value field. */
  readonly value: string;
  /** Name of the format switch. */
  readonly format: string;
  /** Name of the presets group. */
  readonly presets: string;
  /** Name of the eyedropper button. */
  readonly eyedropper: string;
  /** Name of the copy button. */
  readonly copy: string;
  /** Spoken once the value has been copied. */
  readonly copied: string;
}

export const DEFAULT_LABELS: ColorPickerLabels = {
  open: 'Pick color',
  panel: 'Color picker',
  close: 'Close',
  area: 'Saturation and brightness',
  hue: 'Hue',
  alpha: 'Opacity',
  value: 'Color value',
  format: 'Format',
  presets: 'Presets',
  eyedropper: 'Pick from screen',
  copy: 'Copy',
  copied: 'Copied',
};

interface ColorPickerBaseProps {
  /** The color the picker edits (controlled): hex, rgb(), hsl() or oklch(). Anything else keeps the last valid value. */
  readonly color?: string;
  /** The initial color when the picker owns its value (uncontrolled). */
  readonly defaultColor?: string;
  /** Called with the new value in `format` on every change, and once more when the format switches. */
  readonly onChange?: (value: string) => void;
  /** The output format (controlled). */
  readonly format?: ColorFormat;
  /** The initial output format when the picker owns it; defaults to the first of `formats`. */
  readonly defaultFormat?: ColorFormat;
  readonly onFormatChange?: (format: ColorFormat) => void;
  /** The formats the switch offers, in order; a single entry hides the switch. */
  readonly formats?: readonly ColorFormat[];
  /** Shows the opacity slider; without it alpha is dropped from input and output. */
  readonly alpha?: boolean;
  /** Up to twelve preset colors shown as round swatches. */
  readonly presets?: readonly string[];
  /** Renders a hidden input with this name so the value travels with a native form. */
  readonly name?: string;
  readonly labels?: Partial<ColorPickerLabels>;
}

export interface ColorPickerProps extends ColorPickerBaseProps {
  /** Any CSS color painted on the swatch; defaults to the current value (a var() or oklch() can show here). */
  readonly swatch?: string;
}

export interface ColorPickerPanelProps extends ColorPickerBaseProps {
  readonly className?: string;
}

type Phase = 'closed' | 'open' | 'closing';

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const percent = (value: number) => Math.round(value * 100);
const MAX_PRESETS = 12;
const COPIED_FOR = 1200;
const STEP = 0.01;
const BIG_STEP = 0.1;

// --- Engine -------------------------------------------------------------------------------------

/** Pointer handlers that report the pressed point as fractions of the element, horizontally and vertically. */
function usePointerDrag(onPoint: (x: number, y: number) => void) {
  const report = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    onPoint(clamp01((event.clientX - rect.left) / rect.width), clamp01((event.clientY - rect.top) / rect.height));
  };
  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.currentTarget.focus({ preventScroll: true });
      report(event);
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      if (event.buttons & 1) report(event);
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    },
  };
}

/** The saturation × brightness square: one `role="slider"` whose arrows move both axes. */
function ColorArea({ hsva, onChange, label }: { hsva: Hsva; onChange: (next: Hsva) => void; label: string }) {
  const drag = usePointerDrag((x, y) => onChange({ ...hsva, s: x, v: 1 - y }));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    let { s, v } = hsva;
    switch (event.key) {
      case 'ArrowLeft': s -= step; break;
      case 'ArrowRight': s += step; break;
      case 'ArrowUp': v += step; break;
      case 'ArrowDown': v -= step; break;
      default: return;
    }
    event.preventDefault();
    onChange({ ...hsva, s: clamp01(s), v: clamp01(v) });
  };
  const style = { '--color-picker-hue': hsva.h } as CSSProperties;
  return (
    <div role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(hsva.s)} aria-valuetext={`Saturation ${percent(hsva.s)}%, Brightness ${percent(hsva.v)}%`} className="color-picker-area" style={style} onKeyDown={onKeyDown} {...drag}>
      <span className="color-picker-thumb" style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%` }} aria-hidden="true" />
    </div>
  );
}

interface SliderProps {
  readonly value: number;
  readonly max: number;
  readonly step: number;
  readonly bigStep: number;
  readonly label: string;
  readonly valueText: string;
  readonly className: string;
  readonly onChange: (value: number) => void;
}

/** A horizontal `role="slider"` pill: hue (0–360) or opacity (0–1). */
function ColorSlider({ value, max, step, bigStep, label, valueText, className, onChange }: SliderProps) {
  const drag = usePointerDrag((x) => onChange(x * max));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.shiftKey ? bigStep : step;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft': case 'ArrowDown': next = value - delta; break;
      case 'ArrowRight': case 'ArrowUp': next = value + delta; break;
      case 'Home': next = 0; break;
      case 'End': next = max; break;
      default: return;
    }
    event.preventDefault();
    onChange(Math.min(max, Math.max(0, next)));
  };
  return (
    <div role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={max === 1 ? Math.round(value * 100) / 100 : Math.round(value)} aria-valuetext={valueText} className={`color-picker-slider ${className}`} onKeyDown={onKeyDown} {...drag}>
      <span className="color-picker-thumb" style={{ left: `${(value / max) * 100}%` }} aria-hidden="true" />
    </div>
  );
}

// --- State --------------------------------------------------------------------------------------

interface PickerState {
  readonly hsva: Hsva;
  readonly format: ColorFormat;
  readonly formats: readonly ColorFormat[];
  /** The current value written in `format`: what the field shows and `onChange` reports. */
  readonly value: string;
  readonly set: (next: Hsva) => void;
  readonly setFormat: (format: ColorFormat) => void;
}

const FALLBACK: Hsva = { h: 0, s: 0, v: 1, a: 1 };

/**
 * Owns the HSV state, the output format and their controlled/uncontrolled modes. The color prop is
 * re-read only when it is not what the picker last emitted, so the hue survives zero saturation or
 * brightness; switching the format re-emits the same color so the field, the hidden input and the
 * owner agree.
 */
function usePickerState({ color, defaultColor, onChange, format, defaultFormat, onFormatChange, formats = COLOR_FORMATS, alpha = false }: ColorPickerBaseProps): PickerState {
  const [ownFormat, setOwnFormat] = useState<ColorFormat>(() => defaultFormat ?? formats[0] ?? 'hex');
  const currentFormat = format ?? ownFormat;
  const strip = (hsva: Hsva) => (alpha ? hsva : { ...hsva, a: 1 });
  const [hsva, setHsva] = useState<Hsva>(() => strip(parseToHsva(color ?? defaultColor ?? '') ?? FALLBACK));
  const emitted = useRef<string | null>(null);
  useEffect(() => {
    if (color === undefined || color === emitted.current) return;
    const parsed = parseToHsva(color);
    if (parsed) setHsva(alpha ? parsed : { ...parsed, a: 1 });
  }, [color, alpha]);
  const emit = (next: Hsva, nextFormat: ColorFormat) => {
    const value = formatHsva(next, nextFormat);
    emitted.current = value;
    onChange?.(value);
  };
  return {
    hsva,
    format: currentFormat,
    formats,
    value: formatHsva(hsva, currentFormat),
    set(next) {
      const stripped = strip(next);
      setHsva(stripped);
      emit(stripped, currentFormat);
    },
    setFormat(next) {
      if (next === currentFormat) return;
      if (format === undefined) setOwnFormat(next);
      onFormatChange?.(next);
      emit(hsva, next);
    },
  };
}

// --- Panel parts --------------------------------------------------------------------------------

/**
 * The editable value: every keystroke that parses is applied at once, an unparsable draft is
 * silently put back on blur or Enter, Escape puts it back and keeps the focus (a second Escape,
 * with nothing to put back, reaches the panel and closes it).
 */
function ValueField({ state, label }: { state: PickerState; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? state.value;
  const reset = () => setDraft(null);
  return (
    <input
      type="text"
      className="color-picker-value"
      aria-label={label}
      value={text}
      spellCheck={false}
      autoComplete="off"
      autoCapitalize="off"
      onChange={(event) => {
        const typed = event.target.value;
        setDraft(typed);
        const parsed = parseToHsva(typed);
        if (parsed) state.set(parsed);
      }}
      onBlur={reset}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          reset();
          return;
        }
        if (event.key === 'Escape' && draft !== null && draft !== state.value) {
          event.stopPropagation();
          reset();
        }
      }}
    />
  );
}

const FORMAT_NAMES: Record<ColorFormat, string> = { hex: 'hex', rgb: 'rgb', hsl: 'hsl', oklch: 'oklch' };

/** Native radios drawn as a segmented switch; one highlight slides under the checked one on a spring. */
function FormatSwitch({ state, label }: { state: PickerState; label: string }) {
  const name = useId();
  const group = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const active = state.formats.indexOf(state.format);
  useLayoutEffect(() => {
    const root = group.current;
    const pill = indicator.current;
    if (!root || !pill) return;
    const place = () => {
      const target = root.querySelectorAll<HTMLElement>('[data-segment]')[active];
      if (!target) return;
      pill.style.translate = `${target.offsetLeft}px 0`;
      pill.style.width = `${target.offsetWidth}px`;
    };
    place();
    const frame = requestAnimationFrame(() => root.setAttribute('data-ready', ''));
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    observer?.observe(root);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [active]);
  const style = { '--color-picker-segment-ease': SEGMENT.easing, '--color-picker-segment-duration': `${SEGMENT.duration}ms` } as CSSProperties;
  return (
    <fieldset className="color-picker-formats" aria-label={label} style={style}>
      <div ref={group} className="color-picker-segments">
        <span ref={indicator} className="color-picker-segment-indicator" aria-hidden="true" />
        {state.formats.map((format) => (
          <label key={format} data-segment className="color-picker-segment">
            <input type="radio" name={name} value={format} checked={state.format === format} onChange={() => state.setFormat(format)} className="color-picker-sr-only" />
            {FORMAT_NAMES[format]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Presets({ state, presets, label }: { state: PickerState; presets: readonly string[]; label: string }) {
  const current = formatHsva({ ...state.hsva, a: 1 }, 'hex');
  const entries = presets
    .map((preset) => ({ preset, hsva: parseToHsva(preset) }))
    .filter((entry): entry is { preset: string; hsva: Hsva } => entry.hsva !== null)
    .slice(0, MAX_PRESETS);
  if (entries.length === 0) return null;
  return (
    <div role="group" aria-label={label} className="color-picker-presets">
      {entries.map(({ preset, hsva }) => {
        const active = formatHsva({ ...hsva, a: 1 }, 'hex') === current;
        return (
          <button key={preset} type="button" className="color-picker-preset" aria-label={preset} aria-pressed={active} style={{ '--color-picker-preset': preset } as CSSProperties} onClick={() => state.set(hsva)} />
        );
      })}
    </div>
  );
}

interface EyeDropperResult { readonly sRGBHex: string }
interface EyeDropperLike { open(): Promise<EyeDropperResult> }
type EyeDropperWindow = Window & { EyeDropper?: new () => EyeDropperLike };

/** Shown only where the EyeDropper API exists (Chromium); decided after mount so SSR and hydration agree. */
function EyeDropperButton({ state, label }: { state: PickerState; label: string }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => setAvailable(typeof (window as EyeDropperWindow).EyeDropper === 'function'), []);
  if (!available) return null;
  const pick = async () => {
    const Picker = (window as EyeDropperWindow).EyeDropper;
    if (!Picker) return;
    try {
      const { sRGBHex } = await new Picker().open();
      const parsed = parseToHsva(sRGBHex);
      if (parsed) state.set({ ...parsed, a: state.hsva.a });
    } catch {
      // The user dismissed the eyedropper: nothing changes.
    }
  };
  return (
    <button type="button" className="color-picker-icon" aria-label={label} onClick={pick}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.2 2.6a1.9 1.9 0 0 1 2.7 2.7l-1.1 1.1-2.7-2.7z" />
        <path d="M9.1 3.7 3.6 9.2a1.5 1.5 0 0 0-.4.8l-.4 2.3 2.3-.4a1.5 1.5 0 0 0 .8-.4l5.5-5.5" />
      </svg>
    </button>
  );
}

/** Copies the current value; the icon turns into a check for a moment and a live region says so. */
function CopyButton({ value, label, copiedLabel }: { value: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return; // No clipboard access: the button stays as it is.
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_FOR);
  };
  return (
    <>
      <button type="button" className="color-picker-icon" aria-label={label} data-copied={copied || undefined} onClick={copy}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {copied ? <path d="M3 8.5 6.5 12 13 4.5" /> : (
            <>
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
              <path d="M10.5 5.5v-2A1.5 1.5 0 0 0 9 2H4a1.5 1.5 0 0 0-1.5 1.5v5A1.5 1.5 0 0 0 4 10h1.5" />
            </>
          )}
        </svg>
      </button>
      <span className="color-picker-sr-only" aria-live="polite">{copied ? copiedLabel : ''}</span>
    </>
  );
}

interface PanelBodyProps {
  readonly state: PickerState;
  readonly labels: ColorPickerLabels;
  readonly alpha: boolean;
  readonly presets?: readonly string[] | undefined;
  readonly name?: string | undefined;
  /** What sits left of the value field: the closing swatch (popover) or a plain swatch (inline). */
  readonly head: ReactNode;
  readonly bodyRef?: RefObject<HTMLDivElement | null>;
}

/** Everything inside the panel; shared by the morphing popover and the inline panel. */
function PanelBody({ state, labels, alpha, presets, name, head, bodyRef }: PanelBodyProps) {
  const { hsva } = state;
  return (
    <>
      <div className="color-picker-head">
        {head}
        <ValueField state={state} label={labels.value} />
      </div>
      <div ref={bodyRef} className="color-picker-body">
        <ColorArea hsva={hsva} onChange={state.set} label={labels.area} />
        <ColorSlider value={hsva.h} max={360} step={1} bigStep={10} label={labels.hue} valueText={`${Math.round(hsva.h)}°`} className="color-picker-hue" onChange={(h) => state.set({ ...hsva, h })} />
        {alpha ? <ColorSlider value={hsva.a} max={1} step={0.01} bigStep={0.1} label={labels.alpha} valueText={`${percent(hsva.a)}%`} className="color-picker-alpha" onChange={(a) => state.set({ ...hsva, a })} /> : null}
        {presets && presets.length > 0 ? <Presets state={state} presets={presets} label={labels.presets} /> : null}
        <div className="color-picker-footer">
          {state.formats.length > 1 ? <FormatSwitch state={state} label={labels.format} /> : <span />}
          <div className="color-picker-tools">
            <EyeDropperButton state={state} label={labels.eyedropper} />
            <CopyButton value={state.value} label={labels.copy} copiedLabel={labels.copied} />
          </div>
        </div>
      </div>
      {name ? <input type="hidden" name={name} value={state.value} /> : null}
    </>
  );
}

/** CSS variables every part of the picker reads: the current color, its opaque twin and the swatch paint. */
function pickerStyle(hsva: Hsva, swatch: string): CSSProperties {
  const { r, g, b } = hsvToRgb(hsva);
  return {
    '--color-picker-swatch': swatch,
    '--color-picker-current': formatHsva(hsva, 'hex'),
    '--color-picker-opaque': formatHsva({ ...hsva, a: 1 }, 'hex'),
    '--color-picker-rgb': `${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)}`,
  } as CSSProperties;
}

// --- Public components --------------------------------------------------------------------------

/** The picker without the swatch: rendered in the flow, for forms and sidebars. */
export function ColorPickerPanel({ className, labels: partial, alpha = false, presets, name, ...rest }: ColorPickerPanelProps) {
  const labels = { ...DEFAULT_LABELS, ...partial };
  const state = usePickerState({ ...rest, alpha });
  const style = pickerStyle(state.hsva, formatHsva(state.hsva, 'hex'));
  return (
    <div className={`color-picker-panel color-picker-inline${className ? ` ${className}` : ''}`} style={style}>
      <PanelBody state={state} labels={labels} alpha={alpha} presets={presets} name={name} head={<span className="color-picker-swatch" aria-hidden="true" />} />
    </div>
  );
}

/**
 * A round swatch that morphs into the color picker. The panel's clip grows out of the swatch circle
 * on a spring while the circle stays put, the content unblurs in, and closing shrinks it back into
 * the swatch. Escape and the in-panel swatch close and return focus to the trigger; a press outside
 * closes without moving focus. Without the Web Animations API or under reduced motion it opens and
 * closes instantly. Styles: color-picker.css (shadcn tokens: background, foreground, border, ring).
 */
export function ColorPicker({ swatch, labels: partial, alpha = false, presets, name, ...rest }: ColorPickerProps) {
  const labels = { ...DEFAULT_LABELS, ...partial };
  const panelId = useId();
  const [phase, setPhase] = useState<Phase>('closed');
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const running = useRef<Animation[]>([]);
  const state = usePickerState({ ...rest, alpha });

  const close = (refocus: boolean) => {
    setPhase((current) => (current === 'open' ? 'closing' : current));
    if (refocus) trigger.current?.focus();
  };

  useLayoutEffect(() => {
    const element = panel.current;
    const circle = handle.current;
    if (phase === 'closed' || !element || !circle) return;
    for (const animation of running.current) animation.cancel();
    running.current = [];
    if (phase === 'open') element.querySelector<HTMLElement>('.color-picker-area')?.focus({ preventScroll: true });
    if (typeof element.animate !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      if (phase === 'closing') setPhase('closed');
      return;
    }
    const box = element.getBoundingClientRect();
    const dot = circle.getBoundingClientRect();
    const top = dot.top - box.top;
    const left = dot.left - box.left;
    const collapsed = `inset(${top}px ${box.right - dot.right}px ${box.bottom - dot.bottom}px ${left}px round ${dot.width / 2}px)`;
    const expanded = 'inset(0px 0px 0px 0px round 1.25rem)';
    const content = body.current;
    if (phase === 'open') {
      running.current = [
        element.animate({ clipPath: [collapsed, expanded] }, { duration: MORPH.duration, easing: MORPH.easing }),
        ...(content ? [content.animate({ opacity: [0, 1], filter: ['blur(6px)', 'blur(0px)'] }, { duration: 240, delay: 70, easing: 'ease-out', fill: 'backwards' })] : []),
      ];
      return;
    }
    const shrink = element.animate({ clipPath: [expanded, collapsed] }, { duration: 240, easing: 'cubic-bezier(0.3, 0, 0.2, 1)', fill: 'forwards' });
    running.current = [shrink, ...(content ? [content.animate({ opacity: [1, 0], filter: ['blur(0px)', 'blur(6px)'] }, { duration: 140, easing: 'ease-in', fill: 'forwards' })] : [])];
    shrink.finished.then(() => setPhase('closed'), () => {});
  }, [phase]);

  useEffect(() => {
    if (phase !== 'open') return;
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [phase]);

  // The swatch shows what the owner passed (a var() or an out-of-gamut oklch() included) and falls back to the value.
  const style = pickerStyle(state.hsva, swatch ?? rest.color ?? state.value);
  return (
    <div className="color-picker" style={style}>
      <button ref={trigger} type="button" className="color-picker-swatch" aria-label={labels.open} aria-expanded={phase === 'open'} aria-controls={phase === 'closed' ? undefined : panelId} onClick={() => setPhase('open')} />
      {phase === 'closed' ? name ? <input type="hidden" name={name} value={state.value} /> : null : (
        // The drop shadow sits on a wrapper: the panel's own clip-path would cut it off.
        <div className="color-picker-shadow">
          <div ref={panel} id={panelId} role="dialog" aria-label={labels.panel} className="color-picker-panel" data-phase={phase} onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close(true);
            }
          }}>
            <PanelBody state={state} labels={labels} alpha={alpha} presets={presets} name={name} bodyRef={body} head={<button ref={handle} type="button" className="color-picker-swatch" aria-label={labels.close} onClick={() => close(true)} />} />
          </div>
        </div>
      )}
    </div>
  );
}
