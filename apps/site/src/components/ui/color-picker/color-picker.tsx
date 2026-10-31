'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { HexColorPicker } from 'react-colorful';
import { springEasing } from '@/lib/spring';

/** The Cloudlet Island's opening spring: the swatch opens the way a pill does. */
const MORPH = springEasing({ stiffness: 900, damping: 60, mass: 2 });

export interface ColorPickerLabels {
  /** Name of the swatch button that opens the picker, e.g. "Pick background color". */
  readonly open: string;
  /** Name of the picker dialog, e.g. "Background color picker". */
  readonly panel: string;
  /** Name of the swatch inside the panel that closes it. */
  readonly close: string;
}

export interface ColorPickerProps {
  /** The hex value the picker edits and shows. */
  readonly color: string;
  /** Any CSS color painted on the swatch; defaults to `color` (a var() or oklch() can show here). */
  readonly swatch?: string;
  readonly onChange: (hex: string) => void;
  readonly labels: ColorPickerLabels;
}

type Phase = 'closed' | 'open' | 'closing';

/**
 * A round swatch that morphs into a hex color picker. The panel's clip grows out of the swatch
 * circle on a spring while the circle stays put, the content unblurs in, and closing shrinks it back
 * into the swatch. Escape and the in-panel swatch close and return focus to the trigger; a press
 * outside closes without moving focus. Without the Web Animations API or under reduced motion it
 * opens and closes instantly. Styles: color-picker.css (shadcn tokens: background, foreground,
 * border, ring).
 */
export function ColorPicker({ color, swatch = color, onChange, labels }: ColorPickerProps) {
  const panelId = useId();
  const [phase, setPhase] = useState<Phase>('closed');
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const running = useRef<Animation[]>([]);

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
    if (phase === 'open') element.querySelector<HTMLElement>('.react-colorful__interactive')?.focus({ preventScroll: true });
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

  const style = { '--color-picker-swatch': swatch } as CSSProperties;
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
              <span className="color-picker-value">{color}</span>
            </div>
            <div ref={body}>
              <HexColorPicker color={color} onChange={onChange} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
