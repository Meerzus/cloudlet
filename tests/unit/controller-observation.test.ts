import { describe, expect, it, vi } from 'vitest';
import type { SemanticEvent } from '../../packages/toast/src/contracts/events.js';
import { getRendererBridge } from '../../packages/toast/src/core/bridge.js';
import { acknowledge, admit, attach, harness, presentation, record, type Core } from '../support/controller-harness.js';

describe('controller snapshots, events and renderer observations', () => {
  it('caches snapshots, commits only changed state, and preserves immutable historical Cloudlet structures', () => {
    const { controller, bridge, clock } = harness();
    const initial = controller.getSnapshot();
    const server = controller.getServerSnapshot();
    expect(controller.getSnapshot()).toBe(initial);
    const opaque = { userOwned: { value: 1 } };
    const progress = { kind: 'determinate' as const, value: 0.25 };
    const description = { kind: 'rich' as const, content: opaque, announcement: 'Readable description' };
    const handle = admit(controller, { title: 'Original', icon: opaque, progress, description });
    const first = controller.getSnapshot();
    expect(first.revision).toBeGreaterThan(initial.revision);
    expect(initial.notifications).toEqual([]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.notifications)).toBe(true);
    expect(Object.isFrozen(first.stack)).toBe(true);
    expect(Object.isFrozen(first.island)).toBe(true);
    expect(Object.isFrozen(first.overflow)).toBe(true);
    expect(Object.isFrozen(handle)).toBe(true);
    expect(Object.isFrozen(record(controller, handle))).toBe(true);
    expect(Object.isFrozen(record(controller, handle).content)).toBe(true);
    expect(Object.isFrozen(record(controller, handle).content.progress)).toBe(true);
    expect(Object.isFrozen(record(controller, handle).content.description)).toBe(true);
    expect(Object.isFrozen(opaque)).toBe(false);
    expect(Object.isFrozen(opaque.userOwned)).toBe(false);
    progress.value = 0.9;
    description.announcement = 'Caller mutation';
    expect(record(controller, handle).content.progress).toEqual({ kind: 'determinate', value: 0.25 });
    expect(record(controller, handle).content.description).toMatchObject({ announcement: 'Readable description', content: opaque });
    expect(controller.update(handle, {})).toEqual({ status: 'unchanged' });
    expect(controller.getSnapshot()).toBe(first);
    clock.advanceBy(10_000);
    expect(controller.getSnapshot()).toBe(first);
    controller.update(handle, { title: 'New' });
    expect(first.notifications[0]?.content.title).toBe('Original');
    expect(controller.getSnapshot().notifications[0]?.content.title).toBe('New');
    expect(controller.getServerSnapshot()).toBe(server);
    expect(server).toEqual({ controller: null, revision: 0, disposed: false, notifications: [], stack: [],
      island: { open: false, reason: null, current: null }, overflow: { count: 0, pending: false } });
    expect(getRendererBridge(controller)).toBe(bridge);
    expect(bridge.getSnapshot()).toBe(bridge.getSnapshot());
    expect(() => getRendererBridge({} as Core)).toThrow(TypeError);
  });

  it('delivers committed snapshots before FIFO events and keeps reentrant events behind the current batch', () => {
    const { controller } = harness();
    const order: string[] = [];
    const events: SemanticEvent[] = [];
    const observedCounts: number[] = [];
    const reentrantResults: ReturnType<Core['show']>[] = [];
    controller.subscribe(() => {
      order.push('snapshot');
      observedCounts.push(controller.getSnapshot().notifications.length);
    });
    controller.onEvent((event) => {
      events.push(event);
      order.push(event.type);
      if (event.type === 'admitted' && event.handle.id === 'a') reentrantResults.push(controller.show({ title: 'b', id: 'b' }));
    });
    admit(controller, 'a');
    expect(observedCounts).toEqual([1, 2]);
    expect(reentrantResults).toEqual([{ status: 'created', handle: controller.getHandle('b') }]);
    expect(order[0]).toBe('snapshot');
    expect(events.map((event) => event.type)).toEqual(['admitted', 'admitted']);
    expect(events.map((event) => event.sequence)).toEqual([...events.map((event) => event.sequence)].sort((a, b) => a - b));
    expect(new Set(events.map((event) => event.sequence)).size).toBe(events.length);
    expect(events.every((event) => event.controller === controller.getSnapshot().controller && event.at === 0)).toBe(true);
  });

  it('removes logically and presents the successor in one published state before close callbacks', () => {
    const { controller } = harness();
    const callbackObservations: { removed: ReturnType<Core['getHandle']>; currentId: string | undefined }[] = [];
    const currentId = () => controller.getSnapshot().notifications.find((item) => item.location === 'current')?.handle.id;
    const callback = vi.fn(() => {
      callbackObservations.push({ removed: controller.getHandle('b'), currentId: currentId() });
    });
    const a = admit(controller, 'a');
    const b = admit(controller, { id: 'b', title: 'b', onClose: callback });
    const snapshots: (string | undefined)[] = [];
    const events: SemanticEvent[] = [];
    controller.subscribe(() => snapshots.push(currentId()));
    controller.onEvent((event) => events.push(event));
    controller.dismiss(b);
    expect(snapshots).toEqual(['a']);
    expect(events.map((event) => event.type)).toEqual(['closed']);
    expect(events[0]).toMatchObject({ type: 'closed', handle: b, reason: 'programmatic' });
    expect(controller.getSnapshot().notifications.map((item) => item.handle)).toEqual([a]);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callbackObservations).toEqual([{ removed: undefined, currentId: 'a' }]);
    controller.dismiss(b);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('isolates observer/callback failures and suppresses recursive diagnostic failures', () => {
    const onDiagnostic = vi.fn(() => { throw new Error('Diagnostic observer failed'); });
    const { controller } = harness({ onDiagnostic });
    const healthy = vi.fn();
    const diagnostics: string[] = [];
    const unsubscribe = controller.subscribe(() => { throw new Error('Snapshot observer failed'); });
    controller.subscribe(healthy);
    controller.onEvent((event) => {
      if (event.type === 'diagnostic') {
        diagnostics.push(event.diagnostic.code);
        throw new Error('Diagnostic event observer failed');
      }
    });
    let handle: ReturnType<typeof admit> | undefined;
    expect(() => { handle = admit(controller, { title: 'with callback', onClose: () => { throw new Error('Close failed'); } }); }).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
    unsubscribe();
    unsubscribe();
    if (!handle) throw new Error('Expected admitted handle');
    const admitted = handle;
    expect(() => controller.dismiss(admitted)).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(2);
    expect(diagnostics).toContain('listener-error');
    expect(diagnostics).toContain('callback-error');
    expect(diagnostics.length).toBeLessThan(8);
    expect(onDiagnostic.mock.calls.length).toBeLessThan(8);
  });

  it('does not replay subscriptions, unsubscribes idempotently, and releases all observers on dispose', () => {
    const { controller } = harness();
    const a = admit(controller, 'a');
    const eventListener = vi.fn();
    const snapshotListener = vi.fn();
    const stopEvents = controller.onEvent(eventListener);
    const stopSnapshots = controller.subscribe(snapshotListener);
    expect(eventListener).not.toHaveBeenCalled();
    expect(snapshotListener).not.toHaveBeenCalled();
    stopEvents(); stopEvents(); stopSnapshots(); stopSnapshots();
    controller.update(a, { title: 'New' });
    expect(eventListener).not.toHaveBeenCalled();
    expect(snapshotListener).not.toHaveBeenCalled();
    const disposeEvents: SemanticEvent[] = [];
    controller.onEvent((event) => disposeEvents.push(event));
    controller.dispose();
    expect(disposeEvents.filter((event) => event.type === 'closed')).toHaveLength(1);
    expect(disposeEvents.at(-1)?.type).toBe('disposed');
    const count = disposeEvents.length;
    controller.dispose();
    controller.show({ title: 'No later state' });
    expect(disposeEvents).toHaveLength(count);
  });

  it('keeps focus requests explicit, current-only and protected by current request token and lease', () => {
    const { controller, bridge } = harness();
    const b = admit(controller, 'b');
    const a = admit(controller, 'a');
    expect(controller.requestFocus()).toEqual({ status: 'rejected', reason: 'no-host' });
    const lease = attach(bridge);
    expect(bridge.getSnapshot().focusRequest).toBeNull();
    expect(controller.requestFocus({ kind: 'notification', handle: b })).toEqual({ status: 'rejected', reason: 'not-visible' });
    expect(controller.requestFocus({ kind: 'notification', handle: a, control: 'action' })).toEqual({ status: 'rejected', reason: 'unavailable' });
    expect(controller.requestFocus({ kind: 'overflow' })).toEqual({ status: 'rejected', reason: 'unavailable' });
    // Card controls exist only in the open Island: a collapsed request is refused synchronously.
    expect(controller.requestFocus({ kind: 'notification', handle: a, control: 'close' })).toEqual({ status: 'rejected', reason: 'not-visible' });
    expect(bridge.getSnapshot().focusRequest).toBeNull();
    bridge.openIsland(lease, 'user');
    expect(controller.requestFocus({ kind: 'notification', handle: a, control: 'close' })).toEqual({ status: 'requested' });
    const first = bridge.getSnapshot().focusRequest;
    if (!first) throw new Error('Expected focus request');
    controller.requestFocus();
    const second = bridge.getSnapshot().focusRequest;
    if (!second) throw new Error('Expected replacement focus request');
    expect(first.token).not.toBe(second.token);
    expect(bridge.acknowledgeFocus(lease, first.token, 'focused')).toEqual({ status: 'rejected', reason: 'stale-focus-request' });
    expect(bridge.acknowledgeFocus(lease, second.token, 'focused')).toEqual({ status: 'applied' });
    expect(bridge.getSnapshot().focusRequest).toBeNull();
    controller.requestFocus({ kind: 'notification', handle: a });
    controller.dismiss(a);
    expect(bridge.getSnapshot().focusRequest).toBeNull();
    controller.requestFocus();
    bridge.detach(lease);
    expect(bridge.getSnapshot().focusRequest).toBeNull();
  });

  it('retains a bounded announcement ledger across remount and validates a whole acknowledgement batch', () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const b = admit(controller, 'b');
    const a = admit(controller, { title: 'a', dedupeKey: 'same' });
    acknowledge(bridge, lease, a);
    expect(bridge.acknowledgeAnnouncements(lease, [{ kind: 'first-presentation', handle: a }, { kind: 'queued', handle: b }])).toEqual({ status: 'applied' });
    expect(bridge.acknowledgeAnnouncements(lease, [{ kind: 'first-presentation', handle: a }, { kind: 'queued', handle: b }])).toEqual({ status: 'unchanged' });
    controller.show({ title: 'ignored', dedupeKey: 'same' });
    expect(bridge.acknowledgeAnnouncements(lease, [{ kind: 'occurrences', handle: a, count: 2 }])).toEqual({ status: 'applied' });
    const ledger = bridge.getSnapshot().announcements;
    expect(ledger.notifications).toHaveLength(2);
    expect(ledger.notifications.find((entry) => entry.handle === a)).toMatchObject({ firstPresentation: true, occurrences: 2, operation: null });
    expect(bridge.acknowledgeAnnouncements(lease, [{ kind: 'first-presentation', handle: b }, { kind: 'occurrences', handle: a, count: 3 }]))
      .toMatchObject({ status: 'rejected', reason: 'invalid-input' });
    expect(bridge.getSnapshot().announcements).toEqual(ledger);
    bridge.detach(lease);
    const nextLease = attach(bridge);
    expect(bridge.getSnapshot().announcements).toEqual(ledger);
    expect(bridge.acknowledgeAnnouncements(lease, [])).toEqual({ status: 'rejected', reason: 'stale-lease' });
    const oldPresentation = presentation(bridge, a);
    controller.dismiss(a);
    expect(bridge.getSnapshot().announcements.notifications.map((entry) => entry.handle)).toEqual([b]);
    expect(bridge.acknowledgePresentation(nextLease, a, oldPresentation)).toEqual({ status: 'rejected', reason: 'stale-handle' });
    expect(bridge.acknowledgeAnnouncements(nextLease, [{ kind: 'queued', handle: a }])).toEqual({ status: 'rejected', reason: 'stale-handle' });
  });
});
