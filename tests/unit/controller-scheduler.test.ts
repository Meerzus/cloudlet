import { describe, expect, it, vi } from 'vitest';
import type { NotificationKind } from '../../packages/toast/src/contracts/notifications.js';
import { getRendererBridge } from '../../packages/toast/src/core/bridge.js';
import { createCloudletCore } from '../../packages/toast/src/core/controller.js';
import { acknowledge, admit, attach, createCancellation, harness, presentation, record, RetainedCallbackClock } from '../support/controller-harness.js';

describe('controller remaining-time scheduler', () => {
  it('allocates no timer before attach or actual presentation and never consumes stacked time', () => {
    const { controller, bridge, clock } = harness();
    expect(clock.pendingCount).toBe(0);
    const queued = admit(controller, 'queued');
    const current = admit(controller, 'current');
    clock.advanceBy(10_000);
    expect(record(controller, current).remainingMs).toBe(6_000);
    expect(clock.pendingCount).toBe(0);
    const lease = attach(bridge);
    clock.advanceBy(10_000);
    expect(record(controller, current).pauseReasons).toContain('presentation-pending');
    expect(clock.pendingCount).toBe(0);
    acknowledge(bridge, lease, current);
    clock.advanceBy(6_000);
    expect(controller.getHandle(current.id)).toBeUndefined();
    expect(record(controller, queued).remainingMs).toBe(6_000);
    expect(clock.pendingCount).toBe(0);
    acknowledge(bridge, lease, queued);
    clock.advanceBy(5_999);
    expect(controller.getHandle(queued.id)).toBe(queued);
    clock.advanceBy(1);
    expect(controller.getSnapshot().notifications).toEqual([]);
  });

  it('keeps overlapping host pause reasons independent and resumes the exact remaining budget', () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const handle = admit(controller, 'paused');
    acknowledge(bridge, lease, handle);
    clock.advanceBy(3_000);
    for (const reason of ['hover', 'focus', 'document-hidden'] as const) {
      expect(bridge.setPause(lease, { scope: 'host', reason, active: true })).toEqual({ status: 'applied' });
    }
    expect(bridge.setPause(lease, { scope: 'host', reason: 'hover', active: true })).toEqual({ status: 'unchanged' });
    expect(record(controller, handle).remainingMs).toBe(3_000);
    expect(clock.pendingCount).toBe(0);
    clock.advanceBy(20_000);
    bridge.setPause(lease, { scope: 'host', reason: 'hover', active: false });
    bridge.setPause(lease, { scope: 'host', reason: 'focus', active: false });
    clock.advanceBy(20_000);
    expect(controller.getHandle(handle.id)).toBe(handle);
    expect(record(controller, handle).pauseReasons).toEqual(['document-hidden']);
    bridge.setPause(lease, { scope: 'host', reason: 'document-hidden', active: false });
    clock.advanceBy(2_999);
    expect(controller.getHandle(handle.id)).toBe(handle);
    clock.advanceBy(1);
    expect(controller.getHandle(handle.id)).toBeUndefined();
  });

  it('clears host-owned item pauses when a newer record takes the top while preserving remaining time', () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const a = admit(controller, 'a');
    acknowledge(bridge, lease, a);
    clock.advanceBy(2_000);
    bridge.setPause(lease, { scope: 'notification', handle: a, reason: 'gesture', active: true });
    bridge.setPause(lease, { scope: 'notification', handle: a, reason: 'content-transition', active: true });
    const b = admit(controller, 'b');
    expect(record(controller, a).pauseReasons).toEqual(['inactive']);
    expect(record(controller, a).remainingMs).toBe(4_000);
    controller.dismiss(b);
    acknowledge(bridge, lease, a);
    clock.advanceBy(4_000);
    expect(controller.getHandle(a.id)).toBeUndefined();
  });

  it.each<NotificationKind>(['info', 'success', 'loading', 'warning', 'error'])('uses the correct default policy for %s', (kind) => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const handle = admit(controller, { title: kind, kind });
    acknowledge(bridge, lease, handle);
    const passive = kind === 'info' || kind === 'success';
    expect(record(controller, handle).remainingMs).toBe(passive ? 6_000 : null);
    clock.advanceBy(6_000);
    expect(controller.getHandle(handle.id)).toBe(passive ? undefined : handle);
  });

  it('keeps actions persistent, honors explicit duration, and disables all automatic budgets when requested', () => {
    const one = harness();
    const lease = attach(one.bridge);
    const action = admit(one.controller, { title: 'Action', action: { kind: 'command', label: 'Run', run: vi.fn() } });
    acknowledge(one.bridge, lease, action);
    expect(record(one.controller, action).remainingMs).toBeNull();
    one.controller.update(action, { duration: 20 });
    one.clock.advanceBy(20);
    expect(one.controller.getHandle(action.id)).toBeUndefined();
    const two = harness({ autoDismiss: false });
    const lease2 = attach(two.bridge);
    const disabled = admit(two.controller, { title: 'No timeout', duration: 1 });
    acknowledge(two.bridge, lease2, disabled);
    expect(record(two.controller, disabled).remainingMs).toBeNull();
    expect(two.clock.pendingCount).toBe(0);
    two.clock.advanceBy(100_000);
    expect(two.controller.getHandle(disabled.id)).toBe(disabled);
  });

  it('lets the host override autoDismiss live: off stops every budget, on restarts each in full, detach restores the option', () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const handle = admit(controller, { title: 'Timed', duration: 1_000 });
    acknowledge(bridge, lease, handle);
    clock.advanceBy(600);
    // The effective policy is unchanged: the running budget keeps its elapsed time.
    expect(bridge.setAutoDismiss(lease, true)).toEqual({ status: 'unchanged' });
    expect(clock.pendingCount).toBe(1);
    expect(bridge.setAutoDismiss(lease, false)).toEqual({ status: 'applied' });
    expect(record(controller, handle).remainingMs).toBeNull();
    expect(clock.pendingCount).toBe(0);
    clock.advanceBy(100_000);
    expect(controller.getHandle(handle.id)).toBe(handle);
    expect(bridge.setAutoDismiss(lease, undefined)).toEqual({ status: 'applied' });
    expect(record(controller, handle).remainingMs).toBe(1_000);
    expect(bridge.setAutoDismiss(lease, 'no' as unknown as boolean)).toEqual({ status: 'rejected', reason: 'invalid-input' });
    expect(bridge.setAutoDismiss('stale' as never, false)).toMatchObject({ status: 'rejected' });
    bridge.setAutoDismiss(lease, false);
    bridge.detach(lease);
    expect(record(controller, handle).remainingMs).toBe(1_000);
    // A running operation is timed only once it settles.
    const persistent = harness({ autoDismiss: false });
    const lease2 = attach(persistent.bridge);
    const operation = persistent.controller.track(() => new Promise<string>(() => {}), { pending: { title: 'Saving' }, success: { title: 'Saved' }, error: { title: 'Failed' } });
    if (operation.admission.status !== 'created') throw new Error('Operation was not admitted');
    persistent.bridge.setAutoDismiss(lease2, true);
    expect(record(persistent.controller, operation.admission.handle).remainingMs).toBeNull();
  });

  it('does not reset on title/progress updates but restarts an explicit duration even at the same value', () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const handle = admit(controller, { title: 'Initial', duration: 6_000 });
    acknowledge(bridge, lease, handle);
    const originalToken = presentation(bridge, handle);
    clock.advanceBy(3_000);
    controller.update(handle, { title: 'Updated', progress: { kind: 'determinate', value: 0.5 } });
    expect(record(controller, handle).remainingMs).toBe(3_000);
    expect(presentation(bridge, handle)).toBe(originalToken);
    controller.update(handle, { duration: 6_000 });
    expect(record(controller, handle).remainingMs).toBe(6_000);
    clock.advanceBy(5_999);
    expect(controller.getHandle(handle.id)).toBe(handle);
    clock.advanceBy(1);
    expect(controller.getHandle(handle.id)).toBeUndefined();
  });

  it('recomputes default kind/action policy and preserves an explicit budget across content policy changes', () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const handle = admit(controller, { title: 'Loading', kind: 'loading' });
    acknowledge(bridge, lease, handle);
    controller.update(handle, { kind: 'success' });
    expect(record(controller, handle).remainingMs).toBe(6_000);
    clock.advanceBy(1_000);
    controller.update(handle, { action: { kind: 'link', label: 'Open', href: '/details' } });
    expect(record(controller, handle).remainingMs).toBeNull();
    controller.update(handle, { action: null });
    expect(record(controller, handle).remainingMs).toBe(6_000);
    controller.update(handle, { duration: 2_000 });
    controller.update(handle, { kind: 'error' });
    expect(record(controller, handle).remainingMs).toBe(2_000);
    clock.advanceBy(2_000);
    expect(controller.getHandle(handle.id)).toBeUndefined();
  });

  it('defers duration zero to the first scheduler turn after acknowledgement', () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const handle = admit(controller, { title: 'Zero', duration: 0 });
    expect(clock.pendingCount).toBe(0);
    acknowledge(bridge, lease, handle);
    expect(controller.getHandle(handle.id)).toBe(handle);
    expect(clock.pendingCount).toBe(1);
    clock.advanceBy(0);
    expect(controller.getHandle(handle.id)).toBeUndefined();
  });

  it('rejects stale presentation callbacks and emits presented once per current token', () => {
    const { controller, bridge, clock } = harness();
    const events: { firstPresentation: boolean }[] = [];
    controller.onEvent((event) => { if (event.type === 'presented') events.push(event); });
    const lease = attach(bridge);
    const a = admit(controller, 'a');
    const original = presentation(bridge, a);
    acknowledge(bridge, lease, a);
    expect(bridge.acknowledgePresentation(lease, a, original)).toEqual({ status: 'unchanged' });
    clock.advanceBy(2_000);
    const begun = bridge.beginPresentation(lease, a, original);
    if (begun.status !== 'started') throw new Error('Expected presentation transition');
    expect(begun.token).not.toBe(original);
    expect(bridge.acknowledgePresentation(lease, a, original)).toEqual({ status: 'rejected', reason: 'stale-presentation' });
    expect(bridge.beginPresentation(lease, a, original)).toEqual({ status: 'rejected', reason: 'stale-presentation' });
    clock.advanceBy(20_000);
    expect(record(controller, a).remainingMs).toBe(4_000);
    acknowledge(bridge, lease, a);
    const b = admit(controller, 'b');
    expect(bridge.acknowledgePresentation(lease, a, begun.token)).toEqual({ status: 'rejected', reason: 'not-current' });
    controller.dismiss(b);
    acknowledge(bridge, lease, a);
    expect(events.map((event) => event.firstPresentation)).toEqual([true, false, false]);
  });

  it('survives second hosts, repeated detach, stale leases, remount and dispose without resource leaks', () => {
    const onClose = vi.fn();
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const a = admit(controller, { title: 'a', onClose });
    acknowledge(bridge, lease, a);
    const oldToken = presentation(bridge, a);
    clock.advanceBy(2_000);
    expect(bridge.attach()).toEqual({ status: 'rejected', reason: 'host-exists' });
    bridge.setPause(lease, { scope: 'host', reason: 'hover', active: true });
    bridge.setFocused(lease, a);
    expect(bridge.detach(lease)).toEqual({ status: 'applied' });
    expect(bridge.detach(lease)).toEqual({ status: 'unchanged' });
    expect(clock.pendingCount).toBe(0);
    expect(record(controller, a).remainingMs).toBe(4_000);
    expect(record(controller, a).pauseReasons).toContain('no-host');
    expect(record(controller, a).pauseReasons).not.toContain('hover');
    clock.advanceBy(50_000);
    const nextLease = attach(bridge);
    expect(nextLease).not.toBe(lease);
    expect(presentation(bridge, a)).not.toBe(oldToken);
    expect(bridge.detach(lease)).toEqual({ status: 'rejected', reason: 'stale-lease' });
    expect(bridge.acknowledgePresentation(lease, a, oldToken)).toEqual({ status: 'rejected', reason: 'stale-lease' });
    acknowledge(bridge, nextLease, a);
    clock.advanceBy(3_999);
    expect(controller.getHandle(a.id)).toBe(a);
    controller.dispose();
    controller.dispose();
    expect(onClose).toHaveBeenCalledExactlyOnceWith({ handle: a, reason: 'dispose' });
    expect(clock.pendingCount).toBe(0);
    expect(controller.getSnapshot()).toMatchObject({ disposed: true, notifications: [], stack: [], island: { open: false }, overflow: { count: 0, pending: false } });
    expect(controller.show({ title: 'late' })).toEqual({ status: 'rejected', reason: 'disposed' });
    expect(controller.update(a, { title: 'late' })).toEqual({ status: 'rejected', reason: 'disposed' });
    expect(controller.dismiss(a)).toEqual({ status: 'rejected', reason: 'disposed' });
    expect(controller.clear()).toEqual({ status: 'rejected', reason: 'disposed' });
    expect(controller.requestFocus()).toEqual({ status: 'rejected', reason: 'disposed' });
    expect(controller.getHandle(a.id)).toBeUndefined();
    expect(bridge.attach()).toEqual({ status: 'rejected', reason: 'disposed' });
    const disposed = controller.getSnapshot();
    clock.advanceBy(100_000);
    expect(controller.getSnapshot()).toBe(disposed);
  });

  it('ignores delivered canceled timer callbacks after pause, budget reset, ID reuse, and dispose', () => {
    const clock = new RetainedCallbackClock();
    const controller = createCloudletCore<unknown, AbortSignal>(undefined, { clock, createCancellation });
    const bridge = getRendererBridge(controller);
    const lease = attach(bridge);
    const first = admit(controller, 'reused');
    acknowledge(bridge, lease, first);
    const stale = clock.callbacks[0];
    if (!stale) throw new Error('Expected scheduled callback');
    clock.manual.advanceBy(1_000);
    bridge.setPause(lease, { scope: 'host', reason: 'hover', active: true });
    clock.manual.advanceBy(10_000);
    stale();
    expect(controller.getHandle(first.id)).toBe(first);
    controller.update(first, { duration: 12_000 });
    bridge.setPause(lease, { scope: 'host', reason: 'hover', active: false });
    stale();
    expect(record(controller, first).remainingMs).toBe(12_000);
    controller.dismiss(first);
    const replacement = admit(controller, 'reused');
    acknowledge(bridge, lease, replacement);
    for (const callback of [...clock.callbacks]) callback();
    expect(controller.getHandle(first.id)).toBe(replacement);
    controller.dispose();
    const disposed = controller.getSnapshot();
    for (const callback of [...clock.callbacks]) callback();
    expect(controller.getSnapshot()).toBe(disposed);
    expect(clock.manual.pendingCount).toBe(0);
  });
});
