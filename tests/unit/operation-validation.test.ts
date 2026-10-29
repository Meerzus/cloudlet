import { describe, expect, it, vi } from 'vitest';
import { validateContent, validateTrackOptions } from '../../packages/toast/src/core/validation.js';

const validOptions = () => ({ pending: { title: 'Working' }, success: { title: 'Done' }, error: { title: 'Failed' } });

describe('operation input validation', () => {
  it('validates static terminal content and prefixes nested issue paths', () => {
    expect(validateTrackOptions(validOptions(), true)).toEqual([]);
    expect(validateTrackOptions({
      ...validOptions(),
      pending: { title: 'Working', duration: null },
      success: { title: '', progress: { kind: 'determinate', value: 2 } },
      error: { title: 'Failed', action: { kind: 'command', label: 'Retry', run: null } },
      cancelled: { title: 'Cancelled', description: { kind: 'rich', content: {}, announcement: '' } },
    }, true).map(({ path }) => path)).toEqual([
      'pending.duration', 'success.title', 'success.progress.value', 'error.action.run', 'cancelled.description.announcement',
    ]);
  });

  it('keeps functions and rich slots opaque until the runner invokes them', () => {
    const mapper = vi.fn(() => { throw new Error('Do not call while validating'); });
    const slot = Object.defineProperty({}, 'title', { get: mapper });
    expect(validateTrackOptions({
      pending: { title: 'Working', icon: slot, description: { kind: 'rich', content: slot, announcement: 'Working' } },
      success: mapper, error: mapper, cancelled: mapper, cancel: mapper, isCancellation: mapper, onClose: mapper,
    }, false)).toEqual([]);
    expect(mapper).not.toHaveBeenCalled();
  });

  it('requires all initial content, rejects unknown fields and factory cancellation hooks', () => {
    expect(validateTrackOptions({}, false).map(({ path }) => path)).toEqual(['pending', 'success', 'error']);
    expect(validateTrackOptions({ ...validOptions(), dedupeKey: 'same', extra: true }, false))
      .toEqual([{ path: 'dedupeKey', message: 'Unknown field' }, { path: 'extra', message: 'Unknown field' }]);
    expect(validateTrackOptions({ ...validOptions(), cancel: () => undefined }, true))
      .toContainEqual({ path: 'cancel', message: 'Factory cancellation uses its attempt signal' });
    expect(validateTrackOptions({ ...validOptions(), pending: () => ({ title: 'No mapper here' }) }, false)
      .some(({ path }) => path === 'pending')).toBe(true);
    for (const key of ['id', 'priority', 'cancelled', 'cancel', 'isCancellation', 'onClose']) {
      expect(validateTrackOptions({ ...validOptions(), [key]: undefined }, false)
        .some(({ path }) => path === key)).toBe(true);
    }
    for (const key of ['cancel', 'isCancellation', 'onClose']) {
      expect(validateTrackOptions({ ...validOptions(), [key]: 'callback' }, false))
        .toContainEqual({ path: key, message: 'Expected a function' });
    }
  });

  it('rejects getters without executing them and freezes diagnostic records', () => {
    const get = vi.fn(() => { throw new Error('Must not execute'); });
    const root = Object.defineProperty(validOptions(), 'cancel', { get });
    const nested = { ...validOptions(), success: Object.defineProperty({}, 'title', { get }) };
    const rootIssues = validateTrackOptions(root, false);
    const nestedIssues = validateTrackOptions(nested, false);
    expect(rootIssues).toContainEqual({ path: 'cancel', message: 'Expected a data property' });
    expect(nestedIssues).toContainEqual({ path: 'success.title', message: 'Expected a data property' });
    expect(get).not.toHaveBeenCalled();
    expect(Object.isFrozen(rootIssues)).toBe(true);
    expect(rootIssues.every(Object.isFrozen)).toBe(true);
  });

  it('validates mapper output as content with no record fields or pending TTL', () => {
    expect(validateContent({ title: 'Done', duration: 500 })).toEqual([]);
    expect(validateContent({ title: 'Working', duration: 0 }, true))
      .toContainEqual({ path: 'duration', message: 'Pending content cannot define a duration' });
    expect(validateContent({ title: 'Done', kind: 'success', priority: 'high', id: 'x' }))
      .toEqual(['kind', 'priority', 'id'].map((path) => ({ path, message: 'Unknown field' })));
    expect(validateContent({ title: 'Done', action: { kind: 'link', label: 'Open', href: 'javascript:bad' } }))
      .toContainEqual({ path: 'action.href', message: 'Unsupported or unsafe URL' });
  });
});
