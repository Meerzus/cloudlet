'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { springEasing } from '@/lib/spring';
import { formatHsva, hsvToRgb, parseToHsva, type Hsva } from './color';

/** The Cloudlet Island's opening spring: the swatch opens the way a pill does. */
const MORPH = springEasing({ stiffness: 900, damping: 60, mass: 2 });

export interface ColorPickerLabels {
  /** Name of the swatch button that opens the picker, e.g. "Pick background color". */
  readonly open: string;
  /** Name of the picker dialog, e.g. "Background color picker". */
  readonly panel: string;
  /** Name of the swatch inside the panel that closes it. */
  readonly close: string;
  /** Name of the saturation × brightness area. */
  readonly area?: string;
  /** Name of the hue slider. */
  readonly hue?: string;
  /** Name of the opacity slider. */
  readonly alpha?: string;
}

export interface ColorPickerProps {
  /** The color the picker edits: hex, rgb(), hsl() or oklch(). Anything else keeps the last valid value. */
  readonly color: string;
  /** Any CSS color painted on the swatch; defaults to `color` (a var() or oklch() can show here). */
  readonly swatch?: string;
  /** Called with the hex of every change (`#rrggbbaa` when `alpha` is on and opacity is below 1). */
  readonly onChange: (hex: string) => void;
  /** Shows the opacity slider. */
  readonly alpha?: boolean;
  readonly labels: ColorPickerLabels;
}

type Phase = 'closed' | 'open' | 'closing';

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const percent = (value: number) => Math.round(value * 100);

const DEFAULT_LABELS = { area: 'Saturation and brightness', hue: 'Hue', alpha: 'Opacity' } as const;

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

const STEP = 0.01;
const BIG_STEP = 0.1;

interface AreaProps {
  readonly hsva: Hsva;
  readonly onChange: (next: Hsva) => void;
  readonly label: string;
}

/** The saturation × brightness square: one `role="slider"` whose arrows move both axes. */
function ColorArea({ hsva, onChange, label }: AreaProps) {
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

/**
 * Keeps the picker's HSV state and the `color` prop in step without losing the hue at zero
 * saturation or brightness: the prop is re-read only when it is not what the picker last emitted.
 */
function useHsvaState(color: string, alpha: boolean, onChange: (hex: string) => void) {
  const [hsva, setHsva] = useState<Hsva>(() => parseToHsva(color) ?? { h: 0, s: 0, v: 1, a: 1 });
  const emitted = useRef<string | null>(null);
  useEffect(() => {
    if (color === emitted.current) return;
    const parsed = parseToHsva(color);
    if (parsed) setHsva(alpha ? parsed : { ...parsed, a: 1 });
  }, [color, alpha]);
  const update = (next: Hsva) => {
    const value = alpha ? next : { ...next, a: 1 };
    setHsva(value);
    const hex = formatHsva(value, 'hex');
    emitted.current = hex;
    onChange(hex);
  };
  return [hsva, update] as const;
}

/**
 * A round swatch that morphs into a color picker. The panel's clip grows out of the swatch circle
 * on a spring while the circle stays put, the content unblurs in, and closing shrinks it back into
 * the swatch. Escape and the in-panel swatch close and return focus to the trigger; a press outside
 * closes without moving focus. Without the Web Animations API or under reduced motion it opens and
 * closes instantly. Styles: color-picker.css (shadcn tokens: background, foreground, border, ring).
 */
export function ColorPicker({ color, swatch = color, onChange, alpha = false, labels }: ColorPickerProps) {
  const panelId = useId();
  const [phase, setPhase] = useState<Phase>('closed');
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const running = useRef<Animation[]>([]);
  const [hsva, update] = useHsvaState(color, alpha, onChange);

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

  const hex = formatHsva(hsva, 'hex');
  const opaque = formatHsva({ ...hsva, a: 1 }, 'hex');
  const { r, g, b } = hsvToRgb(hsva);
  const style = {
    '--color-picker-swatch': swatch,
    '--color-picker-current': hex,
    '--color-picker-opaque': opaque,
    '--color-picker-rgb': `${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)}`,
  } as CSSProperties;
  return (
    <div className="color-picker" style={style}>
      <button ref={trigger} type="button" className="color-picker-swatch" aria-label={labels.open} aria-expanded={phase === 'open'} aria-controls={phase === 'closed' ? undefined : panelId} onClick={() => setPhase('open')} />
      {phase === 'closed' ? null : (
        // The drop shadow sits on a wrapper: the panel's own clip-path would cut it off.
        <div className="color-picker-shadow">
          <div ref={panel} id={panelId} role="dialog" aria-label={labels.panel} className="color-picker-panel" data-phase={phase} onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close(true);
            }
          }}>
            <div className="color-picker-head">
              <button ref={handle} type="button" className="color-picker-swatch" aria-label={labels.close} onClick={() => close(true)} />
              <span className="color-picker-value">{hex}</span>
            </div>
            <div ref={body} className="color-picker-body">
              <ColorArea hsva={hsva} onChange={update} label={labels.area ?? DEFAULT_LABELS.area} />
              <ColorSlider value={hsva.h} max={360} step={1} bigStep={10} label={labels.hue ?? DEFAULT_LABELS.hue} valueText={`${Math.round(hsva.h)}°`} className="color-picker-hue" onChange={(h) => update({ ...hsva, h })} />
              {alpha ? <ColorSlider value={hsva.a} max={1} step={0.01} bigStep={0.1} label={labels.alpha ?? DEFAULT_LABELS.alpha} valueText={`${percent(hsva.a)}%`} className="color-picker-alpha" onChange={(a) => update({ ...hsva, a })} /> : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
