/**
 * Typed postMessage protocol between the hero (parent) and the `/toaster/frame` screen.
 * Both sides are the same site, so every message must come from our
 * own origin and from the expected window; anything else is ignored.
 */

import { DEVICE_IDS, type DeviceId } from './devices';
import { TOASTER_PATH } from './site';

export type FrameTheme = 'light' | 'dark';

export const FRAME_PATH = `${TOASTER_PATH}/frame`;
/** Tags our messages so unrelated postMessage traffic (extensions, devtools) is ignored. */
export const FRAME_CHANNEL = 'cloudlet-frame';

export type ParentMessage =
  | { readonly type: 'play-intro' }
  /** Ends a running intro where it is (any input in the hero outside the frame). */
  | { readonly type: 'stop-intro' }
  | { readonly type: 'set-theme'; readonly theme: FrameTheme }
  /** Stops the intro and clears every notification. */
  | { readonly type: 'reset' };

export type IntroEnd = 'complete' | 'interrupted';

export type FrameMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'intro-done'; readonly reason: IntroEnd }
  /** A vertical wheel over the screen: the page scrolls instead of the frame swallowing it. */
  | { readonly type: 'wheel'; readonly deltaX: number; readonly deltaY: number; readonly deltaMode: WheelMode };

/** `WheelEvent.deltaMode`: pixels, lines or pages. */
export type WheelMode = 0 | 1 | 2;
/** Larger deltas are clamped: one forwarded event never jumps further than a page or so. */
export const WHEEL_LIMIT = 2000;

type Envelope<T> = T & { readonly channel: typeof FRAME_CHANNEL };

export function parseDevice(value: unknown): DeviceId {
  return DEVICE_IDS.find((device) => device === value) ?? 'laptop';
}

export function parseTheme(value: unknown): FrameTheme {
  return value === 'dark' ? 'dark' : 'light';
}

export function frameUrl(device: DeviceId, theme: FrameTheme) {
  return `${FRAME_PATH}?device=${device}&theme=${theme}`;
}

function record(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'object' || data === null) return null;
  const value = data as Record<string, unknown>;
  return value['channel'] === FRAME_CHANNEL && typeof value['type'] === 'string' ? value : null;
}

export function parseParentMessage(data: unknown): ParentMessage | null {
  const value = record(data);
  switch (value?.['type']) {
    case 'play-intro':
    case 'stop-intro':
    case 'reset':
      return { type: value['type'] };
    case 'set-theme':
      return value['theme'] === 'light' || value['theme'] === 'dark' ? { type: 'set-theme', theme: value['theme'] } : null;
    default:
      return null;
  }
}

export function parseFrameMessage(data: unknown): FrameMessage | null {
  const value = record(data);
  switch (value?.['type']) {
    case 'ready':
      return { type: 'ready' };
    case 'intro-done':
      return value['reason'] === 'complete' || value['reason'] === 'interrupted'
        ? { type: 'intro-done', reason: value['reason'] }
        : null;
    case 'wheel': {
      const { deltaX, deltaY, deltaMode } = value;
      if (typeof deltaX !== 'number' || typeof deltaY !== 'number' || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
        return null;
      }
      if (deltaMode !== 0 && deltaMode !== 1 && deltaMode !== 2) return null;
      const clamp = (delta: number) => Math.max(-WHEEL_LIMIT, Math.min(WHEEL_LIMIT, delta));
      return { type: 'wheel', deltaX: clamp(deltaX), deltaY: clamp(deltaY), deltaMode };
    }
    default:
      return null;
  }
}

/** Accepts an event only from our own origin and the expected window. */
export function isTrustedMessage(event: MessageEvent, expectedSource: MessageEventSource | null, origin: string) {
  return expectedSource !== null && event.origin === origin && event.source === expectedSource;
}

export function postToFrame(target: Window, message: ParentMessage, origin: string) {
  target.postMessage({ ...message, channel: FRAME_CHANNEL } satisfies Envelope<ParentMessage>, origin);
}

export function postToParent(target: Window, message: FrameMessage, origin: string) {
  target.postMessage({ ...message, channel: FRAME_CHANNEL } satisfies Envelope<FrameMessage>, origin);
}

/**
 * Parent-side link to one iframe: messages sent before the frame reports `ready`
 * are buffered and flushed in order; `reset` drops whatever is still queued.
 */
export function createFrameLink(origin: string) {
  let target: Window | null = null;
  let queue: ParentMessage[] = [];
  return {
    send(message: ParentMessage) {
      if (target) postToFrame(target, message, origin);
      else if (message.type === 'reset') queue = [message];
      else queue.push(message);
    },
    /** Called on `ready` (also after the frame reloads): flushes the buffer. */
    connect(window: Window) {
      target = window;
      const pending = queue;
      queue = [];
      for (const message of pending) postToFrame(window, message, origin);
    },
    disconnect() {
      target = null;
    },
    get connected() {
      return target !== null;
    },
  };
}
