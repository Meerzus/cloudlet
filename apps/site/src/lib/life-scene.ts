import type { PuppetFace, PuppetState } from './puppet-model';
import type { PuppetStep } from './puppeteer';

/**
 * Scene 2, "Life of a notification" (LANDING §7): one notification lives through ten
 * plateaus on a pinned, scrubbed timeline. Timeline units are seconds of the puppet
 * script; the scroll length maps onto them.
 */

const SYNCED: PuppetFace = { id: 'synced', kind: 'success', title: 'Synced to the cloud' };
const FORECAST: PuppetFace = { id: 'forecast', kind: 'info', title: 'Forecast: clear skies' };
const READY: PuppetFace = {
  id: 'ready',
  kind: 'info',
  title: '12 photos ready to upload',
  description: 'Holiday album · 48 MB',
  action: 'Upload',
};
const STORM: PuppetFace = {
  id: 'storm',
  kind: 'warning',
  title: 'Storm ahead: storage almost full',
  description: 'Only 3% of your sky is left.',
  action: 'Upgrade',
};
const MAKING_ROOM: PuppetFace = { id: 'room', kind: 'loading', title: 'Making room in the sky…', description: 'Doubling your storage.' };
const UPLOADING: PuppetFace = { id: 'uploading', kind: 'loading', title: 'Uploading 12 photos…', description: '{progress} of 48 MB', ring: true };
const DRIFTED: PuppetFace = {
  id: 'drifted',
  kind: 'error',
  title: 'Upload drifted off',
  description: 'Lost the signal above the clouds.',
  retry: true,
};
const LANDED: PuppetFace = { id: 'landed', kind: 'success', title: '12 photos are in the cloud', description: 'Holiday album · 48 MB' };

/** Island states show the three notifications of the stack as dots. */
const island = (face: PuppetFace, extra: Partial<PuppetState> = {}): PuppetState => ({ face, mode: 'island', count: 3, ...extra });

export const LIFE_STATES: readonly PuppetState[] = [
  /* 0 */ { face: SYNCED, mode: 'pill', present: false },
  /* 1 */ { face: SYNCED, mode: 'pill' },
  /* 2 */ { face: FORECAST, mode: 'pill', count: 2 },
  /* 3 */ { face: READY, mode: 'pill', count: 3 },
  /* 4 */ island(READY),
  /* 5 */ island(STORM),
  /* 6 */ island(MAKING_ROOM),
  /* 7 */ island(UPLOADING, { progress: [0.06, 0.94] }),
  /* 8 */ island(DRIFTED),
  /* 9 */ island(DRIFTED, { highlight: 1 }),
  /* 10 */ island(LANDED),
  /* 11 */ { face: LANDED, mode: 'pill', count: 3 },
];

export interface LifeCaption {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

/** One caption per plateau, in order (LANDING §7). */
export const LIFE_CAPTIONS: readonly LifeCaption[] = [
  { id: 'arrive', title: 'Arrives softly', text: 'A pill grows out of thin air, on a spring.' },
  { id: 'stack', title: 'Stacks, never piles', text: 'Newcomers land on top. The rest wait behind, counted.' },
  { id: 'open', title: 'Opens when it matters', text: 'The pill becomes an Island in one continuous shape. Text never stretches.' },
  { id: 'warn', title: 'Speaks up', text: 'Warnings carry their own action and never steal focus.' },
  { id: 'loading', title: 'Keeps its promises', text: 'track() shows loading while the work is in flight.' },
  { id: 'progress', title: 'Shows real progress', text: 'The ring follows the upload, frame by frame.' },
  { id: 'error', title: 'Fails gracefully', text: 'Errors say what went wrong and keep the way forward.' },
  { id: 'retry', title: 'One tap to retry', text: 'Retry is built in. No glue code.' },
  { id: 'success', title: 'Lands the result', text: 'Success replaces the spinner in place.' },
  { id: 'drift', title: 'Then drifts away', text: 'Done, it folds back into the stack and floats off like a cloud.' },
];

/** Which state each plateau shows; the second arrival rides inside the "stack" plateau. */
export const LIFE_STEPS: readonly PuppetStep[] = [
  { state: 0, hold: 0.5 },
  { state: 1, hold: 1, stretch: 2.4, label: 'arrive' },
  { state: 2, hold: 0.35, stretch: 2 },
  { state: 3, hold: 1, stretch: 2, label: 'stack' },
  { state: 4, hold: 1.1, stretch: 1.6, label: 'open' },
  { state: 5, hold: 1, stretch: 1.8, label: 'warn' },
  { state: 6, hold: 1, stretch: 1.8, label: 'loading' },
  { state: 7, hold: 2.2, stretch: 1.8, label: 'progress' },
  { state: 8, hold: 1, stretch: 1.8, label: 'error' },
  { state: 9, hold: 1, stretch: 1, label: 'retry' },
  { state: 10, hold: 1, stretch: 1.8, label: 'success' },
  { state: 11, hold: 0.8, stretch: 1.6, label: 'drift' },
];

/** After the last plateau the stack turns into a cloud and floats up (timeline seconds). */
export const LIFE_DRIFT = 1.6;

/** Pinned length in viewport heights (the section is this plus one screen). */
export const LIFE_PIN_SCREENS = 8;

/** Desktop camera: the puppet is shown at this scale of its 1:1 size (pills a little closer). */
export const LIFE_CAMERA = { island: 1.5, pill: 1.8, minWidth: 768 } as const;

/** Snap to plateau centres after scrolling stops (picked by the owner on a trackpad, L03: variant A). */
export const LIFE_SNAP = {
  /** Seconds after the last scroll event. */
  delay: 0.15,
  /** Seconds, scaled by the distance to the label. */
  duration: { min: 0.3, max: 0.8 },
  ease: 'power2.inOut',
} as const;

/** Scroll smoothing of the scrubbed timeline, seconds (owner, L03). */
export const LIFE_SCRUB = 0.6;
