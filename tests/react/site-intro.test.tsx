import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudletProvider, Toaster, createCloudlet, type ReactCloudletController } from '../../packages/toast/src/index.js';
import { INTRO_TIMING, playIntro } from '../../apps/site/src/lib/intro';

const controllers: ReactCloudletController[] = [];
const host = () => document.querySelector('.cloudlet-host');
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

function mount() {
  const instance = createCloudlet();
  controllers.push(instance);
  render(
    <CloudletProvider controller={instance}>
      <Toaster />
    </CloudletProvider>,
  );
  return instance;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  controllers.splice(0).forEach((instance) => instance.dispose());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('site hero intro', () => {
  it('lands three toasts, opens the Island, slides once and collapses — through public paths only', async () => {
    const instance = mount();
    const run = playIntro(instance, host);
    const t = INTRO_TIMING;

    await advance(t.lead + 2 * t.arrivalGap + 1);
    let snapshot = instance.getSnapshot();
    expect(snapshot.stack).toHaveLength(3);
    expect(snapshot.notifications.map((item) => item.content.title)).toEqual([
      'Synced to the cloud',
      'Uploading 12 photos…',
      'Storm ahead: storage almost full',
    ]);
    expect(snapshot.island.open).toBe(false);

    await advance(t.stackPause);
    snapshot = instance.getSnapshot();
    expect(snapshot.island).toMatchObject({ open: true, reason: 'user', current: snapshot.stack[0] });

    await advance(t.islandHold);
    snapshot = instance.getSnapshot();
    expect(snapshot.island.current).toBe(snapshot.stack[1]);

    await advance(t.slideHold);
    expect(instance.getSnapshot().island.open).toBe(false);

    await advance(t.settle);
    await expect(run.done).resolves.toBe('complete');
    expect(instance.getSnapshot().stack).toHaveLength(3);
  });

  it('stops where it is when interrupted; the upload keeps going', async () => {
    const instance = mount();
    const run = playIntro(instance, host);
    const t = INTRO_TIMING;

    await advance(t.lead + t.arrivalGap + 1);
    run.stop();
    await expect(run.done).resolves.toBe('interrupted');
    // Ten progress ticks later the upload lands as success; no third toast, no Island.
    await advance(10 * t.uploadTick + 1);
    const snapshot = instance.getSnapshot();
    expect(snapshot.island.open).toBe(false);
    expect(snapshot.notifications.map((item) => item.content.title)).toEqual([
      'Synced to the cloud',
      '12 photos are in the cloud',
    ]);
  });

  it('cancel also cancels the demo upload', async () => {
    const instance = mount();
    const run = playIntro(instance, host);
    await advance(INTRO_TIMING.lead + INTRO_TIMING.arrivalGap + 1);
    run.cancel();
    await advance(INTRO_TIMING.uploadTick + 1);
    const titles = instance.getSnapshot().notifications.map((item) => item.content.title);
    expect(titles).not.toContain('12 photos are in the cloud');
    expect(titles).toContain('Upload cancelled');
  });
});
