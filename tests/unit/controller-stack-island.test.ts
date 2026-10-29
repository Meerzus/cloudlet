import { describe, expect, it, vi } from 'vitest';
import type { HostLease } from '../../packages/toast/src/contracts/internal.js';
import type { IslandReason } from '../../packages/toast/src/contracts/snapshots.js';
import { acknowledge, admit, attach, current, harness, presentation, record } from '../support/controller-harness.js';

// Attention is covered by its own suite; `stack` keeps these records from auto-opening.
const quiet = (id: string, extra: object = {}) => ({ id, title: id, duration: null, attention: 'stack' as const, ...extra });

describe('stack order and the presented record', () => {
  it('orders the stack newest first, ignores priority, and presents the top record while collapsed', () => {
    const { controller } = harness();
    const a = admit(controller, quiet('a', { priority: 'high' }));
    const b = admit(controller, quiet('b'));
    const c = admit(controller, quiet('c', { priority: 'high' }));
    const snapshot = controller.getSnapshot();
    expect(snapshot.stack).toEqual([c, b, a]);
    expect(snapshot.notifications.map((item) => item.handle)).toEqual([a, b, c]);
    expect(snapshot.island).toEqual({ open: false, reason: null, current: null });
    expect(snapshot.notifications.map((item) => item.location)).toEqual(['stack', 'stack', 'current']);
    expect(current(controller)).toEqual([c]);
  });

  it('keeps dedupe in place, moves a reused ID to the top and presents the successor after dismiss', () => {
    const { controller } = harness();
    const a = admit(controller, quiet('a', { dedupeKey: 'same' }));
    const b = admit(controller, quiet('b'));
    expect(controller.show(quiet('ignored', { dedupeKey: 'same' }))).toMatchObject({ status: 'deduplicated', handle: a });
    expect(controller.getSnapshot().stack).toEqual([b, a]);
    controller.dismiss(a);
    const reused = admit(controller, quiet('a'));
    expect(controller.getSnapshot().stack).toEqual([reused, b]);
    controller.dismiss(reused);
    expect(current(controller)).toEqual([b]);
    controller.dismiss(b);
    expect(controller.getSnapshot()).toMatchObject({ stack: [], island: { open: false } });
    expect(current(controller)).toEqual([]);
  });

  it('mints a presentation token only when the presented record changes and clears its host-owned pauses', () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const a = admit(controller, quiet('a', { duration: 6_000 }));
    const first = presentation(bridge, a);
    acknowledge(bridge, lease, a);
    clock.advanceBy(1_000);
    bridge.setPause(lease, { scope: 'notification', handle: a, reason: 'gesture', active: true });
    controller.update(a, { title: 'Still a' });
    expect(presentation(bridge, a)).toBe(first);
    const b = admit(controller, quiet('b'));
    expect(bridge.getSnapshot().presentation).toMatchObject({ handle: b, readable: false });
    expect(record(controller, a)).toMatchObject({ location: 'stack', remainingMs: 5_000, pauseReasons: ['inactive'] });
    expect(bridge.acknowledgePresentation(lease, a, first)).toEqual({ status: 'rejected', reason: 'not-current' });
    expect(bridge.beginPresentation(lease, a, first)).toEqual({ status: 'rejected', reason: 'not-current' });
    expect(bridge.setPause(lease, { scope: 'notification', handle: a, reason: 'gesture', active: true }))
      .toEqual({ status: 'rejected', reason: 'not-current' });
    expect(bridge.setFocused(lease, a)).toEqual({ status: 'rejected', reason: 'not-current' });
    controller.dismiss(b);
    expect(presentation(bridge, a)).not.toBe(first);
    expect(record(controller, a).pauseReasons).toEqual(['presentation-pending']);
  });
});

describe('Island state', () => {
  function threeRecords() {
    const setup = harness();
    const lease = attach(setup.bridge);
    const [a, b, c] = ['a', 'b', 'c'].map((id) => admit(setup.controller, quiet(id)));
    if (!a || !b || !c) throw new Error('Missing fixture handles');
    return { ...setup, lease, a, b, c };
  }

  it('opens on the top record by default, or on an explicit record, with the requested reason', () => {
    const { controller, bridge, lease, a, c } = threeRecords();
    expect(bridge.openIsland(lease, 'user')).toEqual({ status: 'applied' });
    expect(controller.getSnapshot().island).toEqual({ open: true, reason: 'user', current: c });
    expect(bridge.openIsland(lease, 'user')).toEqual({ status: 'unchanged' });
    expect(bridge.collapseIsland(lease)).toEqual({ status: 'applied' });
    expect(bridge.collapseIsland(lease)).toEqual({ status: 'unchanged' });
    expect(controller.getSnapshot().island).toEqual({ open: false, reason: null, current: null });
    expect(bridge.openIsland(lease, 'attention', a)).toEqual({ status: 'applied' });
    expect(controller.getSnapshot().island).toEqual({ open: true, reason: 'attention', current: a });
    expect(current(controller)).toEqual([a]);
  });

  it('moves the slider of an open Island without changing its reason', () => {
    const { controller, bridge, lease, a, b } = threeRecords();
    bridge.openIsland(lease, 'user');
    expect(bridge.openIsland(lease, 'attention', a)).toEqual({ status: 'applied' });
    expect(controller.getSnapshot().island).toEqual({ open: true, reason: 'user', current: a });
    expect(bridge.navigate(lease, b)).toEqual({ status: 'applied' });
    expect(bridge.navigate(lease, b)).toEqual({ status: 'unchanged' });
    expect(controller.getSnapshot().island.current).toBe(b);
    expect(bridge.getSnapshot().presentation).toMatchObject({ handle: b, readable: false });
  });

  it('validates lease, reason, handle and state before changing the Island', () => {
    const { controller, bridge, lease, a } = threeRecords();
    const before = controller.getSnapshot();
    expect(bridge.openIsland('stale' as HostLease, 'user')).toEqual({ status: 'rejected', reason: 'stale-lease' });
    expect(bridge.openIsland(lease, 'hover' as IslandReason)).toEqual({ status: 'rejected', reason: 'invalid-input' });
    expect(bridge.navigate(lease, a)).toEqual({ status: 'rejected', reason: 'island-closed' });
    controller.dismiss(a);
    expect(bridge.openIsland(lease, 'user', a)).toEqual({ status: 'rejected', reason: 'stale-handle' });
    expect(bridge.navigate(lease, a)).toEqual({ status: 'rejected', reason: 'stale-handle' });
    expect(controller.getSnapshot().island).toEqual(before.island);
    controller.clear();
    expect(bridge.openIsland(lease, 'user')).toEqual({ status: 'rejected', reason: 'empty' });
  });

  it('moves current to the next older record on dismiss, then to a newer one, and closes after the last', () => {
    const { controller, bridge, lease, a, b, c } = threeRecords();
    bridge.openIsland(lease, 'user', b);
    controller.dismiss(b);
    expect(controller.getSnapshot().island).toEqual({ open: true, reason: 'user', current: a });
    controller.dismiss(a);
    expect(controller.getSnapshot().island).toEqual({ open: true, reason: 'user', current: c });
    controller.dismiss(c);
    expect(controller.getSnapshot().island).toEqual({ open: false, reason: null, current: null });
  });

  it('keeps current when another record is dismissed or a new one arrives', () => {
    const { controller, bridge, lease, a, b } = threeRecords();
    bridge.openIsland(lease, 'user', b);
    controller.dismiss(a);
    const d = admit(controller, quiet('d'));
    expect(controller.getSnapshot().stack[0]).toBe(d);
    expect(controller.getSnapshot().island.current).toBe(b);
    expect(record(controller, d).location).toBe('stack');
    bridge.collapseIsland(lease);
    expect(current(controller)).toEqual([d]);
  });

  it('closes on clear and dispose, and survives detach', () => {
    const { controller, bridge, lease, b } = threeRecords();
    bridge.openIsland(lease, 'user', b);
    bridge.detach(lease);
    expect(controller.getSnapshot().island).toEqual({ open: true, reason: 'user', current: b });
    attach(bridge);
    controller.clear();
    expect(controller.getSnapshot().island.open).toBe(false);
    admit(controller, quiet('e'));
    const next = bridge.getSnapshot();
    expect(next.island.open).toBe(false);
    controller.dispose();
    expect(controller.getSnapshot()).toMatchObject({ island: { open: false, reason: null, current: null }, stack: [] });
  });
});

describe('visible time in the stack and the Island', () => {
  it('spends time only on the top record while collapsed', () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const a = admit(controller, quiet('a', { duration: 3_000 }));
    acknowledge(bridge, lease, a);
    clock.advanceBy(1_000);
    const b = admit(controller, quiet('b', { duration: 3_000 }));
    acknowledge(bridge, lease, b);
    clock.advanceBy(2_999);
    expect(record(controller, a).remainingMs).toBe(2_000);
    clock.advanceBy(1);
    expect(controller.getHandle('b')).toBeUndefined();
    acknowledge(bridge, lease, a);
    clock.advanceBy(2_000);
    expect(controller.getSnapshot().notifications).toEqual([]);
  });

  it('pauses current in an Island the user opened and keeps other records still', () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const a = admit(controller, quiet('a', { duration: 3_000 }));
    const b = admit(controller, quiet('b', { duration: 3_000 }));
    acknowledge(bridge, lease, b);
    bridge.openIsland(lease, 'user', a);
    acknowledge(bridge, lease, a);
    expect(record(controller, a).pauseReasons).toEqual(['island']);
    expect(record(controller, b).pauseReasons).toEqual(['inactive']);
    clock.advanceBy(60_000);
    expect(controller.getSnapshot().notifications).toHaveLength(2);
    bridge.collapseIsland(lease);
    acknowledge(bridge, lease, b);
    clock.advanceBy(3_000);
    expect(controller.getHandle('b')).toBeUndefined();
  });

  it.each([
    ['an action', { action: { kind: 'command' as const, label: 'Run', run: vi.fn() } }],
    ['attention open', { attention: 'open' as const }],
  ])('pauses a slide with %s in an Island opened by attention', (_label, extra) => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const handle = admit(controller, { ...quiet('slide', { duration: 2_000 }), ...extra });
    bridge.openIsland(lease, 'attention', handle);
    acknowledge(bridge, lease, handle);
    expect(record(controller, handle).pauseReasons).toEqual(['island']);
    clock.advanceBy(60_000);
    expect(controller.getHandle('slide')).toBe(handle);
  });

  it('pauses a retryable failure but not a successful factory in an attention Island', async () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const messages = { pending: { title: 'Saving', attention: 'stack' as const },
      success: { title: 'Saved', duration: 2_000, attention: 'stack' as const },
      error: { title: 'Failed', duration: 2_000, attention: 'stack' as const } };
    const failed = controller.track(() => Promise.reject(new Error('no')), messages);
    const succeeded = controller.track(() => Promise.resolve('ok'), messages);
    await expect(failed.result).rejects.toThrow('no');
    await succeeded.result;
    if (failed.admission.status !== 'created' || succeeded.admission.status !== 'created') throw new Error('Admission failed');
    bridge.openIsland(lease, 'attention', failed.admission.handle);
    acknowledge(bridge, lease, failed.admission.handle);
    expect(record(controller, failed.admission.handle).pauseReasons).toEqual(['island']);
    bridge.navigate(lease, succeeded.admission.handle);
    acknowledge(bridge, lease, succeeded.admission.handle);
    expect(record(controller, succeeded.admission.handle).pauseReasons).toEqual([]);
    clock.advanceBy(2_000);
    expect(controller.getHandle(succeeded.admission.handle.id)).toBeUndefined();
    expect(controller.getSnapshot().island).toMatchObject({ open: true, current: failed.admission.handle });
  });

  it('lets a description-only slide expire in an attention Island unless hover or focus pause it', () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const description = { kind: 'text' as const, text: 'Details' };
    const older = admit(controller, quiet('older', { duration: 5_000 }));
    const slide = admit(controller, quiet('slide', { duration: 2_000, description }));
    bridge.openIsland(lease, 'attention', slide);
    acknowledge(bridge, lease, slide);
    expect(record(controller, slide).pauseReasons).toEqual([]);
    bridge.setPause(lease, { scope: 'host', reason: 'hover', active: true });
    clock.advanceBy(10_000);
    expect(record(controller, slide).remainingMs).toBe(2_000);
    bridge.setPause(lease, { scope: 'host', reason: 'hover', active: false });
    clock.advanceBy(2_000);
    expect(controller.getHandle('slide')).toBeUndefined();
    expect(controller.getSnapshot().island).toEqual({ open: true, reason: 'attention', current: older });
    expect(record(controller, older).remainingMs).toBe(5_000);
  });
});

describe('overflow in the stack model', () => {
  it('reports overflow beside the stack, survives clear and the Island, and is acknowledged independently', () => {
    const onOverflow = vi.fn();
    const { controller, bridge } = harness({ onOverflow });
    const lease = attach(bridge);
    for (let index = 0; index < 100; index++) admit(controller, quiet(`n-${index}`));
    expect(controller.show(quiet('rejected'))).toEqual({ status: 'rejected', reason: 'capacity' });
    expect(onOverflow).toHaveBeenCalledExactlyOnceWith({ count: 1, pending: true });
    expect(controller.getSnapshot().stack).toHaveLength(100);
    expect(controller.getSnapshot().overflow).toEqual({ count: 1, pending: true });
    bridge.openIsland(lease, 'user');
    controller.clear();
    expect(controller.getSnapshot()).toMatchObject({ stack: [], island: { open: false }, overflow: { count: 1, pending: true } });
    expect(bridge.acknowledgeOverflow(lease)).toEqual({ status: 'applied' });
    expect(controller.getSnapshot().overflow).toEqual({ count: 0, pending: false });
  });
});
