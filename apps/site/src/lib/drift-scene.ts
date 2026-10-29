import type { PuppetFace, PuppetState } from './puppet-model';
import { formatKB, PACKAGE_SIZE } from './site';

/**
 * Scene 3, "Drifting by" (LANDING §8, revision of 2026-10-24): a volley of puppets flies in from
 * the edges as the visitor scrolls, settles into parallax layers of depth and drifts behind six
 * benefits, one per screen. On each benefit, actors step out of that crowd and act its story.
 * Positions are in viewport units so the same volley fits every screen; phones fly a smaller
 * crowd over fewer layers.
 */

export type DriftEdge = 'left' | 'right' | 'top' | 'bottom';
export type DriftSide = 'left' | 'right';

export interface DriftLayer {
  /** Parallax depth, like the sky's (0 = horizon, 1 = closest). */
  readonly depth: number;
  /** Resting scale of a puppet in this layer. */
  readonly scale: number;
  readonly opacity: number;
  /** Resting blur, px (haze); phones skip blur. */
  readonly blur: number;
}

/** Far, middle and near layers on desktop; phones fold the middle into the near one. */
export const DRIFT_LAYERS: readonly DriftLayer[] = [
  { depth: 0.25, scale: 0.6, opacity: 0.5, blur: 2.4 },
  { depth: 0.55, scale: 0.85, opacity: 0.8, blur: 0.8 },
  { depth: 0.9, scale: 1.05, opacity: 1, blur: 0 },
];
export const DRIFT_PHONE_LAYERS: readonly DriftLayer[] = [
  { depth: 0.25, scale: 0.6, opacity: 0.55, blur: 0 },
  { depth: 0.7, scale: 0.8, opacity: 0.95, blur: 0 },
];
/** Phones write the benefits across the whole width: the settled crowd recedes to this opacity behind them. */
export const DRIFT_PHONE_RECEDE = 0.35;
/**
 * While a story plays, the crowd steps back: its opacity loses `opacity`; puppets drifting behind
 * the text lose another `text` so it stays readable. Opacity only: a haze on twelve large puppets
 * cost frames on desktop (L07 recordings, p95 33 ms).
 */
export const DRIFT_CROWD_DIM = { opacity: 0.3, text: 0.6 } as const;

export interface DriftPuppet {
  readonly id: string;
  /**
   * The puppet's own look: one state, or two when it morphs from a pill into an Island in flight
   * (it then rests in the second). Story states are added per scene (desktop or phone).
   */
  readonly states: readonly [PuppetState] | readonly [PuppetState, PuppetState];
  readonly dir?: 'rtl';
  /** Index into DRIFT_LAYERS (phones: 0 stays far, anything else is near). */
  readonly layer: 0 | 1 | 2;
  /** Resting centre, % of the viewport width / height. */
  readonly x: number;
  readonly y: number;
  /** Resting rotation and launch rotation, degrees. */
  readonly tilt: number;
  readonly spin: number;
  readonly from: DriftEdge;
  /** Launch delay and flight time, seconds of the volley. */
  readonly delay: number;
  readonly duration: number;
  /** Also flies on phones (with its own centre there). */
  readonly phone?: { readonly x: number; readonly y: number };
}

const pill = (face: PuppetFace, count = 1): PuppetState => ({ face, mode: 'pill', count });
const island = (face: PuppetFace, extra: Partial<PuppetState> = {}): PuppetState => ({ face, mode: 'island', ...extra });

/* Own faces of the crowd, cast for their parts (LANDING §8: the story starts from the actor's own face). */
/** Side of the text on each benefit, in order; actors play on the other half (LANDING §8, owner, L07 review). */
export const BENEFIT_TEXT_SIDES: readonly DriftSide[] = ['left', 'right', 'left', 'right', 'left', 'right'];
const READY: PuppetFace = { id: 'ready', kind: 'info', title: '12 photos ready to upload', description: 'Holiday album · 48 MB', action: 'Upload' };
const SYNCED: PuppetFace = { id: 'synced', kind: 'success', title: 'Synced to the cloud' };
const INVITE: PuppetFace = { id: 'invite', kind: 'info', title: 'Ana shared “Skyline”', description: '3 photos from the trip.', action: 'Open' };
const SAVED: PuppetFace = { id: 'saved', kind: 'success', title: 'Saved', description: 'Holiday album · 48 MB' };
const FORECAST: PuppetFace = { id: 'forecast', kind: 'info', title: 'Forecast: clear skies', description: 'No storms for the next 7 days.' };
const SYNCING: PuppetFace = { id: 'syncing', kind: 'loading', title: 'Syncing 3 files…', cancel: 'Cancel' };
const UNREACHABLE: PuppetFace = { id: 'unreachable', kind: 'error', title: "Couldn't reach the sky", description: 'Attempt 1 of 3.', retry: true };
const BACKED_UP: PuppetFace = { id: 'backed-up', kind: 'success', title: 'Backed up 214 photos' };
const STORM: PuppetFace = {
  id: 'storm',
  kind: 'warning',
  title: 'Storm ahead: storage almost full',
  description: 'Only 3% of your sky is left.',
  action: 'Upgrade',
};
const DRIFTED: PuppetFace = { id: 'drifted', kind: 'error', title: 'Upload drifted off', description: 'Lost the signal above the clouds.', retry: true };
/* RTL (decorative, aria-hidden): Arabic "Synced to the cloud" and "214 photos backed up". */
const SYNCED_AR: PuppetFace = { id: 'synced-ar', kind: 'success', title: 'تمت المزامنة مع السحابة' };
const BACKED_AR: PuppetFace = { id: 'backed-ar', kind: 'info', title: 'تم نسخ 214 صورة احتياطيًا' };
const THEMED: PuppetFace = { id: 'themed', kind: 'info', title: 'A fresh coat of sky', description: 'Tokens and classNames, no forks.', action: 'Apply' };

/**
 * 12 puppets on desktop, 6 of them on phones (LANDING §8). Paint order: far to near. The text
 * alternates sides and the actors play on the other half (benefits 1, 3, 5 on the right, 2, 4, 6
 * on the left), so each benefit's cast rests on its stage's half. All follow the page theme (owner, L07).
 */
export const DRIFT_PUPPETS: readonly DriftPuppet[] = [
  // Far: small, pale, hazy; only these cross towards the centre column.
  { id: 'synced', states: [pill(SYNCED)], layer: 0, x: 66, y: 74, tilt: 3, spin: 22, from: 'bottom', delay: 0.42, duration: 1.6 },
  { id: 'backed-up', states: [pill(BACKED_UP)], layer: 0, x: 32, y: 44, tilt: -3, spin: -28, from: 'top', delay: 0.18, duration: 1.7 },
  { id: 'forecast', states: [pill(FORECAST)], layer: 0, x: 34, y: 10, tilt: -2, spin: -34, from: 'left', delay: 0.3, duration: 1.5 },
  { id: 'themed', states: [pill(THEMED), island(THEMED)], layer: 0, x: 42, y: 84, tilt: 2, spin: -18, from: 'bottom', delay: 0.32, duration: 1.55, phone: { x: 70, y: 86 } },
  // Middle: off the centre column.
  { id: 'ready', states: [pill(READY)], layer: 1, x: 82, y: 28, tilt: 4, spin: 40, from: 'right', delay: 0.12, duration: 1.5, phone: { x: 24, y: 12 } },
  { id: 'saved', states: [pill(SAVED)], layer: 1, x: 16, y: 64, tilt: 3, spin: -26, from: 'left', delay: 0.06, duration: 1.4 },
  { id: 'storm', states: [pill(STORM)], layer: 1, x: 22, y: 88, tilt: 4, spin: 30, from: 'bottom', delay: 0.24, duration: 1.45, phone: { x: 30, y: 90 } },
  { id: 'unreachable', states: [pill(UNREACHABLE), island(UNREACHABLE)], layer: 1, x: 80, y: 62, tilt: 4, spin: 38, from: 'right', delay: 0.36, duration: 1.5 },
  // Near: crisp, kept to the sides.
  { id: 'invite', states: [pill(INVITE)], layer: 2, x: 10, y: 18, tilt: -4, spin: -30, from: 'top', delay: 0.26, duration: 1.3, phone: { x: 76, y: 8 } },
  { id: 'synced-ar', states: [pill(SYNCED_AR, 2)], dir: 'rtl', layer: 2, x: 90, y: 12, tilt: 6, spin: 44, from: 'right', delay: 0, duration: 1.2 },
  { id: 'drifted', states: [pill(DRIFTED)], layer: 2, x: 92, y: 42, tilt: 6, spin: 42, from: 'right', delay: 0.1, duration: 1.25, phone: { x: 12, y: 64 } },
  { id: 'syncing', states: [pill(SYNCING), island(SYNCING)], layer: 2, x: 88, y: 84, tilt: -5, spin: 34, from: 'right', delay: 0.2, duration: 1.3, phone: { x: 82, y: 44 } },
];

/** Index of the state a crowd puppet rests in once the volley has settled. */
export const restState = (puppet: DriftPuppet) => puppet.states.length - 1;
/** The half of the screen a crowd puppet rests in. */
export const sideOf = (puppet: DriftPuppet, phone = false): DriftSide => ((phone && puppet.phone ? puppet.phone.x : puppet.x) < 50 ? 'left' : 'right');

export interface DriftCloud {
  readonly shape: 1 | 3 | 4 | 5 | 6;
  readonly x: number;
  readonly y: number;
  /** Width, % of the viewport width. */
  readonly w: number;
  /** Between the puppet layers, so clouds take part in the depth. */
  readonly depth: number;
  readonly flip?: boolean;
  readonly phone?: boolean;
}

/** Clouds fade in with the volley and drift vertically only (no horizontal cloud motion). */
export const DRIFT_CLOUDS: readonly DriftCloud[] = [
  { shape: 4, x: 32, y: 48, w: 30, depth: 0.4 },
  { shape: 5, x: 70, y: 70, w: 18, depth: 0.75, flip: true, phone: true },
  { shape: 3, x: -4, y: 4, w: 24, depth: 0.4, phone: true },
];

/** Parallax: pixels a layer rises per scrolled pixel at depth 1 (the sky's RATE). */
export const DRIFT_RATE = 0.3;

/**
 * The volley is scrubbed: it starts when the top of the pin reaches this line of the viewport
 * (right before "Drifting by" appears) and settles by the middle of the title's plateau.
 * Scrolling back plays it backwards.
 */
export const DRIFT_VOLLEY_START = '20%';

export interface Benefit {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

/** The six benefits (LANDING §8), one per screen, after the scene title. Draft copy for the owner's review. */
export const BENEFITS: readonly Benefit[] = [
  { id: 'springs', title: 'Springs, not keyframes', text: 'Every motion rides a spring. Interrupt it anywhere and it carries on from its current speed.' },
  { id: 'island', title: 'Stack → Island', text: 'One shell that stacks, opens and slides. Swipe it, flick it on a trackpad, or use the arrow keys.' },
  { id: 'promises', title: 'Promises built in', text: 'track() shows loading, retries attempt by attempt and cancels for real. Your promise stays yours.' },
  { id: 'attention', title: 'Speaks up when it matters', text: 'attention opens what is important on its own, and never steals focus.' },
  { id: 'a11y', title: 'Accessible by default', text: 'Native controls, calm announcements, full keyboard, reduced motion and RTL.' },
  { id: 'stack', title: 'Fits your stack', text: `A shadcn registry item, tokens and classNames, SSR and Next.js, strict CSP. ${formatKB(PACKAGE_SIZE.start)} of JavaScript on first load.` },
];

/* ---------- Stories (LANDING §8.5): one per benefit, acted by puppets of the crowd ---------- */

export type DriftKey = 'Tab' | 'Esc' | '→' | '←';
export type DriftProp = 'field' | 'announce';

/**
 * One beat of a story; beats play one after another (one motion at a time) and each is followed
 * by a rest of `hold` seconds where nothing moves.
 * - `come`: the actor leaves the crowd for its place beside the text;
 * - `state`: the actor's puppet moves to a state (`via`: heads for another one first and is
 *   retargeted `at` seconds in, keeping its speed — an interruption);
 * - `merge`: the actor flies onto `into` and becomes its newest notification (`into` takes `state`;
 *   with `via`, the landing interrupts `into` mid-transition);
 * - `split`: the actor leaves `from`'s stack again (`from` takes `state`);
 * - `go`: actors return to their places in the crowd, in their own looks (merged-away ones come
 *   back from below the screen);
 * - `prop`: shows or hides a prop beside the stage.
 */
export type StoryBeat = { readonly hold?: number; readonly key?: DriftKey } & (
  | { readonly kind: 'come'; readonly actor: string }
  | { readonly kind: 'state'; readonly actor: string; readonly state: PuppetState; readonly via?: PuppetState; readonly at?: number }
  | { readonly kind: 'merge'; readonly actor: string; readonly into: string; readonly state: PuppetState; readonly via?: PuppetState; readonly at?: number }
  | { readonly kind: 'split'; readonly actor: string; readonly from: string; readonly state: PuppetState }
  | { readonly kind: 'go'; readonly actors: readonly string[] }
  | { readonly kind: 'prop'; readonly prop: DriftProp; readonly show: boolean }
);

export interface Story {
  /** BENEFITS id. */
  readonly benefit: string;
  readonly beats: readonly StoryBeat[];
}

/* Story-only faces: the same notifications later in their lives. */
const SYNC_CANCELLED: PuppetFace = { id: 'sync-cancelled', kind: 'warning', title: 'Sync cancelled', description: 'Nothing was uploaded.', retry: true };
const RECONNECT_2: PuppetFace = { id: 'reconnect-2', kind: 'loading', title: 'Reconnecting…', description: 'Attempt 2 of 3.' };
const STILL_OFF: PuppetFace = { id: 'still-off', kind: 'error', title: 'Still no signal', description: 'Attempt 2 of 3.', retry: true };
const RECONNECT_3: PuppetFace = { id: 'reconnect-3', kind: 'loading', title: 'Reconnecting…', description: 'Attempt 3 of 3.' };
const BACK: PuppetFace = { id: 'back', kind: 'success', title: 'Back in the sky', description: 'Attempt 3 of 3 got through.' };
const SYNCING_2: PuppetFace = { id: 'syncing-2', kind: 'loading', title: 'Syncing 3 files…', description: 'Attempt 2.', cancel: 'Cancel' };
const SYNCED_3: PuppetFace = { id: 'synced-3', kind: 'success', title: '3 files synced', description: 'Attempt 2 got through.' };

/** Desktop: 2 / 3 / 2 / 2 / 2 / 1 actors, every crowd puppet acts exactly once. */
export const DRIFT_STORIES: readonly Story[] = [
  {
    benefit: 'springs',
    beats: [
      { kind: 'come', actor: 'ready' },
      // Opening is interrupted by a newcomer: the shape carries on from its speed to the taller
      // Island (the current notification stays, a second dot appears — DESIGN §3).
      { kind: 'merge', actor: 'synced', into: 'ready', via: island(READY), at: 0.18, state: island(READY, { count: 2, current: 1 }), hold: 0.7 },
      { kind: 'state', actor: 'ready', state: pill(SYNCED, 2) },
      { kind: 'split', actor: 'synced', from: 'ready', state: pill(READY) },
      { kind: 'go', actors: ['ready', 'synced'] },
    ],
  },
  {
    benefit: 'island',
    beats: [
      { kind: 'come', actor: 'invite' },
      { kind: 'merge', actor: 'saved', into: 'invite', state: pill(SAVED, 2) },
      { kind: 'merge', actor: 'forecast', into: 'invite', state: pill(FORECAST, 3) },
      { kind: 'state', actor: 'invite', state: island(FORECAST, { count: 3 }) },
      { kind: 'state', actor: 'invite', state: island(SAVED, { count: 3, current: 1 }), key: '→' },
      { kind: 'state', actor: 'invite', state: island(INVITE, { count: 3, current: 2 }), key: '→' },
      { kind: 'state', actor: 'invite', state: island(SAVED, { count: 3, current: 1 }), key: '←' },
      { kind: 'state', actor: 'invite', state: island(SAVED, { count: 3, current: 1, highlight: 1, focus: 'close' }), hold: 0.3 },
      // Closing the current one slides to the next older (DESIGN §3); its actor is gone from the stack.
      { kind: 'state', actor: 'invite', state: island(INVITE, { count: 2, current: 1 }) },
      { kind: 'state', actor: 'invite', state: pill(FORECAST, 2) },
      { kind: 'split', actor: 'forecast', from: 'invite', state: pill(INVITE) },
      { kind: 'go', actors: ['invite', 'forecast', 'saved'] },
    ],
  },
  {
    benefit: 'promises',
    beats: [
      { kind: 'come', actor: 'syncing' },
      { kind: 'state', actor: 'syncing', state: island(SYNCING, { highlight: 1 }), hold: 0.3 },
      { kind: 'state', actor: 'syncing', state: island(SYNC_CANCELLED) },
      { kind: 'state', actor: 'syncing', state: pill(SYNC_CANCELLED) },
      { kind: 'go', actors: ['syncing'] },
      { kind: 'come', actor: 'unreachable' },
      { kind: 'state', actor: 'unreachable', state: island(UNREACHABLE, { highlight: 1 }), hold: 0.3 },
      { kind: 'state', actor: 'unreachable', state: island(RECONNECT_2) },
      { kind: 'state', actor: 'unreachable', state: island(STILL_OFF) },
      { kind: 'state', actor: 'unreachable', state: island(STILL_OFF, { highlight: 1 }), hold: 0.3 },
      { kind: 'state', actor: 'unreachable', state: island(RECONNECT_3) },
      { kind: 'state', actor: 'unreachable', state: island(BACK) },
      { kind: 'state', actor: 'unreachable', state: pill(BACK) },
      { kind: 'go', actors: ['unreachable'] },
    ],
  },
  {
    benefit: 'attention',
    beats: [
      { kind: 'prop', prop: 'field', show: true },
      { kind: 'come', actor: 'backed-up' },
      // It lands quietly; attention waits its delay, then opens it — the caret stays in the field.
      { kind: 'merge', actor: 'storm', into: 'backed-up', state: pill(STORM, 2), hold: 0.9 },
      { kind: 'state', actor: 'backed-up', state: island(STORM, { count: 2 }), hold: 0.8 },
      { kind: 'state', actor: 'backed-up', state: pill(STORM, 2) },
      { kind: 'split', actor: 'storm', from: 'backed-up', state: pill(BACKED_UP) },
      { kind: 'go', actors: ['backed-up', 'storm'] },
      { kind: 'prop', prop: 'field', show: false, hold: 0 },
    ],
  },
  {
    benefit: 'a11y',
    beats: [
      // The live region speaks when it arrives, politely (an error is not assertive by default).
      { kind: 'come', actor: 'drifted' },
      { kind: 'prop', prop: 'announce', show: true, hold: 1 },
      { kind: 'prop', prop: 'announce', show: false },
      { kind: 'state', actor: 'drifted', state: island(DRIFTED) },
      { kind: 'state', actor: 'drifted', state: island(DRIFTED, { highlight: 1, focus: 'retry' }), key: 'Tab' },
      { kind: 'state', actor: 'drifted', state: island(DRIFTED, { highlight: 1, focus: 'close' }), key: 'Tab' },
      { kind: 'state', actor: 'drifted', state: pill(DRIFTED), key: 'Esc' },
      { kind: 'go', actors: ['drifted'] },
      { kind: 'come', actor: 'synced-ar' },
      { kind: 'state', actor: 'synced-ar', state: island(SYNCED_AR, { count: 2 }) },
      // RTL: the next notification is towards the inline end, which is on the left.
      { kind: 'state', actor: 'synced-ar', state: island(BACKED_AR, { count: 2, current: 1 }), key: '←' },
      { kind: 'state', actor: 'synced-ar', state: pill(SYNCED_AR, 2) },
      { kind: 'go', actors: ['synced-ar'] },
    ],
  },
  {
    benefit: 'stack',
    beats: [
      { kind: 'come', actor: 'themed' },
      { kind: 'state', actor: 'themed', state: island(THEMED, { look: 'neutral' }), hold: 0.7 },
      { kind: 'state', actor: 'themed', state: island(THEMED, { look: 'brand' }), hold: 0.7 },
      { kind: 'state', actor: 'themed', state: island(THEMED), hold: 0.5 },
      { kind: 'go', actors: ['themed'] },
    ],
  },
];

/** Phones: one actor per benefit, the same stories on a single puppet (arrivals become counts). */
export const DRIFT_PHONE_STORIES: readonly Story[] = [
  {
    benefit: 'springs',
    beats: [
      { kind: 'come', actor: 'ready' },
      { kind: 'state', actor: 'ready', via: island(READY), at: 0.18, state: island(READY, { count: 2, current: 1 }), hold: 0.7 },
      { kind: 'state', actor: 'ready', state: pill(SYNCED, 2) },
      { kind: 'go', actors: ['ready'] },
    ],
  },
  {
    benefit: 'island',
    beats: [
      { kind: 'come', actor: 'invite' },
      { kind: 'state', actor: 'invite', state: pill(SAVED, 2) },
      { kind: 'state', actor: 'invite', state: pill(FORECAST, 3) },
      { kind: 'state', actor: 'invite', state: island(FORECAST, { count: 3 }) },
      { kind: 'state', actor: 'invite', state: island(SAVED, { count: 3, current: 1 }), key: '→' },
      { kind: 'state', actor: 'invite', state: island(INVITE, { count: 3, current: 2 }), key: '→' },
      { kind: 'state', actor: 'invite', state: island(SAVED, { count: 3, current: 1 }), key: '←' },
      { kind: 'state', actor: 'invite', state: island(SAVED, { count: 3, current: 1, highlight: 1, focus: 'close' }), hold: 0.3 },
      { kind: 'state', actor: 'invite', state: island(INVITE, { count: 2, current: 1 }) },
      { kind: 'state', actor: 'invite', state: pill(FORECAST, 2) },
      { kind: 'go', actors: ['invite'] },
    ],
  },
  {
    benefit: 'promises',
    beats: [
      { kind: 'come', actor: 'syncing' },
      { kind: 'state', actor: 'syncing', state: island(SYNCING, { highlight: 1 }), hold: 0.3 },
      { kind: 'state', actor: 'syncing', state: island(SYNC_CANCELLED) },
      { kind: 'state', actor: 'syncing', state: island(SYNC_CANCELLED, { highlight: 1 }), hold: 0.3 },
      { kind: 'state', actor: 'syncing', state: island(SYNCING_2) },
      { kind: 'state', actor: 'syncing', state: island(SYNCED_3) },
      { kind: 'state', actor: 'syncing', state: pill(SYNCED_3) },
      { kind: 'go', actors: ['syncing'] },
    ],
  },
  {
    benefit: 'attention',
    beats: [
      { kind: 'prop', prop: 'field', show: true },
      { kind: 'come', actor: 'storm', hold: 0.9 },
      { kind: 'state', actor: 'storm', state: island(STORM), hold: 0.8 },
      { kind: 'state', actor: 'storm', state: pill(STORM) },
      { kind: 'go', actors: ['storm'] },
      { kind: 'prop', prop: 'field', show: false, hold: 0 },
    ],
  },
  {
    benefit: 'a11y',
    beats: [
      // The live region speaks when it arrives, politely (an error is not assertive by default).
      { kind: 'come', actor: 'drifted' },
      { kind: 'prop', prop: 'announce', show: true, hold: 1 },
      { kind: 'prop', prop: 'announce', show: false },
      { kind: 'state', actor: 'drifted', state: island(DRIFTED) },
      { kind: 'state', actor: 'drifted', state: island(DRIFTED, { highlight: 1, focus: 'retry' }), key: 'Tab' },
      { kind: 'state', actor: 'drifted', state: island(DRIFTED, { highlight: 1, focus: 'close' }), key: 'Tab' },
      { kind: 'state', actor: 'drifted', state: pill(DRIFTED), key: 'Esc' },
      { kind: 'go', actors: ['drifted'] },
    ],
  },
  {
    benefit: 'stack',
    beats: [
      { kind: 'come', actor: 'themed' },
      { kind: 'state', actor: 'themed', state: island(THEMED, { look: 'neutral' }), hold: 0.7 },
      { kind: 'state', actor: 'themed', state: island(THEMED, { look: 'brand' }), hold: 0.7 },
      { kind: 'state', actor: 'themed', state: island(THEMED), hold: 0.5 },
      { kind: 'go', actors: ['themed'] },
    ],
  },
];

/** The caption of the announcement prop (a11y story): what the live region says, politely. */
export const DRIFT_ANNOUNCEMENT = 'Announced politely: “Upload drifted off”';
