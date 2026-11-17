import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createColorReport, reportText, SETTLE, type ReportController } from '../../apps/site/src/lib/color-report';

type Status = 'applied' | 'unchanged' | 'rejected';

/** A page controller that remembers what is on screen: `leave` takes a notification away. */
function fakeController() {
  const live = new Set<string>();
  let updateStatus: Status = 'applied';
  const show = vi.fn((spec: { id?: string }) => {
    live.add(spec.id!);
    return { status: 'created', handle: { id: spec.id } };
  });
  const update = vi.fn(() => (updateStatus === 'rejected' ? { status: 'rejected', reason: 'stale-handle' } : { status: updateStatus }));
  const getHandle = vi.fn((id: string) => (live.has(id) ? { id } : undefined));
  return {
    controller: { show, update, getHandle } as unknown as ReportController,
    show,
    update,
    leave: (id: string) => live.delete(id),
    setUpdate: (status: Status) => {
      updateStatus = status;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the Island answers the color picker chapter', () => {
  it('waits until the color has rested, then reports the last change once', () => {
    const fake = fakeController();
    const report = createColorReport({ controller: () => fake.controller, read: () => ({ hex: '#2e8b57', count: 3 }) });
    // A drag: many changes, each sooner than SETTLE after the last.
    for (let step = 0; step < 10; step += 1) {
      report.note('accent');
      vi.advanceTimersByTime(SETTLE - 50);
    }
    expect(fake.show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fake.show).toHaveBeenCalledTimes(1);
    expect(fake.show).toHaveBeenCalledWith({
      id: 'kit-color-1',
      title: 'Accent updated',
      kind: 'success',
      description: { kind: 'text', text: 'The page now paints in #2E8B57.' },
    });
  });

  it('reads the colors when it fires, not when the change was noted', () => {
    const fake = fakeController();
    let hex = '#ff6a3d';
    const report = createColorReport({ controller: () => fake.controller, read: () => ({ hex, count: 3 }) });
    report.note('accent');
    hex = '#7cc6fe';
    vi.advanceTimersByTime(SETTLE);
    expect(fake.show.mock.calls[0]![0]).toMatchObject({ description: { text: 'The page now paints in #7CC6FE.' } });
  });

  it('updates the notification on screen in place instead of sending another', () => {
    const fake = fakeController();
    const report = createColorReport({ controller: () => fake.controller, read: () => ({ hex: '#ff6a3d', count: 4 }) });
    report.note('accent');
    vi.advanceTimersByTime(SETTLE);
    report.note('palette');
    vi.advanceTimersByTime(SETTLE);
    expect(fake.show).toHaveBeenCalledTimes(1);
    expect(fake.update).toHaveBeenCalledTimes(1);
    expect(fake.update).toHaveBeenCalledWith(
      { id: 'kit-color-1' },
      { title: 'Palette updated', description: { kind: 'text', text: '4 colors across the paint, the darkest in the shadows.' } },
    );
    // The same words again: nothing changes, and still no second notification.
    fake.setUpdate('unchanged');
    report.note('palette');
    vi.advanceTimersByTime(SETTLE);
    expect(fake.show).toHaveBeenCalledTimes(1);
  });

  it('sends a new notification once the last one has left, or when it can no longer take an update', () => {
    const fake = fakeController();
    const report = createColorReport({ controller: () => fake.controller, read: () => ({ hex: '#ff6a3d', count: 3 }) });
    report.note('accent');
    vi.advanceTimersByTime(SETTLE);
    fake.leave('kit-color-1');
    report.note('accent');
    vi.advanceTimersByTime(SETTLE);
    expect(fake.show).toHaveBeenCalledTimes(2);
    expect(fake.show.mock.calls[1]![0]).toMatchObject({ id: 'kit-color-2' });
    fake.setUpdate('rejected');
    report.note('palette');
    vi.advanceTimersByTime(SETTLE);
    expect(fake.show).toHaveBeenCalledTimes(3);
    expect(fake.show.mock.calls[2]![0]).toMatchObject({ id: 'kit-color-3', title: 'Palette updated' });
  });

  it('says nothing without a change, before the controller exists, or after cancel', () => {
    const fake = fakeController();
    let controller: ReportController | null = null;
    const report = createColorReport({ controller: () => controller, read: () => ({ hex: '#ff6a3d', count: 3 }) });
    vi.advanceTimersByTime(SETTLE * 10);
    report.note('accent');
    vi.advanceTimersByTime(SETTLE);
    controller = fake.controller;
    vi.advanceTimersByTime(SETTLE * 10);
    expect(fake.show).not.toHaveBeenCalled();
    report.note('accent');
    report.cancel();
    vi.advanceTimersByTime(SETTLE * 10);
    expect(fake.show).not.toHaveBeenCalled();
  });

  it('words each change', () => {
    expect(reportText('accent', { hex: '#1b1f4a', count: 1 })).toEqual({ title: 'Accent updated', text: 'The page now paints in #1B1F4A.' });
    expect(reportText('palette', { hex: '#1b1f4a', count: 1 }).text).toBe('1 color across the paint, the darkest in the shadows.');
    expect(reportText('palette', { hex: '#1b1f4a', count: 2 }).title).toBe('Palette updated');
  });
});
