import { describe, expect, it, vi } from 'vitest';
import type { NotificationHandle } from '../../packages/toast/src/contracts/identity.js';
import type { NotificationSpec } from '../../packages/toast/src/contracts/notifications.js';
import { acknowledge, admit, attach, harness, record } from '../support/controller-harness.js';

describe('controller admission and identity', () => {
  it('creates independent handles, conflicts occupied IDs, and invalidates a removed generation', () => {
    const { controller } = harness();
    const a = admit(controller, 'same');
    const b = admit(controller, { title: 'No supplied ID' });
    const c = admit(controller, { title: 'No supplied ID' });
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(controller.show({ id: a.id, title: 'Conflict' })).toEqual({ status: 'rejected', reason: 'id-conflict' });
    expect(controller.getHandle(a.id)).toBe(a);
    expect(controller.dismiss(a)).toEqual({ status: 'applied' });
    const replacement = admit(controller, 'same');
    expect(replacement.generation).not.toBe(a.generation);
    expect(replacement.controller).toBe(a.controller);
    for (const result of [controller.dismiss(a), controller.update(a, { title: 'stale' })]) {
      expect(result).toEqual({ status: 'rejected', reason: 'stale-handle' });
    }
    expect(controller.getHandle('same')).toBe(replacement);
    expect(record(controller, replacement).content.title).toBe('same');
    expect(controller.getSnapshot().notifications).toHaveLength(3);
  });

  it('rejects cross-controller and malformed handles without changing either collection', () => {
    const one = harness().controller;
    const two = harness().controller;
    const a = admit(one, 'same');
    const b = admit(two, 'same');
    expect(a.controller).not.toBe(b.controller);
    expect(two.dismiss(a)).toEqual({ status: 'rejected', reason: 'foreign-controller' });
    expect(two.update(a, { title: 'bad' })).toEqual({ status: 'rejected', reason: 'foreign-controller' });
    expect(two.dismiss(null as unknown as NotificationHandle)).toEqual({ status: 'rejected', reason: 'invalid-handle' });
    expect(one.getHandle('same')).toBe(a);
    expect(two.getHandle('same')).toBe(b);
  });

  it('deduplicates before capacity without replacing content, identity, order, callback, or budget', () => {
    const originalClose = vi.fn();
    const ignoredClose = vi.fn();
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const first = admit(controller, { id: 'first', title: 'Original', dedupeKey: 'job', onClose: originalClose });
    acknowledge(bridge, lease, first);
    clock.advanceBy(3_000);
    for (let index = 1; index < 100; index++) admit(controller, `filler-${index}`);
    const before = controller.getSnapshot().notifications.map((item) => item.handle);
    expect(controller.show({ id: 'unused', title: 'Ignored', dedupeKey: 'job', duration: 90_000, priority: 'high', onClose: ignoredClose }))
      .toEqual({ status: 'deduplicated', handle: first, occurrences: 2 });
    expect(controller.getHandle('unused')).toBeUndefined();
    expect(controller.getSnapshot().notifications.map((item) => item.handle)).toEqual(before);
    expect(record(controller, first)).toMatchObject({ occurrences: 2, priority: 'normal', remainingMs: 3_000, content: { title: 'Original' } });
    expect(controller.getSnapshot().overflow.count).toBe(0);
    expect(controller.show({ id: first.id, title: 'Even matching dedupe conflicts', dedupeKey: 'job' }))
      .toEqual({ status: 'rejected', reason: 'id-conflict' });
    // Only the presented record spends time: show the original in the Island.
    clock.advanceBy(50_000);
    expect(record(controller, first).remainingMs).toBe(3_000);
    expect(bridge.openIsland(lease, 'attention', first)).toEqual({ status: 'applied' });
    acknowledge(bridge, lease, first);
    clock.advanceBy(3_000);
    expect(controller.getHandle(first.id)).toBeUndefined();
    expect(originalClose).toHaveBeenCalledExactlyOnceWith({ handle: first, reason: 'timeout' });
    expect(ignoredClose).not.toHaveBeenCalled();
    const reused = admit(controller, { title: 'New generation for freed key', dedupeKey: 'job' });
    expect(reused.generation).not.toBe(first.generation);
  });

  it('rejects newest at 100 and preserves an independent overflow aggregate until acknowledgement', () => {
    const onOverflow = vi.fn();
    const { controller } = harness({ onOverflow });
    const handles = Array.from({ length: 100 }, (_, index) => admit(controller, `item-${index}`));
    expect(controller.show({ title: 'Rejected payload', id: 'overflow-1' })).toEqual({ status: 'rejected', reason: 'capacity' });
    expect(controller.show({ title: 'Rejected payload', id: 'overflow-2' })).toEqual({ status: 'rejected', reason: 'capacity' });
    expect(controller.getSnapshot().notifications.map((item) => item.handle)).toEqual(handles);
    expect(controller.getHandle('overflow-1')).toBeUndefined();
    expect(controller.getSnapshot().overflow).toEqual({ count: 2, pending: true });
    expect(onOverflow.mock.calls).toEqual([[{ count: 1, pending: true }], [{ count: 2, pending: true }]]);
    expect(controller.clear()).toEqual({ status: 'cleared', count: 100 });
    expect(controller.getSnapshot().notifications).toEqual([]);
    expect(controller.getSnapshot().overflow.count).toBe(2);
    const kept = admit(controller, 'kept');
    expect(controller.acknowledgeOverflow()).toEqual({ status: 'applied' });
    expect(controller.getHandle('kept')).toBe(kept);
    expect(controller.getSnapshot().overflow).toEqual({ count: 0, pending: false });
    expect(controller.acknowledgeOverflow()).toEqual({ status: 'unchanged' });
  });

  it('validates atomically before ID conflicts or dedupe and never creates from update', () => {
    const { controller } = harness();
    const original = admit(controller, { id: 'existing', title: 'Original', dedupeKey: 'same' });
    const invalid = controller.show({ id: 'existing', title: ' ', dedupeKey: 'same' });
    expect(invalid).toMatchObject({ status: 'rejected', reason: 'invalid-input', issues: expect.any(Array) });
    expect(controller.update(original, { title: 'Must not apply', progress: { kind: 'determinate', value: 2 } }))
      .toMatchObject({ status: 'rejected', reason: 'invalid-input' });
    expect(record(controller, original).content.title).toBe('Original');
    expect(record(controller, original).occurrences).toBe(1);
    controller.dismiss(original);
    expect(controller.update(original, { title: 'Do not resurrect' })).toEqual({ status: 'rejected', reason: 'stale-handle' });
    expect(controller.getSnapshot().notifications).toEqual([]);
  });

  it.each([
    { title: '  ' }, { title: 'a', id: '' }, { title: 'a', dedupeKey: ' ' },
    { title: 'a', duration: -1 }, { title: 'a', duration: Number.NaN },
    { title: 'a', kind: 'invalid' }, { title: 'a', priority: 'invalid' },
    { title: 'a', description: { kind: 'rich', content: {}, announcement: '' } },
    { title: 'a', action: { kind: 'link', label: 'Unsafe', href: 'javascript:alert(1)' } },
  ])('rejects invalid runtime input %# without admissions or overflow', (spec) => {
    const { controller } = harness();
    expect(controller.show(spec as NotificationSpec<unknown>)).toMatchObject({ status: 'rejected', reason: 'invalid-input' });
    expect(controller.getSnapshot().notifications).toHaveLength(0);
    expect(controller.getSnapshot().overflow.count).toBe(0);
  });
});
