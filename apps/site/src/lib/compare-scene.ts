/**
 * The Toaster scene on the kit's landing: two identical phones side by side, a plain stack of toasts
 * on the left and the real Toaster on the right, and one set of buttons that sends the same
 * notifications to both at the same moment. Everything here is data and timing, no DOM: the scene
 * schedules a step once and hands every event to both sides (`playStep`).
 */

/** Kinds the scene sends; all of them leave by themselves once they are not loading. */
export type CompareKind = 'success' | 'info' | 'loading';

export interface CompareToast {
  readonly title: string;
  readonly kind: CompareKind;
  /** Milliseconds on screen; null stays until updated (loading). */
  readonly duration: number | null;
}

export type CompareEvent =
  | { readonly at: number; readonly type: 'show'; readonly id: string; readonly toast: CompareToast }
  | { readonly at: number; readonly type: 'update'; readonly id: string; readonly toast: CompareToast }
  | { readonly at: number; readonly type: 'dismiss'; readonly id: string };

export type CompareStepId = 'one' | 'three' | 'update' | 'undo';

export interface CompareStep {
  readonly id: CompareStepId;
  /** The button. */
  readonly label: string;
  /** The events of one press; `run` keeps the ids of every press apart. */
  readonly events: (run: string) => readonly CompareEvent[];
}

/** How long a settled toast stays on both sides (the Toaster's own default is longer: 6 s). */
export const COMPARE_DURATION = 4000;
/** The plain stack's fade, in and out. */
export const PLAIN_FADE_MS = 300;
/** The plain stack shows at most this many; a newer one pushes the oldest out at once. */
export const PLAIN_LIMIT = 4;

const toast = (title: string, kind: CompareKind = 'success'): CompareToast => ({
  title,
  kind,
  duration: kind === 'loading' ? null : COMPARE_DURATION,
});

/** Cloud texts, short, as on the Toaster's landing. */
export const COMPARE_STEPS: readonly CompareStep[] = [
  {
    id: 'one',
    label: 'Send one',
    events: (run) => [{ at: 0, type: 'show', id: `${run}-a`, toast: toast('Synced to the cloud') }],
  },
  {
    id: 'three',
    label: 'Send three',
    events: (run) => [
      { at: 0, type: 'show', id: `${run}-a`, toast: toast('Synced to the cloud') },
      { at: 260, type: 'show', id: `${run}-b`, toast: toast('3 new photos in Shared', 'info') },
      { at: 520, type: 'show', id: `${run}-c`, toast: toast('Light rain after 4 pm', 'info') },
    ],
  },
  {
    id: 'update',
    label: 'Update',
    events: (run) => [
      { at: 0, type: 'show', id: `${run}-a`, toast: toast('Uploading 12 photos…', 'loading') },
      { at: 1600, type: 'update', id: `${run}-a`, toast: toast('12 photos are in the cloud') },
    ],
  },
  {
    id: 'undo',
    label: 'Take back',
    // Dismissed while it is still arriving: the Toaster turns around, the plain stack finishes its fade first.
    events: (run) => [
      { at: 0, type: 'show', id: `${run}-a`, toast: toast('Message sent') },
      { at: 140, type: 'dismiss', id: `${run}-a` },
    ],
  },
];

/** The step the scene plays once by itself, the first time it is on screen. */
export const COMPARE_FIRST_STEP: CompareStepId = 'three';

/** Neutral captions: the plain side is described, never named after a library. */
export const COMPARE_SIDES = {
  plain: { label: 'A plain stack', note: 'Fades in, fades out, finishes every animation.' },
  toaster: { label: 'Toaster', note: 'Live. Tap the stack to open it.' },
} as const;

/** A side of the comparison: the plain stack, or the frame running the real Toaster. */
export interface CompareTarget {
  apply(event: CompareEvent): void;
}

export interface CompareClock {
  /** Runs `callback` after `ms`; returns a cancel. */
  after(ms: number, callback: () => void): () => void;
}

export const browserClock: CompareClock = {
  after(ms, callback) {
    const timer = window.setTimeout(callback, ms);
    return () => window.clearTimeout(timer);
  },
};

/**
 * Plays one press: every event goes to every target in the same tick, so both sides always get the
 * same input at the same moment. Returns a cancel for the events that have not happened yet.
 */
export function playStep(step: CompareStep, run: string, targets: readonly CompareTarget[], clock: CompareClock) {
  const cancels = step.events(run).map((event) =>
    clock.after(event.at, () => {
      for (const target of targets) target.apply(event);
    }),
  );
  return () => {
    for (const cancel of cancels) cancel();
  };
}

/* ---------- Fitting the two phones ---------- */

/** The phone shell's footprint in its natural px (devices.ts, `phone`). */
export const PHONE_FOOTPRINT = { width: 433.66, height: 905.34 } as const;
/** Gap between the two phones when they stand side by side, CSS px. */
export const PHONE_GAP = 24;
/** One above the other (narrow screens), each phone shows only its lower part, natural px. */
export const STACKED_SHOWN = 380;
/** The largest a phone may get. */
const MAX_SCALE = 0.9;

export interface PhoneFit {
  /** CSS transform scale of each phone. */
  readonly scale: number;
  /** How much of the phone's natural height shows, from its bottom (the toasts live there). */
  readonly shown: number;
}

/**
 * Side by side, the phones share the width and stay under `maxHeight`; one above the other, each
 * takes the whole width and shows its lower part, so both still fit on a phone's screen together.
 */
export function fitPhones({ width, maxHeight, stacked }: { width: number; maxHeight: number; stacked: boolean }): PhoneFit {
  if (stacked) {
    return { scale: Math.max(0, Math.min(width / PHONE_FOOTPRINT.width, MAX_SCALE)), shown: STACKED_SHOWN };
  }
  const each = (width - PHONE_GAP) / 2;
  const scale = Math.max(0, Math.min(each / PHONE_FOOTPRINT.width, maxHeight / PHONE_FOOTPRINT.height, MAX_SCALE));
  return { scale, shown: PHONE_FOOTPRINT.height };
}
