import { describe, expect, it } from 'vitest';
import type { NotificationHandle } from '../../packages/toast/src/contracts/identity.js';
import type { RendererCloseReason } from '../../packages/toast/src/contracts/internal.js';
import { admit, attach, harness } from '../support/controller-harness.js';

describe('controller edge regressions', () => {
  it('validates renderer dismiss handles before subsequent close-reason conditions', () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const current = admit(controller, 'current');
    const malformed = {} as NotificationHandle;
    expect(bridge.dismiss(lease, malformed, 'invalid-reason' as RendererCloseReason))
      .toEqual({ status: 'rejected', reason: 'invalid-handle' });
    const foreign = admit(harness().controller, 'foreign');
    expect(bridge.dismiss(lease, foreign, 'invalid-reason' as RendererCloseReason))
      .toEqual({ status: 'rejected', reason: 'foreign-controller' });
    controller.dismiss(current);
    expect(bridge.dismiss(lease, current, 'invalid-reason' as RendererCloseReason))
      .toEqual({ status: 'rejected', reason: 'stale-handle' });
  });

  it('returns the dedupe count belonging to its own commit despite observer reentrancy', () => {
    const { controller } = harness();
    const current = admit(controller, { title: 'Current', dedupeKey: 'current' });
    const counts: number[] = [];
    controller.onEvent((event) => {
      if (event.type !== 'deduplicated') return;
      counts.push(event.occurrences);
      if (event.occurrences === 2) controller.show({ title: 'Reentrant dedupe', dedupeKey: 'current' });
    });
    const result = controller.show({ title: 'Dedupe', dedupeKey: 'current' });
    expect(counts).toEqual([2, 3]);
    expect(result).toEqual({ status: 'deduplicated', handle: current, occurrences: 2 });
    expect(controller.getSnapshot().notifications[0]?.occurrences).toBe(3);
  });

  it('delivers close-callback diagnostics to observers before the final disposed event', () => {
    const trace: string[] = [];
    const { controller } = harness({ onDiagnostic: (diagnostic) => { trace.push(`callback:${diagnostic.code}`); } });
    admit(controller, { title: 'Current', onClose: () => { throw new Error('Close failed'); } });
    controller.onEvent((event) => {
      trace.push(event.type === 'diagnostic' ? `event:${event.diagnostic.code}` : event.type);
    });
    controller.dispose();
    expect(trace).toEqual(['closed', 'event:callback-error', 'callback:callback-error', 'disposed']);
    const disposed = controller.getSnapshot();
    controller.dispose();
    expect(controller.getSnapshot()).toBe(disposed);
  });
});
