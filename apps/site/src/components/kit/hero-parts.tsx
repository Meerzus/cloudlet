'use client';

import type { NotificationKind } from '@cloudlet/toast';
import { Send } from 'lucide-react';
import { useRef, useState } from 'react';
import { usePickerColor } from '@/components/picker/picker-color';
import { usePageNotifications } from '@/components/site/notifications';
import { ColorPalette } from '@/components/ui/color-palette/color-palette';
import { ColorPickerPanel } from '@/components/ui/color-picker/color-picker';
import { pageStill } from '@/lib/reduced-motion';
import { hexOf } from './color-compare';
import { useColorNote } from './kit-color';
import { flyToast, TOAST_GLYPHS } from './toast-flight';

/** A notification the hero's Toaster can send: what its record shows and what lands in the Island. */
export interface HeroToast {
  readonly kind: 'success' | 'info' | 'error' | 'loading';
  /** The kind's name on its button. */
  readonly label: string;
  readonly title: string;
  readonly text: string;
  /** Loading only: what the notification turns into once the work is done. */
  readonly done?: { readonly title: string; readonly text: string };
}

/** The kinds the hero offers, in the order of their buttons; the first is shown at the start. */
export const HERO_TOASTS: readonly HeroToast[] = [
  { kind: 'success', label: 'Success', title: 'Synced to the cloud', text: 'Every change is saved.' },
  { kind: 'info', label: 'Info', title: 'Clear skies ahead', text: 'Nothing needs your attention.' },
  { kind: 'error', label: 'Error', title: 'Upload drifted off', text: 'Check the connection and try again.' },
  {
    kind: 'loading',
    label: 'Loading',
    title: 'Uploading 12 photos…',
    text: 'Lands as a success, in place.',
    done: { title: '12 photos are in the cloud', text: 'The same notification, updated.' },
  },
];

/** How long the hero's upload takes before it turns into a success. */
export const UPLOAD_MS = 1800;

/** A kind's status glyph as the package draws it: a stroked glyph, or the loading spinner. */
function Glyph({ kind }: { kind: NotificationKind }) {
  return kind === 'loading' ? (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="kh-spinner">
      <circle cx="8" cy="8" r="5.5" strokeDasharray="22 13" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={TOAST_GLYPHS[kind]} />
    </svg>
  );
}

/**
 * The Toaster: a record drawn as the package draws a notification (its status icon a glyph on 18 %
 * of the kind's color), the kinds to pick from and Send — which sends the real one out of the record
 * into the page's Island (it just appears under reduced motion). Loading turns into a success in place.
 */
function ToasterPart() {
  const controller = usePageNotifications();
  const [chosen, setChosen] = useState<HeroToast>(HERO_TOASTS[0]!);
  const [switched, setSwitched] = useState(false);
  const record = useRef<HTMLDivElement>(null);

  const deliver = (toast: HeroToast) => {
    if (!controller) return;
    const description = { kind: 'text', text: toast.text } as const;
    if (!toast.done) {
      controller.show({ title: toast.title, kind: toast.kind, description });
      return;
    }
    const { done } = toast;
    controller.track(new Promise<void>((resolve) => window.setTimeout(resolve, UPLOAD_MS)), {
      pending: { title: toast.title, description },
      success: { title: done.title, description: { kind: 'text', text: done.text } },
      error: { title: 'Upload drifted off' },
    });
  };

  const send = () => {
    if (!controller) return;
    const toast = chosen;
    const from = record.current;
    if (!from || pageStill() || typeof document.body.animate !== 'function') {
      deliver(toast);
      return;
    }
    flyToast(from.getBoundingClientRect(), toast.title, toast.kind, () => deliver(toast));
  };

  return (
    <div className="kh-part" data-part="toaster" role="group" aria-labelledby="kh-toaster-label">
      <p id="kh-toaster-label" className="kh-label">
        Toaster
      </p>
      <div ref={record} className="kh-toast" data-kind={chosen.kind} aria-hidden="true">
        <span className="kh-toast-icon">
          <Glyph key={chosen.kind} kind={chosen.kind} />
        </span>
        <span key={chosen.kind} className={switched ? 'kh-toast-words kit-swap' : 'kh-toast-words'}>
          <span className="kh-toast-title">{chosen.title}</span>
          <span className="kh-toast-text">{chosen.text}</span>
        </span>
      </div>
      <div className="kh-toast-controls">
        <div role="group" aria-label="Kind of notification" className="kh-kinds">
          {HERO_TOASTS.map((toast) => (
            <button
              key={toast.kind}
              type="button"
              className="kh-kind"
              data-kind={toast.kind}
              aria-label={toast.label}
              title={toast.label}
              aria-pressed={toast.kind === chosen.kind}
              onClick={() => {
                setChosen(toast);
                setSwitched(true);
              }}
            >
              <Glyph kind={toast.kind} />
            </button>
          ))}
        </div>
        <button type="button" className="kh-send kit-press" onClick={send} disabled={!controller}>
          <Send className="kh-send-icon" aria-hidden="true" />
          Send<span className="sr-only"> a {chosen.label.toLowerCase()} notification</span>
        </button>
      </div>
    </div>
  );
}

/** The color picker: its panel sets the page color, and the paint repaints out of it. */
function PickerPart() {
  const { value, hex, pick } = usePickerColor();
  const note = useColorNote();
  const panel = useRef<HTMLDivElement>(null);
  return (
    <div className="kh-part" data-part="color-picker" role="group" aria-labelledby="kh-picker-label">
      <p id="kh-picker-label" className="kh-label">
        Color picker
      </p>
      {/* The paint's first appearance spreads out of the panel. */}
      <div ref={panel} className="kh-panel" data-paint-origin="">
        <ColorPickerPanel
          color={value}
          onChange={(next) => {
            const changed = hexOf(next) !== hex;
            pick(next, panel.current ?? undefined);
            if (changed) note('accent');
          }}
          labels={{ panel: 'Page color' }}
        />
      </div>
    </div>
  );
}

/** The color palette: its row makes the palette the visitor's, and the paint takes its colors. */
function PalettePart() {
  const { palette, paletteHex, setPalette } = usePickerColor();
  const note = useColorNote();
  const row = useRef<HTMLDivElement>(null);
  return (
    <div className="kh-part" data-part="color-palette" role="group" aria-labelledby="kh-palette-label">
      <p id="kh-palette-label" className="kh-label">
        Color palette
      </p>
      <div ref={row} className="kh-tray">
        <ColorPalette
          colors={palette}
          onChange={(colors) => {
            const changed = colors.map((color) => hexOf(color) ?? '').join() !== paletteHex.join();
            setPalette(colors, row.current ?? undefined);
            if (changed) note('palette');
          }}
          labels={{ group: 'Page palette' }}
        />
      </div>
    </div>
  );
}

/**
 * The hero's live side: the kit's three components, each the real one at the same weight, Toaster
 * first. The picker and the palette set the page's one color (KitColor) — the paint repaints and the
 * Island reports it once it settles; Send puts a notification in the same Island.
 */
export function HeroParts() {
  return (
    <div className="kh-parts" role="group" aria-label="Try the kit">
      <ToasterPart />
      <PickerPart />
      <PalettePart />
      <p className="kh-note">Set a color or a palette: the page repaints, and the Toaster says so.</p>
    </div>
  );
}
