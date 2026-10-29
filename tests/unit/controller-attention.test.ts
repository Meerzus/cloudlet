import { describe, expect, it, vi } from 'vitest';
import type { NotificationSpec } from '../../packages/toast/src/contracts/notifications.js';
import { getRendererBridge } from '../../packages/toast/src/core/bridge.js';
import { createCloudletCore } from '../../packages/toast/src/core/controller.js';
import { admit, attach, createCancellation, harness, record, RetainedCallbackClock } from '../support/controller-harness.js';

const action = { kind: 'command' as const, label: 'Undo', run: vi.fn() };
const description = { kind: 'text' as const, text: 'Details' };
const spec = (id: string, extra: Partial<NotificationSpec<unknown>> = {}): NotificationSpec<unknown> =>
  ({ id, title: id, duration: null, ...extra });

describe('attention automaton', () => {
  it('opens the Island on the initiator exactly 600 ms after admission without requesting focus', () => {
    const { controller, bridge, clock } = harness();
    attach(bridge);
    admit(controller, spec('older'));
    const initiator = admit(controller, spec('initiator', { action }));
    admit(controller, spec('newer', { attention: 'stack' }));
    clock.advanceBy(599);
    expect(controller.getSnapshot().island.open).toBe(false);
    clock.advanceBy(1);
    expect(controller.getSnapshot().island).toEqual({ open: true, reason: 'attention', current: initiator });
    expect(bridge.getSnapshot().focusRequest).toBeNull();
    expect(clock.pendingCount).toBe(0);
  });

  it.each<[string, Partial<NotificationSpec<unknown>>, boolean]>([
    ['auto with an action', { action }, true],
    ['auto with a link action', { action: { kind: 'link', label: 'Open', href: '/report' } }, true],
    ['auto with a description', { description }, true],
    ['auto without action or description', {}, false],
    ['open without a description', { attention: 'open' }, true],
    ['stack with an action and a description', { attention: 'stack', action, description }, false],
  ])('applies the rule for %s', (_label, extra, opens) => {
    const { controller, bridge, clock } = harness();
    attach(bridge);
    const handle = admit(controller, spec('candidate', extra));
    clock.advanceBy(10_000);
    expect(controller.getSnapshot().island).toEqual(opens
      ? { open: true, reason: 'attention', current: handle } : { open: false, reason: null, current: null });
  });

  it.each(['hover', 'focus'] as const)('waits for host %s to end, then restarts the delay', (reason) => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const handle = admit(controller, spec('candidate', { action }));
    bridge.setPause(lease, { scope: 'host', reason, active: true });
    clock.advanceBy(5_000);
    expect(controller.getSnapshot().island.open).toBe(false);
    expect(clock.pendingCount).toBe(0);
    bridge.setPause(lease, { scope: 'host', reason, active: false });
    clock.advanceBy(599);
    expect(controller.getSnapshot().island.open).toBe(false);
    clock.advanceBy(1);
    expect(controller.getSnapshot().island.current).toBe(handle);
  });

  it('waits for a gesture or Island navigation on the current record', () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const viewed = admit(controller, spec('viewed', { attention: 'stack' }));
    bridge.openIsland(lease, 'user', viewed);
    const initiator = admit(controller, spec('initiator', { description }));
    bridge.setPause(lease, { scope: 'notification', handle: viewed, reason: 'gesture', active: true });
    clock.advanceBy(1_000);
    expect(controller.getSnapshot().island.current).toBe(viewed);
    bridge.setPause(lease, { scope: 'notification', handle: viewed, reason: 'gesture', active: false });
    clock.advanceBy(600);
    expect(controller.getSnapshot().island).toEqual({ open: true, reason: 'user', current: initiator });
  });

  it('restarts the delay on Island navigation and drops the candidate reached by hand', () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const first = admit(controller, spec('first', { attention: 'stack' }));
    const second = admit(controller, spec('second', { attention: 'stack' }));
    bridge.openIsland(lease, 'user', second);
    const initiator = admit(controller, spec('initiator', { description }));
    clock.advanceBy(500);
    bridge.navigate(lease, first);
    clock.advanceBy(500);
    expect(controller.getSnapshot().island.current).toBe(first);
    bridge.navigate(lease, second);
    clock.advanceBy(599);
    expect(controller.getSnapshot().island.current).toBe(second);
    clock.advanceBy(1);
    expect(controller.getSnapshot().island).toEqual({ open: true, reason: 'user', current: initiator });
    const later = admit(controller, spec('later', { action }));
    bridge.navigate(lease, later);
    bridge.navigate(lease, first);
    clock.advanceBy(10_000);
    expect(controller.getSnapshot().island.current).toBe(first);
    expect(clock.pendingCount).toBe(0);
  });

  it('ignores interaction that ends before the delay expires', () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const handle = admit(controller, spec('candidate', { action }));
    bridge.setPause(lease, { scope: 'host', reason: 'hover', active: true });
    clock.advanceBy(300);
    bridge.setPause(lease, { scope: 'host', reason: 'hover', active: false });
    clock.advanceBy(300);
    expect(controller.getSnapshot().island.current).toBe(handle);
  });

  it('lets the newest candidate win and cancels the older one', () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const older = admit(controller, spec('older', { action }));
    clock.advanceBy(300);
    const newer = admit(controller, spec('newer', { action }));
    clock.advanceBy(300);
    expect(controller.getSnapshot().island.open).toBe(false);
    clock.advanceBy(300);
    expect(controller.getSnapshot().island.current).toBe(newer);
    bridge.collapseIsland(lease);
    clock.advanceBy(10_000);
    expect(controller.getSnapshot().island.open).toBe(false);
    expect(record(controller, older).location).toBe('stack');
  });

  it.each([
    ['dismiss', (controller: ReturnType<typeof harness>['controller'], handle: Parameters<typeof controller.dismiss>[0]) => { controller.dismiss(handle); }],
    ['clear', (controller: ReturnType<typeof harness>['controller']) => { controller.clear(); }],
    ['dispose', (controller: ReturnType<typeof harness>['controller']) => { controller.dispose(); }],
    ['update to stack', (controller: ReturnType<typeof harness>['controller'], handle: Parameters<typeof controller.dismiss>[0]) => {
      controller.update(handle, { attention: 'stack' });
    }],
  ])('cancels the pending auto-open on %s', (_label, cancel) => {
    const { controller, bridge, clock } = harness();
    attach(bridge);
    admit(controller, spec('other', { attention: 'stack' }));
    const handle = admit(controller, spec('candidate', { action }));
    clock.advanceBy(300);
    cancel(controller, handle);
    clock.advanceBy(10_000);
    expect(controller.getSnapshot().island.open).toBe(false);
    expect(clock.pendingCount).toBe(0);
  });

  it('moves an open Island to the initiator and keeps the user reason', () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const viewed = admit(controller, spec('viewed', { attention: 'stack' }));
    bridge.openIsland(lease, 'user');
    const initiator = admit(controller, spec('initiator', { attention: 'open' }));
    expect(controller.getSnapshot().island.current).toBe(viewed);
    clock.advanceBy(600);
    expect(controller.getSnapshot().island).toEqual({ open: true, reason: 'user', current: initiator });
  });

  it('waits without a timer until a host attaches, then delays from attachment', () => {
    const { controller, bridge, clock } = harness();
    const handle = admit(controller, spec('candidate', { action }));
    clock.advanceBy(10_000);
    expect(clock.pendingCount).toBe(0);
    expect(controller.getSnapshot().island.open).toBe(false);
    const lease = attach(bridge);
    bridge.detach(lease);
    clock.advanceBy(10_000);
    expect(controller.getSnapshot().island.open).toBe(false);
    attach(bridge);
    clock.advanceBy(599);
    expect(controller.getSnapshot().island.open).toBe(false);
    clock.advanceBy(1);
    expect(controller.getSnapshot().island.current).toBe(handle);
  });

  it('uses ControllerOptions.attentionDelay and a per-host override while attached', () => {
    const { controller, bridge, clock } = harness({ attentionDelay: 1_000 });
    let lease = attach(bridge);
    admit(controller, spec('slow', { action }));
    clock.advanceBy(999);
    expect(controller.getSnapshot().island.open).toBe(false);
    clock.advanceBy(1);
    expect(controller.getSnapshot().island.open).toBe(true);
    bridge.detach(lease);
    controller.clear();
    lease = attach(bridge, { attentionDelay: 0 });
    const instant = admit(controller, spec('instant', { action }));
    expect(controller.getSnapshot().island.open).toBe(false);
    clock.advanceBy(0);
    expect(controller.getSnapshot().island.current).toBe(instant);
    void lease;
  });

  it('validates the delay as controller option and host option', () => {
    expect(() => harness({ attentionDelay: -1 })).toThrow(RangeError);
    expect(() => harness({ attentionDelay: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => harness({ attentionDelay: '600' as unknown as number })).toThrow(TypeError);
    const { bridge } = harness();
    for (const options of [{ attentionDelay: -1 }, { attentionDelay: Number.NaN }, { delay: 600 }, null]) {
      expect(bridge.attach(options as never)).toEqual({ status: 'rejected', reason: 'invalid-input' });
    }
    expect(bridge.attach({ attentionDelay: 250 })).toMatchObject({ status: 'attached' });
  });

  it('nominates an operation when it settles as a retryable failure, not on pending or success', async () => {
    const { controller, bridge, clock } = harness();
    attach(bridge);
    const messages = { pending: { title: 'Saving' }, success: { title: 'Saved' }, error: { title: 'Failed' } };
    const succeeded = controller.track(() => Promise.resolve('ok'), messages);
    await succeeded.result;
    clock.advanceBy(10_000);
    expect(controller.getSnapshot().island.open).toBe(false);
    let reject!: (error: Error) => void;
    const failed = controller.track(() => new Promise<string>((_resolve, fail) => { reject = fail; }), messages);
    clock.advanceBy(10_000);
    expect(controller.getSnapshot().island.open).toBe(false);
    reject(new Error('Offline'));
    await expect(failed.result).rejects.toThrow('Offline');
    clock.advanceBy(600);
    if (failed.admission.status !== 'created') throw new Error('Admission failed');
    expect(controller.getSnapshot().island).toEqual({ open: true, reason: 'attention', current: failed.admission.handle });
  });

  it('ignores a cancelled timer callback delivered late by the platform', () => {
    const clock = new RetainedCallbackClock();
    const controller = createCloudletCore<unknown, AbortSignal>(undefined, { clock, createCancellation });
    const bridge = getRendererBridge(controller);
    const lease = attach(bridge);
    const first = admit(controller, spec('first', { action }));
    const stale = clock.callbacks.at(-1);
    if (!stale) throw new Error('Expected an attention timer');
    bridge.setPause(lease, { scope: 'host', reason: 'hover', active: true });
    clock.manual.advanceBy(600);
    controller.dismiss(first);
    stale();
    for (const callback of [...clock.callbacks]) callback();
    expect(controller.getSnapshot().island.open).toBe(false);
    controller.dispose();
    for (const callback of [...clock.callbacks]) callback();
    expect(clock.manual.pendingCount).toBe(0);
  });
});
