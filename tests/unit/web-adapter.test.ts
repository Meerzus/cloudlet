import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudlet } from '../../packages/toast/src/index.js';
import { getRendererBridge } from '../../packages/toast/src/core/bridge.js';
import { createDeferred } from '../support/deferred.js';

afterEach(() => vi.useRealTimers());

describe('public web clock adapter', () => {
  it('provides a native per-attempt AbortSignal without allocating timers or changing a fulfilled result after cancellation', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const controller = createCloudlet();
    const source = createDeferred<string>();
    let signal!: AbortSignal;
    const operation = controller.track((context) => {
      signal = context.signal;
      return source.promise;
    }, { pending: { title: 'Saving' }, success: { title: 'Saved' }, error: { title: 'Failed' } });
    expect(signal).toBeInstanceOf(AbortSignal);
    const abort = vi.fn();
    signal.addEventListener('abort', abort, { once: true });
    expect(operation.cancel('requested')).toEqual({ status: 'requested' });
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe('requested');
    expect(abort).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    source.resolve('saved despite abort');
    await expect(operation.result).resolves.toBe('saved despite abort');
    expect(operation.getSnapshot()).toMatchObject({ status: 'fulfilled', cancelRequested: true });
    expect(vi.getTimerCount()).toBe(0);
    controller.dispose();
  });

  it('allocates no timers until attached content is acknowledged, then expires at its deadline', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const controller = createCloudlet();
    const admitted = controller.show({ title: 'Saved', kind: 'success' });
    expect(admitted.status).toBe('created');
    expect(vi.getTimerCount()).toBe(0);
    const bridge = getRendererBridge(controller);
    const attached = bridge.attach();
    if (attached.status !== 'attached' || admitted.status !== 'created') throw new Error('Setup failed');
    const presentation = bridge.getSnapshot().presentation?.token;
    if (!presentation) throw new Error('Presentation token missing');
    expect(vi.getTimerCount()).toBe(0);
    bridge.acknowledgePresentation(attached.lease, admitted.handle, presentation);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(5999);
    expect(controller.getSnapshot().notifications).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot().notifications).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    controller.dispose();
  });

  it('preserves deadlines exceeding the browser timeout range and cancels the current timer on dispose', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const controller = createCloudlet();
    const bridge = getRendererBridge(controller);
    const admitted = controller.show({ title: 'Long task', duration: 2_147_484_647 });
    const attached = bridge.attach();
    if (attached.status !== 'attached' || admitted.status !== 'created') throw new Error('Setup failed');
    const presentation = bridge.getSnapshot().presentation?.token;
    if (!presentation) throw new Error('Presentation token missing');
    bridge.acknowledgePresentation(attached.lease, admitted.handle, presentation);
    vi.advanceTimersByTime(2_147_483_647);
    expect(controller.getHandle(admitted.handle.id)).toBe(admitted.handle);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(999);
    expect(controller.getSnapshot().notifications).toHaveLength(1);
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot().notifications).toHaveLength(0);
  });
});
