import { describe, expect, it } from 'vitest';
import {
  FRAME_CHANNEL,
  WHEEL_LIMIT,
  createFrameLink,
  frameUrl,
  isTrustedMessage,
  parseDevice,
  parseFrameMessage,
  parseParentMessage,
  parseTheme,
} from '../../apps/site/src/lib/frame-protocol';
import { springEasing } from '../../apps/site/src/lib/spring';

const ORIGIN = 'https://cloudlet.dev';

function fakeWindow() {
  const sent: [unknown, string][] = [];
  return { sent, postMessage: (data: unknown, origin: string) => sent.push([data, origin]) } as unknown as Window & {
    sent: [unknown, string][];
  };
}

describe('site frame protocol', () => {
  it('parses every parent message and rejects malformed ones', () => {
    const tag = { channel: FRAME_CHANNEL };
    expect(parseParentMessage({ ...tag, type: 'play-intro' })).toEqual({ type: 'play-intro' });
    expect(parseParentMessage({ ...tag, type: 'stop-intro' })).toEqual({ type: 'stop-intro' });
    expect(parseParentMessage({ ...tag, type: 'reset' })).toEqual({ type: 'reset' });
    expect(parseParentMessage({ ...tag, type: 'set-theme', theme: 'dark' })).toEqual({ type: 'set-theme', theme: 'dark' });

    expect(parseParentMessage({ type: 'play-intro' })).toBeNull();
    expect(parseParentMessage({ channel: 'other', type: 'reset' })).toBeNull();
    expect(parseParentMessage({ ...tag, type: 'fire', chip: 'burst' })).toBeNull();
    expect(parseParentMessage({ ...tag, type: 'set-theme', theme: 'system' })).toBeNull();
    expect(parseParentMessage({ ...tag, type: 'ready' })).toBeNull();
    expect(parseParentMessage('play-intro')).toBeNull();
    expect(parseParentMessage(null)).toBeNull();
  });

  it('parses frame replies', () => {
    const tag = { channel: FRAME_CHANNEL };
    expect(parseFrameMessage({ ...tag, type: 'ready' })).toEqual({ type: 'ready' });
    expect(parseFrameMessage({ ...tag, type: 'intro-done', reason: 'complete' })).toEqual({
      type: 'intro-done',
      reason: 'complete',
    });
    expect(parseFrameMessage({ ...tag, type: 'intro-done', reason: 'interrupted' })).toEqual({
      type: 'intro-done',
      reason: 'interrupted',
    });
    expect(parseFrameMessage({ ...tag, type: 'intro-done' })).toBeNull();
    expect(parseFrameMessage({ ...tag, type: 'wheel', deltaX: 0, deltaY: 120, deltaMode: 0 })).toEqual({
      type: 'wheel',
      deltaX: 0,
      deltaY: 120,
      deltaMode: 0,
    });
    expect(parseFrameMessage({ ...tag, type: 'wheel', deltaX: 0, deltaY: 1e9, deltaMode: 1 })).toMatchObject({
      deltaY: WHEEL_LIMIT,
    });
    expect(parseFrameMessage({ ...tag, type: 'wheel', deltaX: 0, deltaY: Number.NaN, deltaMode: 0 })).toBeNull();
    expect(parseFrameMessage({ ...tag, type: 'wheel', deltaX: 0, deltaY: '120', deltaMode: 0 })).toBeNull();
    expect(parseFrameMessage({ ...tag, type: 'wheel', deltaX: 0, deltaY: 120, deltaMode: 3 })).toBeNull();
    expect(parseFrameMessage({ ...tag, type: 'play-intro' })).toBeNull();
  });

  it('accepts messages only from the expected origin and window', () => {
    const frame = fakeWindow();
    const stranger = fakeWindow();
    const event = (origin: string, source: unknown) => ({ origin, source }) as MessageEvent;
    expect(isTrustedMessage(event(ORIGIN, frame), frame, ORIGIN)).toBe(true);
    expect(isTrustedMessage(event('https://evil.example', frame), frame, ORIGIN)).toBe(false);
    expect(isTrustedMessage(event(ORIGIN, stranger), frame, ORIGIN)).toBe(false);
    expect(isTrustedMessage(event(ORIGIN, null), null, ORIGIN)).toBe(false);
  });

  it('buffers messages until the frame is ready, then flushes them in order to our origin only', () => {
    const link = createFrameLink(ORIGIN);
    link.send({ type: 'set-theme', theme: 'dark' });
    link.send({ type: 'play-intro' });
    expect(link.connected).toBe(false);

    const frame = fakeWindow();
    link.connect(frame);
    link.send({ type: 'stop-intro' });
    expect(frame.sent).toEqual([
      [{ type: 'set-theme', theme: 'dark', channel: FRAME_CHANNEL }, ORIGIN],
      [{ type: 'play-intro', channel: FRAME_CHANNEL }, ORIGIN],
      [{ type: 'stop-intro', channel: FRAME_CHANNEL }, ORIGIN],
    ]);
  });

  it('drops queued messages on reset and resumes buffering after a disconnect', () => {
    const link = createFrameLink(ORIGIN);
    link.send({ type: 'play-intro' });
    link.send({ type: 'reset' });
    link.send({ type: 'play-intro' });
    const frame = fakeWindow();
    link.connect(frame);
    expect(frame.sent.map(([data]) => (data as { type: string }).type)).toEqual(['reset', 'play-intro']);

    link.disconnect();
    link.send({ type: 'stop-intro' });
    expect(frame.sent).toHaveLength(2);
    const reloaded = fakeWindow();
    link.connect(reloaded);
    expect(reloaded.sent.map(([data]) => (data as { type: string }).type)).toEqual(['stop-intro']);
  });

  it('normalizes URL parameters', () => {
    for (const device of ['laptop', 'phone', 'foldable', 'tablet'] as const) expect(parseDevice(device)).toBe(device);
    expect(parseDevice('mobile')).toBe('laptop');
    expect(parseDevice(null)).toBe('laptop');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme(null)).toBe('light');
    expect(frameUrl('foldable', 'dark')).toBe('/toaster/frame?device=foldable&theme=dark');
  });
});

describe('site spring easing', () => {
  it('starts at 0, ends at 1 and settles in a plausible time', () => {
    const { easing, duration } = springEasing({ stiffness: 170, damping: 20 });
    const stops = easing.slice('linear('.length, -1).split(', ').map(Number);
    expect(stops[0]).toBe(0);
    expect(stops.at(-1)).toBe(1);
    expect(Math.max(...stops)).toBeGreaterThan(1);
    expect(Math.max(...stops)).toBeLessThan(1.05);
    expect(duration).toBeGreaterThan(400);
    expect(duration).toBeLessThan(1200);
  });

  it('does not overshoot when overdamped', () => {
    const { easing } = springEasing({ stiffness: 100, damping: 40 });
    const stops = easing.slice('linear('.length, -1).split(', ').map(Number);
    expect(Math.max(...stops)).toBeLessThanOrEqual(1);
  });
});
