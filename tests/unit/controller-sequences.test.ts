import { describe, expect, it } from 'vitest';
import type { NotificationHandle } from '../../packages/toast/src/contracts/identity.js';
import type { HostLease, PresentationToken } from '../../packages/toast/src/contracts/internal.js';
import { attach, harness } from '../support/controller-harness.js';

/** Xorshift32: sequence generation is reproducible and independent of wall time. */
function randomFrom(seed: number) {
  let state = seed >>> 0;
  return (exclusiveMax: number): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % exclusiveMax;
  };
}

function replay(seed: number) {
  const random = randomFrom(seed);
  const { controller, bridge, clock } = harness();
  let lease: HostLease | undefined = attach(bridge);
  const live = new Map<string, NotificationHandle>();
  const generations = new Set<string>();
  const historicalHandles: NotificationHandle[] = [];
  const callbacks: { lease: HostLease; handle: NotificationHandle; token: PresentationToken }[] = [];
  const closed = new Set<NotificationHandle>();
  const trace: unknown[] = [];
  // Assertions belong outside listeners: controller deliberately catches observer errors.
  const observerErrors: string[] = [];
  let lastEventSequence = 0;
  let lastEventTime = 0;
  controller.onEvent((event) => {
    if (event.sequence <= lastEventSequence) observerErrors.push(`Non-increasing event sequence: ${event.sequence}`);
    if (event.at < lastEventTime) observerErrors.push(`Event time moved backwards: ${event.at}`);
    lastEventSequence = event.sequence;
    lastEventTime = event.at;
    if (event.type === 'closed') {
      if (closed.has(event.handle)) observerErrors.push(`Duplicate close: ${event.handle.id}`);
      if (live.get(event.handle.id) !== event.handle) observerErrors.push(`Closed a non-live generation: ${event.handle.id}`);
      closed.add(event.handle);
      live.delete(event.handle.id);
    }
    if (event.type === 'diagnostic' && event.diagnostic.code === 'listener-error') {
      observerErrors.push(`Unexpected listener exception: ${event.diagnostic.message}`);
    }
    trace.push([event.type, 'handle' in event ? event.handle?.id : null, 'reason' in event ? event.reason : null, event.at]);
  });

  const show = (id: string, dedupe: boolean) => {
    const result = controller.show({
      id,
      title: `Title ${id}`,
      priority: random(3) === 0 ? 'high' : 'normal',
      duration: random(4) === 0 ? null : 500 + random(5_000),
      ...(random(5) === 0 ? { attention: 'open' as const } : {}),
      ...(dedupe ? { dedupeKey: `group-${random(15)}` } : {}),
    });
    if (result.status === 'created') {
      expect(live.has(id)).toBe(false);
      expect(generations.has(result.handle.generation)).toBe(false);
      generations.add(result.handle.generation);
      live.set(id, result.handle);
      historicalHandles.push(result.handle);
    } else if (result.status === 'deduplicated') {
      expect(live.get(result.handle.id)).toBe(result.handle);
    }
  };

  // Deliberately cross the cap, then mix generations, timers, Island navigation, attention and leases.
  for (let index = 0; index < 105; index++) show(`initial-${index}`, false);
  expect(observerErrors).toEqual([]);
  expect(live.size).toBe(100);
  expect(controller.getSnapshot().overflow.count).toBe(5);
  let historical = controller.getSnapshot();
  let serializedHistorical = JSON.stringify(historical);
  let previousRevision = historical.revision;
  for (let step = 0; step < 600; step++) {
    const handles = [...live.values()];
    const target = handles[random(Math.max(handles.length, 1))];
    switch (random(16)) {
      case 0:
      case 1:
      case 2:
        show(`random-${random(135)}`, random(3) === 0);
        break;
      case 3:
        if (target) controller.dismiss(target);
        break;
      case 4:
        if (target && lease) bridge.openIsland(lease, 'user', target);
        break;
      case 5:
        if (target) controller.update(target, { title: `Revision ${step}` });
        break;
      case 6:
        if (target) controller.update(target, { duration: random(5) === 0 ? null : random(4_000) });
        break;
      case 7:
        if (lease) {
          const reasons = ['hover', 'focus', 'document-hidden', 'window-blur'] as const;
          const reason = reasons[random(reasons.length)];
          if (reason) bridge.setPause(lease, { scope: 'host', reason, active: random(2) === 0 });
        }
        break;
      case 8:
        if (lease) {
          const currentLease = lease;
          const presented = bridge.getSnapshot().presentation;
          if (presented?.token) {
            callbacks.push({ lease: currentLease, handle: presented.handle, token: presented.token });
            bridge.acknowledgePresentation(currentLease, presented.handle, presented.token);
          }
        }
        break;
      case 9:
        if (lease) {
          if (random(2) === 0) bridge.collapseIsland(lease);
          else if (target) bridge.navigate(lease, target);
        }
        break;
      case 10:
        if (lease) {
          bridge.detach(lease);
          bridge.detach(lease);
          lease = undefined;
        } else {
          lease = attach(bridge);
        }
        break;
      case 11:
        clock.advanceBy(random(3_000));
        break;
      case 12: {
        const callback = callbacks[random(Math.max(callbacks.length, 1))];
        if (callback) bridge.acknowledgePresentation(callback.lease, callback.handle, callback.token);
        break;
      }
      case 13: {
        const stale = historicalHandles[random(Math.max(historicalHandles.length, 1))];
        if (stale && live.get(stale.id) !== stale) {
          expect(controller.update(stale, { title: 'Stale callback' })).toEqual({ status: 'rejected', reason: 'stale-handle' });
        }
        break;
      }
      case 14:
        if (lease) {
          const presented = bridge.getSnapshot().presentation;
          if (presented?.token) {
            bridge.beginPresentation(lease, presented.handle, presented.token);
            bridge.setPause(lease, { scope: 'notification', handle: presented.handle, reason: 'gesture', active: random(2) === 0 });
          }
        }
        break;
      case 15:
        controller.acknowledgeOverflow();
        if (random(8) === 0) controller.clear();
        break;
    }
    expect(observerErrors).toEqual([]);
    const snapshot = controller.getSnapshot();
    expect(snapshot.revision).toBeGreaterThanOrEqual(previousRevision);
    previousRevision = snapshot.revision;
    expect(snapshot.notifications.length).toBeLessThanOrEqual(100);
    expect(snapshot.notifications.map((item) => item.handle)).toEqual([...live.values()]);
    const current = snapshot.notifications.filter((item) => item.location === 'current').map((item) => item.handle);
    expect(snapshot.stack).toEqual([...live.values()].reverse());
    expect(current).toEqual(live.size ? [snapshot.island.open ? snapshot.island.current : snapshot.stack[0]] : []);
    expect(snapshot.island.open ? snapshot.island.reason !== null && live.get(snapshot.island.current!.id) === snapshot.island.current
      : snapshot.island.reason === null && snapshot.island.current === null).toBe(true);
    for (const item of snapshot.notifications) {
      expect(item.pauseReasons.includes('inactive')).toBe(item.location === 'stack');
      expect(item.pauseReasons.includes('no-host')).toBe(lease === undefined);
      expect(item.remainingMs === null || item.remainingMs >= 0).toBe(true);
    }
    // At most the nearest TTL deadline and one attention candidate.
    expect(clock.pendingCount).toBeLessThanOrEqual(2);
    if (!lease) expect(clock.pendingCount).toBe(0);
    expect(JSON.stringify(historical)).toBe(serializedHistorical);
    if (step % 50 === 0) {
      historical = snapshot;
      serializedHistorical = JSON.stringify(historical);
    }
    trace.push([step, snapshot.notifications.map((item) => [item.handle.id, item.remainingMs, item.location]), snapshot.island.open ? [snapshot.island.reason, snapshot.island.current?.id] : null, snapshot.overflow.count]);
  }
  controller.dispose();
  expect(observerErrors).toEqual([]);
  expect(live.size).toBe(0);
  expect(clock.pendingCount).toBe(0);
  expect(controller.getSnapshot()).toMatchObject({ disposed: true, notifications: [], stack: [], island: { open: false } });
  const disposed = controller.getSnapshot();
  const finalEvents = trace.length;
  for (const callback of callbacks) bridge.acknowledgePresentation(callback.lease, callback.handle, callback.token);
  clock.advanceBy(100_000);
  controller.dispose();
  expect(observerErrors).toEqual([]);
  expect(controller.getSnapshot()).toBe(disposed);
  expect(clock.pendingCount).toBe(0);
  expect(trace.length).toBe(finalEvents);
  return trace;
}

describe('fixed-seed generated controller sequences', () => {
  it.each([0x3a72f10b, 0x1984babe, 0x71c053ed])('preserves collection/stack/Island/time invariants and replays deterministically (seed %i)', (seed) => {
    expect(replay(seed)).toEqual(replay(seed));
  });
});
