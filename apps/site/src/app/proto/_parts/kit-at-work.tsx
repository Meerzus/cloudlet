'use client';

import { useEffect, useRef } from 'react';
import { usePickerColor } from '@/components/picker/picker-color';
import { usePageNotifications } from '@/components/site/notifications';
import { ColorPalette } from '@/components/ui/color-palette/color-palette';
import { ColorPickerPanel } from '@/components/ui/color-picker/color-picker';
import { InstallCommand } from './install-command';
import { SloganSwitch, useSlogan } from './slogan-switch';

/** How long a color must rest before the Island reports it: a drag reports once, when it ends. */
const SETTLE = 450;
/** One notification for the accent: later changes update it in place while it is on screen. */
const ACCENT_ID = 'proto-accent';

type Controller = NonNullable<ReturnType<typeof usePageNotifications>>;

function report(controller: Controller, title: string, text: string) {
  const handle = controller.getHandle(ACCENT_ID);
  if (handle && controller.update(handle, { title, description: { kind: 'text', text } }).status === 'applied') return;
  controller.show({ id: ACCENT_ID, title, kind: 'success', description: { kind: 'text', text } });
}

/**
 * Prototype A, the kit at work: a small live interface made of the kit itself. The picker panel sets
 * the page color, the palette builds on it (or becomes the visitor's own), the picker's paint under
 * the whole window repaints from the control that changed it, and the page Toaster reports the change.
 */
export function KitAtWork() {
  const { slogan, index, select } = useSlogan('a');
  const { value, hex, palette, paletteHex, own, started, pick, setPalette } = usePickerColor();
  const controller = usePageNotifications();
  const panel = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const seen = useRef<string | null>(null);
  const greeted = useRef(false);

  // A first hint once the paint is up: the Island is part of the interface from the start.
  useEffect(() => {
    if (!started || !controller || greeted.current) return;
    greeted.current = true;
    const timer = window.setTimeout(
      () => controller.show({ title: 'Pick a color', kind: 'info', description: { kind: 'text', text: 'Drag in the panel: the page repaints.' } }),
      1400,
    );
    return () => window.clearTimeout(timer);
  }, [started, controller]);

  const key = `${hex}|${own ? paletteHex.join(',') : ''}`;
  useEffect(() => {
    if (!started || !controller) return;
    if (seen.current === null) {
      seen.current = key;
      return;
    }
    if (seen.current === key) return;
    const before = seen.current;
    const timer = window.setTimeout(() => {
      seen.current = key;
      const accentChanged = before.split('|')[0] !== hex;
      if (accentChanged) report(controller, 'Accent updated', `The page now paints in ${hex.toUpperCase()}.`);
      else report(controller, 'Palette updated', `${paletteHex.length} colors, darkest in the shadows.`);
    }, SETTLE);
    return () => window.clearTimeout(timer);
  }, [key, hex, paletteHex, started, controller]);

  return (
    <section aria-labelledby="proto-a-title" className="pa-hero" data-started={started || undefined}>
      <div className="pa-inner">
        <div className="cp-hero-copy pa-copy">
          <h1 id="proto-a-title" key={slogan.title} className="pa-title proto-swap">
            {slogan.title}
          </h1>
          <p key={slogan.lede} className="pa-lede proto-swap">
            {slogan.lede}
          </p>
          <InstallCommand className="mt-9" />
        </div>
        <div className="cp-section pa-instrument" role="group" aria-label="Try the kit">
          <div className="pa-part">
            <p className="pa-label">Color picker</p>
            <div ref={panel} className="cp-hero-panel pa-panel">
              <ColorPickerPanel color={value} onChange={(next) => pick(next, panel.current ?? undefined)} labels={{ panel: 'Page color' }} />
            </div>
          </div>
          <div className="pa-part">
            <p className="pa-label">Color palette</p>
            <div ref={row} className="pa-palette">
              <ColorPalette colors={palette} onChange={(colors) => setPalette(colors, row.current ?? undefined)} labels={{ group: 'Page palette' }} />
            </div>
          </div>
          <p className="pa-label pa-note">The Toaster reports every change.</p>
        </div>
      </div>
      <SloganSwitch id="a" index={index} onSelect={select} />
    </section>
  );
}
