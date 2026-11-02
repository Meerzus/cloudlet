'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { springEasing } from '@/lib/spring';
import { COLOR_FORMATS, formatHsva, hsvToRgb, parseToHsva, type ColorFormat, type Hsva } from './color';
import { CLIP_VARS, MORPH, RADIUS_VAR, SpringChannel, clipAt, morphClock, radiusAt, supportsMorphChannels } from './morph';
import './color-picker.css';

export type { ColorFormat } from './color';

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
 * re-read only when it is not the value the picker last emitted or read, so the hue survives zero
 * saturation or brightness; switching the format re-emits the same color so the field, the hidden input and the
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
    // Remember what was read from outside as well: a prop that later returns to an earlier emitted value is read again.
    emitted.current = color;
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
  readonly name?: string | undefined;
  /** What sits left of the value field: the closing swatch (popover) or a plain swatch (inline). */
  readonly head: ReactNode;
  readonly bodyRef?: RefObject<HTMLDivElement | null>;
}

/** Everything inside the panel; shared by the morphing popover and the inline panel. */
function PanelBody({ state, labels, alpha, name, head, bodyRef }: PanelBodyProps) {
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

// --- Placement ----------------------------------------------------------------------------------

interface Box { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }

/**
 * Which way the panel opens: `up` and/or `left` when the panel, measured where it opens by default
 * (down and right of the trigger), would cross that edge of the viewport and the mirrored side has
 * more room. Mirrored, the panel keeps the trigger's corner: its bottom and/or right edge sit where
 * the default panel has its top and left, one padding past the trigger.
 */
function flipFor(panel: Box, trigger: Box, viewport: { readonly width: number; readonly height: number }): string {
  const sides: string[] = [];
  // Room from the viewport's top (left) edge to where the mirrored panel would end.
  const above = trigger.bottom + (trigger.top - panel.top);
  const before = trigger.right + (trigger.left - panel.left);
  if (panel.bottom > viewport.height && above > viewport.height - panel.top) sides.push('up');
  if (panel.right > viewport.width && before > viewport.width - panel.left) sides.push('left');
  return sides.join(' ');
}

/** Measures the panel where it opens by default and mirrors it away from the viewport's edges (`data-flip` on the wrapper). */
function place(wrapper: HTMLElement, panel: HTMLElement, trigger: HTMLElement) {
  wrapper.setAttribute('data-flip', '');
  const view = wrapper.ownerDocument.defaultView ?? window;
  const root = wrapper.ownerDocument.documentElement;
  // clientWidth leaves out a classic scrollbar; jsdom reports 0 for it.
  const viewport = { width: root.clientWidth || view.innerWidth, height: root.clientHeight || view.innerHeight };
  wrapper.setAttribute('data-flip', flipFor(panel.getBoundingClientRect(), trigger.getBoundingClientRect(), viewport));
}

// --- Public components --------------------------------------------------------------------------

/** The picker without the swatch: rendered in the flow, for forms and sidebars. */
export function ColorPickerPanel({ className, labels: partial, alpha = false, name, ...rest }: ColorPickerPanelProps) {
  const labels = { ...DEFAULT_LABELS, ...partial };
  const state = usePickerState({ ...rest, alpha });
  const style = pickerStyle(state.hsva, formatHsva(state.hsva, 'hex'));
  return (
    <div className={`color-picker-panel color-picker-inline${className ? ` ${className}` : ''}`} style={style}>
      <PanelBody state={state} labels={labels} alpha={alpha} name={name} head={<span className="color-picker-swatch" aria-hidden="true" />} />
    </div>
  );
}

/**
 * A round swatch that morphs into the color picker. The panel's clip grows out of the swatch circle
 * on two springs (insets and radius) while the circle stays put, the rows unblur in one after
 * another, the shadow grows with the panel, and closing shrinks it back into the swatch; an open or
 * close interrupted in flight keeps its momentum (owner's pick V3, C03). Escape and the in-panel swatch close and return focus to the trigger; a press outside
 * closes without moving focus. Without the Web Animations API, under reduced motion or inside a
 * `data-reduced-motion` ancestor it opens and closes instantly. The panel opens down and to the right, and flips up and/or left when that would
 * cross the viewport's edge; it is not portalled, so a container with `overflow: hidden` clips it.
 * Styles: color-picker.css, imported here (shadcn tokens: background, foreground, border, ring).
 */
export function ColorPicker({ swatch, labels: partial, alpha = false, name, ...rest }: ColorPickerProps) {
  const labels = { ...DEFAULT_LABELS, ...partial };
  const panelId = useId();
  const [phase, setPhase] = useState<Phase>('closed');
  const trigger = useRef<HTMLButtonElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const running = useRef<Animation[]>([]);
  const size = useRef(new SpringChannel(0));
  const radius = useRef(new SpringChannel(0));
  const state = usePickerState({ ...rest, alpha });

  const close = (refocus: boolean) => {
    setPhase((current) => (current === 'open' ? 'closing' : current));
    if (refocus) trigger.current?.focus();
  };

  useLayoutEffect(() => {
    const element = panel.current;
    const origin = trigger.current;
    if (phase === 'closed' || !element || !origin) return;
    for (const animation of running.current) animation.cancel();
    running.current = [];
    const opening = phase === 'open';
    const target = opening ? 1 : 0;
    const wrapper = shadow.current;
    // Placed once per wrapper: an open that interrupts a close keeps the side the panel is on.
    if (opening && wrapper && !wrapper.hasAttribute('data-flip')) place(wrapper, element, origin);
    if (opening) element.querySelector<HTMLElement>('.color-picker-area')?.focus({ preventScroll: true });
    // An app's own "reduce motion" setting: `data-reduced-motion` on any ancestor stills the morph like the system preference.
    const still = typeof element.animate !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || element.closest('[data-reduced-motion]') !== null;
    if (still) {
      for (const channel of [size, radius]) channel.current.settle(target);
      delete element.dataset.morph;
      if (!opening) setPhase('closed');
      return;
    }
    // The clip starts as the trigger's circle, measured inside the panel's box.
    const box = element.getBoundingClientRect();
    const dot = origin.getBoundingClientRect();
    const collapsed: [number, number, number, number] = [dot.top - box.top, box.right - dot.right, box.bottom - dot.bottom, dot.left - box.left];
    const circle = dot.width / 2;
    const corner = parseFloat(getComputedStyle(element).borderRadius) || 20;
    const animations: Animation[] = [];
    const play = (node: Element, keyframes: PropertyIndexedKeyframes, timing: KeyframeAnimationOptions) => {
      const animation = node.animate(keyframes, { fill: 'both', ...timing });
      animation.playbackRate = morphClock.rate;
      animations.push(animation);
      return animation;
    };
    const grow = size.current.retarget(target, opening ? MORPH.sizeOpen : MORPH.sizeClose);
    const round = radius.current.retarget(target, opening ? MORPH.radiusOpen : MORPH.radiusClose);
    let last: Animation | null = null;
    if (supportsMorphChannels()) {
      // Two channels: the insets and the corner radius each move on their own spring.
      element.dataset.morph = 'channels';
      const finalClip = clipAt(collapsed, target);
      CLIP_VARS.forEach((name, index) => element.style.setProperty(name, finalClip[index] ?? '0px'));
      element.style.setProperty(RADIUS_VAR, radiusAt(circle, corner, target));
      if (grow) {
        const from = clipAt(collapsed, grow.from);
        const to = clipAt(collapsed, grow.to);
        const keyframes: PropertyIndexedKeyframes = {};
        CLIP_VARS.forEach((name, index) => { keyframes[name] = [from[index] ?? '0px', to[index] ?? '0px']; });
        last = play(element, keyframes, { duration: grow.duration, easing: grow.easing });
      }
      if (round) play(element, { [RADIUS_VAR]: [radiusAt(circle, corner, round.from), radiusAt(circle, corner, round.to)] }, { duration: round.duration, easing: round.easing });
    } else if (grow) {
      delete element.dataset.morph;
      const inset = (progress: number) => `inset(${clipAt(collapsed, progress).join(' ')} round ${radiusAt(circle, corner, progress)})`;
      last = play(element, { clipPath: [inset(grow.from), inset(grow.to)] }, { duration: grow.duration, easing: grow.easing });
    }
    // Content: unblurs after the clip has started to grow; with stagger, row by row.
    const content = body.current;
    if (content) {
      const blur = (from: number, to: number) => ({ opacity: [from, to], filter: [`blur(${MORPH.blur * (1 - from)}px)`, `blur(${MORPH.blur * (1 - to)}px)`] });
      const current = parseFloat(getComputedStyle(content).opacity);
      const rows = Array.from(content.children);
      // The rows unblur outward from the swatch: bottom first when the panel opens upward.
      if (wrapper?.getAttribute('data-flip')?.includes('up')) rows.reverse();
      if (opening && rows.length > 0) {
        content.style.opacity = '';
        rows.forEach((row, index) => play(row, blur(0, 1), { duration: MORPH.contentIn, delay: MORPH.contentDelay + index * MORPH.stagger, easing: 'ease-out' }));
      } else if (opening) {
        play(content, blur(Number.isFinite(current) ? current : 0, 1), { duration: MORPH.contentIn, delay: current > 0 ? 0 : MORPH.contentDelay, easing: 'ease-out' });
      } else {
        play(content, blur(Number.isFinite(current) ? current : 1, 0), { duration: MORPH.contentOut, easing: 'ease-in' });
      }
    }
    // Shadow: grows with the panel instead of hanging there from the first frame.
    if (wrapper && grow) {
      const drop = (progress: number) => `drop-shadow(0 ${12 * progress}px ${28 * progress}px rgb(0 0 0 / ${0.22 * progress})) drop-shadow(0 ${progress}px ${2 * progress}px rgb(0 0 0 / ${0.1 * progress}))`;
      play(wrapper, { filter: [drop(Math.max(0, grow.from)), drop(Math.max(0, grow.to))] }, { duration: grow.duration, easing: grow.easing });
    }
    running.current = animations;
    if (!opening) {
      if (last) last.finished.then(() => setPhase('closed'), () => {});
      else setPhase('closed');
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== 'open') return;
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) close(false);
    };
    // A resize while open places the panel again; the close re-measures the circle on its own.
    const view = panel.current?.ownerDocument.defaultView ?? window;
    const resize = () => {
      if (shadow.current && panel.current && trigger.current) place(shadow.current, panel.current, trigger.current);
    };
    document.addEventListener('pointerdown', outside, true);
    view.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      view.removeEventListener('resize', resize);
    };
  }, [phase]);

  // The swatch shows what the owner passed (a var() or an out-of-gamut oklch() included) and falls back to the value.
  const style = pickerStyle(state.hsva, swatch ?? rest.color ?? state.value);
  return (
    <div className="color-picker" style={style}>
      <button ref={trigger} type="button" className="color-picker-swatch" aria-label={labels.open} aria-expanded={phase === 'open'} aria-controls={phase === 'closed' ? undefined : panelId} onClick={() => setPhase('open')} />
      {phase === 'closed' ? name ? <input type="hidden" name={name} value={state.value} /> : null : (
        // The drop shadow sits on a wrapper: the panel's own clip-path would cut it off.
        <div ref={shadow} className="color-picker-shadow">
          <div ref={panel} id={panelId} role="dialog" aria-label={labels.panel} className="color-picker-panel" data-phase={phase} onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close(true);
            }
          }}>
            <PanelBody state={state} labels={labels} alpha={alpha} name={name} bodyRef={body} head={<button ref={handle} type="button" className="color-picker-swatch" aria-label={labels.close} onClick={() => close(true)} />} />
          </div>
        </div>
      )}
    </div>
  );
}
