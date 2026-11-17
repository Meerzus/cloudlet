import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMPARE_FIRST_STEP,
  COMPARE_SIDES,
  COMPARE_STEPS,
  PHONE_FOOTPRINT,
  PHONE_GAP,
  STACKED_SHOWN,
  fitPhones,
  playStep,
  type CompareClock,
  type CompareEvent,
  type CompareTarget,
} from '@/lib/compare-scene';
import { FRAME_CHANNEL, parseParentMessage } from '@/lib/frame-protocol';

/** A clock that runs only when told to, so a test sees exactly what each side got and when. */
function manualClock() {
  let now = 0;
  const queue: { at: number; callback: () => void; cancelled: boolean }[] = [];
  const clock: CompareClock = {
    after(ms, callback) {
      const entry = { at: now + ms, callback, cancelled: false };
      queue.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const entry of [...queue].sort((a, b) => a.at - b.at)) {
      if (entry.at > now || entry.cancelled) continue;
      queue.splice(queue.indexOf(entry), 1);
      entry.callback();
    }
  };
  return { clock, advance, now: () => now };
}

function recorder(log: string[], name: string, now: () => number): CompareTarget & { events: CompareEvent[] } {
  const events: CompareEvent[] = [];
  return {
    events,
    apply(event) {
      events.push(event);
      log.push(`${now()} ${name} ${event.type} ${event.id}`);
    },
  };
}

describe("the kit's Toaster scene", () => {
  it('hands every event of a step to both sides, in the same tick and order', () => {
    for (const step of COMPARE_STEPS) {
      const { clock, advance, now } = manualClock();
      const log: string[] = [];
      const plain = recorder(log, 'plain', now);
      const toaster = recorder(log, 'toaster', now);
      playStep(step, 'r1', [plain, toaster], clock);
      advance(10_000);
      expect(plain.events, step.id).toEqual(step.events('r1'));
      expect(toaster.events, step.id).toEqual(plain.events);
      // Each event reaches the plain side and the Toaster one right after the other, at its own time.
      for (let index = 0; index < log.length; index += 2) {
        expect(log[index + 1], step.id).toBe(log[index]!.replace(' plain ', ' toaster '));
      }
    }
  });

  it('cancels the events of a press that have not happened yet', () => {
    const step = COMPARE_STEPS.find((candidate) => candidate.id === 'three')!;
    const { clock, advance, now } = manualClock();
    const plain = recorder([], 'plain', now);
    const cancel = playStep(step, 'r1', [plain], clock);
    advance(0);
    cancel();
    advance(10_000);
    expect(plain.events).toHaveLength(1);
  });

  it('keeps the ids of every press apart and every update or dismiss on a toast it showed', () => {
    for (const step of COMPARE_STEPS) {
      const first = step.events('r1');
      const second = step.events('r2');
      const shown = new Set(first.filter((event) => event.type === 'show').map((event) => event.id));
      for (const event of first) if (event.type !== 'show') expect(shown.has(event.id), step.id).toBe(true);
      for (const event of second) expect(shown.has(event.id), step.id).toBe(false);
      expect(first[0]?.at, step.id).toBe(0);
    }
    expect(COMPARE_STEPS.length).toBeGreaterThanOrEqual(2);
    expect(COMPARE_STEPS.length).toBeLessThanOrEqual(4);
    expect(COMPARE_STEPS.some((step) => step.id === COMPARE_FIRST_STEP)).toBe(true);
  });

  it('sends only messages the frame accepts', () => {
    for (const step of COMPARE_STEPS) {
      for (const event of step.events('r1')) {
        const message =
          event.type === 'dismiss'
            ? { type: 'toast-dismiss', id: event.id }
            : { type: event.type === 'show' ? 'toast-show' : 'toast-update', id: event.id, toast: event.toast };
        expect(parseParentMessage({ ...message, channel: FRAME_CHANNEL }), `${step.id} ${event.type}`).toEqual(message);
      }
    }
  });

  it('names no toast library in its texts', () => {
    const source = readFileSync(new URL('../../apps/site/src/components/kit/toaster-scene.tsx', import.meta.url), 'utf8');
    const texts = [
      source,
      ...Object.values(COMPARE_SIDES).flatMap((side) => [side.label, side.note]),
      ...COMPARE_STEPS.flatMap((step) => [step.label, ...step.events('r').flatMap((event) => (event.type === 'dismiss' ? [] : [event.toast.title]))]),
    ].join('\n');
    for (const name of ['sonner', 'hot-toast', 'react-hot', 'toastify', 'notistack', 'chakra', 'mantine', 'radix', 'material', 'mui']) {
      expect(texts.toLowerCase(), name).not.toContain(name);
    }
  });

  it('fits two phones side by side under the height limit, and one above the other on a phone', () => {
    const side = fitPhones({ width: 700, maxHeight: 640, stacked: false });
    expect(side.shown).toBe(PHONE_FOOTPRINT.height);
    expect(side.scale * PHONE_FOOTPRINT.height).toBeLessThanOrEqual(640 + 1e-9);
    expect(2 * side.scale * PHONE_FOOTPRINT.width + PHONE_GAP).toBeLessThanOrEqual(700 + 1e-9);

    const narrow = fitPhones({ width: 358, maxHeight: 600, stacked: true });
    expect(narrow.shown).toBe(STACKED_SHOWN);
    expect(narrow.scale * PHONE_FOOTPRINT.width).toBeLessThanOrEqual(358 + 1e-9);
    // Both cropped phones fit on a 390 × 844 screen together.
    expect(2 * narrow.scale * narrow.shown).toBeLessThan(844 - 200);

    expect(fitPhones({ width: 0, maxHeight: 0, stacked: false }).scale).toBe(0);
  });
});
