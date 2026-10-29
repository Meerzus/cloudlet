import { describe, expect, it, vi } from 'vitest';
import type { SemanticEvent } from '../../packages/toast/src/contracts/events.js';
import type { NotificationHandle } from '../../packages/toast/src/contracts/identity.js';
import type { ActionResult } from '../../packages/toast/src/contracts/internal.js';
import type { AttemptStartResult, OperationContext, OperationHandle, OperationSnapshot } from '../../packages/toast/src/contracts/operations.js';
import { admit, attach, harness, record } from '../support/controller-harness.js';
import { createDeferred } from '../support/deferred.js';

const messages = {
  pending: { title: 'Working' }, success: { title: 'Completed' }, error: { title: 'Failed' },
};
const drainMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

function notification<T>(operation: OperationHandle<T>): NotificationHandle {
  if (operation.admission.status !== 'created') throw new Error('Expected an admitted operation');
  return operation.admission.handle;
}

describe('async callback reentrancy', () => {
  it('keeps a new attempt pending when the previous success mapper restarts it', async () => {
    const { controller } = harness();
    const sources = [createDeferred<string>(), createDeferred<string>()];
    const events: SemanticEvent[] = [];
    controller.onEvent((event) => events.push(event));
    let restart: AttemptStartResult<string> | undefined;
    const operation = controller.track(({ attempt }) => sources[attempt - 1]!.promise, {
      ...messages,
      success: (value) => {
        if (value === 'first') restart = operation.restart();
        return { title: value };
      },
    });
    const handle = notification(operation);
    sources[0]!.resolve('first');
    await expect(operation.result).resolves.toBe('first');
    expect(restart?.status).toBe('started');
    expect(record(controller, handle)).toMatchObject({ content: { title: 'Working' }, operation: { attempt: 2, status: 'pending' } });
    expect(events.filter((event) => event.type === 'operation-settled')).toEqual([
      expect.objectContaining({ token: operation.token, status: 'fulfilled', uiApplied: false }),
    ]);
    sources[1]!.resolve('second');
    await drainMicrotasks();
    expect(record(controller, handle)).toMatchObject({ content: { title: 'second' }, operation: { attempt: 2, status: 'fulfilled' } });
  });

  it('does not apply a failed mapper fallback over a retry started by the diagnostic callback', async () => {
    let operation!: OperationHandle<string>;
    let retry: AttemptStartResult<string> | undefined;
    const { controller } = harness({
      onDiagnostic: (diagnostic) => {
        if (diagnostic.code === 'mapper-error') retry = operation.retry();
      },
    });
    const sources = [createDeferred<string>(), createDeferred<string>()];
    operation = controller.track(({ attempt }) => sources[attempt - 1]!.promise, {
      ...messages, error: () => { throw new Error('Broken presentation mapper'); },
    });
    const handle = notification(operation);
    const businessError = new Error('Business failure');
    sources[0]!.reject(businessError);
    await expect(operation.result).rejects.toBe(businessError);
    expect(retry?.status).toBe('started');
    expect(record(controller, handle)).toMatchObject({ kind: 'loading', content: { title: 'Working' }, operation: { attempt: 2, status: 'pending' } });
    sources[1]!.resolve('retry succeeded');
    await drainMicrotasks();
    expect(record(controller, handle)).toMatchObject({ kind: 'success', operation: { attempt: 2, status: 'fulfilled' } });
  });

  it('rechecks generation after a mapper closes and recreates the notification', async () => {
    const { controller } = harness();
    const source = createDeferred<string>();
    let replacement: NotificationHandle | undefined;
    const operation = controller.track(source.promise, {
      ...messages, id: 'same',
      success: () => {
        controller.dismiss(notification(operation));
        replacement = admit(controller, { id: 'same', title: 'Replacement' });
        return { title: 'Obsolete completion' };
      },
    });
    const previous = notification(operation);
    source.resolve('value');
    await expect(operation.result).resolves.toBe('value');
    expect(replacement).toBeDefined();
    expect(replacement?.generation).not.toBe(previous.generation);
    expect(controller.getSnapshot().notifications).toEqual([
      expect.objectContaining({ handle: replacement, content: expect.objectContaining({ title: 'Replacement' }), operation: null }),
    ]);
    expect(operation.getSnapshot().notification).toBeNull();
  });

  it('preserves the latest attempt when an old abort listener restarts during restart', async () => {
    const { controller } = harness();
    const sources = [createDeferred<string>(), createDeferred<string>(), createDeferred<string>()];
    const contexts: OperationContext[] = [];
    let nested: AttemptStartResult<string> | undefined;
    const operation = controller.track((context) => {
      contexts.push(context);
      if (context.attempt === 1) context.signal.addEventListener('abort', () => { nested = operation.restart(); });
      return sources[context.attempt - 1]!.promise;
    }, messages);
    const handle = notification(operation);
    const outer = operation.restart();
    expect(outer.status).toBe('started');
    expect(nested?.status).toBe('started');
    expect(contexts.map((context) => context.attempt).sort()).toEqual([1, 2, 3]);
    expect(contexts.find((context) => context.attempt === 1)?.signal.aborted).toBe(true);
    expect(contexts.find((context) => context.attempt === 2)?.signal.aborted).toBe(true);
    expect(contexts.find((context) => context.attempt === 3)?.signal.aborted).toBe(false);
    const latest = operation.getSnapshot();
    expect(latest).toMatchObject({ attempt: 3, status: 'pending', cancelRequested: false });
    sources[1]!.resolve('obsolete second');
    sources[0]!.reject(Object.assign(new Error('Stopped first'), { name: 'AbortError' }));
    await drainMicrotasks();
    expect(operation.getSnapshot()).toBe(latest);
    expect(record(controller, handle)).toMatchObject({ content: { title: 'Working' }, operation: { attempt: 3, status: 'pending' } });
    sources[2]!.resolve('latest value');
    await drainMicrotasks();
    expect(record(controller, handle)).toMatchObject({ kind: 'success', operation: { attempt: 3, status: 'fulfilled' } });
  });

  it('blocks reentrant action starts from both snapshot observers and the command itself', async () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const source = createDeferred<void>();
    const starts: ActionResult[] = [];
    const observations: string[] = [];
    const run = vi.fn(() => {
      observations.push(record(controller, handle).action.status);
      starts.push(bridge.invokeAction(lease, handle));
      return source.promise;
    });
    const handle = admit(controller, { title: 'Command', action: { kind: 'command', label: 'Run', run } });
    controller.subscribe(() => {
      if (controller.getHandle(handle.id) === handle && record(controller, handle).action.status === 'pending') {
        starts.push(bridge.invokeAction(lease, handle));
      }
    });
    expect(bridge.invokeAction(lease, handle)).toEqual({ status: 'started' });
    expect(starts).toEqual([
      { status: 'rejected', reason: 'already-pending' }, { status: 'rejected', reason: 'already-pending' },
    ]);
    expect(observations).toEqual(['pending']);
    expect(run).toHaveBeenCalledTimes(1);
    source.resolve();
    await drainMicrotasks();
    expect(controller.getHandle(handle.id)).toBeUndefined();
  });

  it('does not apply action failure after errorMessage closes and recreates its generation', async () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const source = createDeferred<void>();
    const events: SemanticEvent[] = [];
    controller.onEvent((event) => events.push(event));
    let replacement: NotificationHandle | undefined;
    const handle = admit(controller, {
      id: 'command', title: 'Original',
      action: {
        kind: 'command', label: 'Run', run: () => source.promise,
        errorMessage: () => {
          controller.dismiss(handle);
          replacement = admit(controller, { id: 'command', title: 'Replacement' });
          return 'Obsolete action failure';
        },
      },
    });
    bridge.invokeAction(lease, handle);
    source.reject(new Error('Action failed'));
    await drainMicrotasks();
    expect(replacement?.generation).not.toBe(handle.generation);
    expect(controller.getSnapshot().notifications).toEqual([
      expect.objectContaining({ handle: replacement, content: expect.objectContaining({ title: 'Replacement' }), action: { status: 'idle' } }),
    ]);
    expect(events.filter((event) => event.type === 'action-failed')).toEqual([]);
  });
});

describe('operation subscriptions without an admitted record', () => {
  it.each(['dismissed', 'rejected'] as const)('notifies a %s operation before dispose releases its subscribers', async (binding) => {
    const { controller } = harness();
    const source = createDeferred<string>();
    if (binding === 'rejected') {
      for (let index = 0; index < 100; index++) admit(controller, `fill-${index}`);
    }
    const operation = controller.track(() => source.promise, messages);
    if (binding === 'dismissed') {
      source.resolve('done');
      await operation.result;
      controller.dismiss(notification(operation));
      expect(operation.getSnapshot().canRetry).toBe(true);
    } else {
      expect(operation.admission).toEqual({ status: 'rejected', reason: 'capacity' });
      expect(operation.getSnapshot().canCancel).toBe(true);
    }
    const observed: OperationSnapshot[] = [];
    operation.subscribe(() => observed.push(operation.getSnapshot()));
    controller.dispose();
    expect(observed).toEqual([expect.objectContaining({ canCancel: false, canRetry: false, notification: null })]);
    if (binding === 'rejected') {
      source.resolve('late');
      await operation.result;
    }
    controller.dispose();
    expect(observed).toHaveLength(1);
  });
});
