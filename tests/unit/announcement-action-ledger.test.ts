import { expect, it } from 'vitest';
import { admit, attach, harness, record } from '../support/controller-harness.js';
import { createDeferred } from '../support/deferred.js';

it('validates action phase/token acknowledgements atomically, retains across leases and removes with generation', async () => {
  const { controller, bridge } = harness();
  const deferred = createDeferred<void>();
  const handle = admit(controller, { title: 'Action', action: { kind: 'command', label: 'Run', run: () => deferred.promise } });
  let lease = attach(bridge);
  bridge.invokeAction(lease, handle);
  const pending = record(controller, handle).action;
  if (pending.status !== 'pending') throw new Error('Expected pending action');
  const before = bridge.getSnapshot();
  expect(bridge.acknowledgeAnnouncements(lease, [
    { kind: 'first-presentation', handle },
    { kind: 'action', handle, token: pending.token, status: 'failed' },
  ])).toEqual({ status: 'rejected', reason: 'invalid-input' });
  expect(bridge.getSnapshot()).toBe(before);
  const ack = { kind: 'action' as const, handle, token: pending.token, status: 'pending' as const };
  expect(bridge.acknowledgeAnnouncements(lease, [ack])).toEqual({ status: 'applied' });
  expect(bridge.acknowledgeAnnouncements(lease, [ack])).toEqual({ status: 'unchanged' });
  bridge.detach(lease); lease = attach(bridge);
  expect(bridge.getSnapshot().announcements.notifications[0]?.action).toEqual({ token: pending.token, status: 'pending' });
  deferred.reject(new Error('failed'));
  await Promise.resolve(); await Promise.resolve();
  expect(record(controller, handle).action.status).toBe('failed');
  expect(bridge.acknowledgeAnnouncements(lease, [{ ...ack, status: 'failed' }])).toEqual({ status: 'applied' });
  bridge.invokeAction(lease, handle);
  expect(bridge.acknowledgeAnnouncements(lease, [ack])).toEqual({ status: 'rejected', reason: 'invalid-input' });
  controller.dismiss(handle);
  expect(bridge.getSnapshot().announcements.notifications).toEqual([]);
  controller.dispose();
});
