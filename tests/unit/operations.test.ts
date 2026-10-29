import { describe, expect, it, vi } from 'vitest';
import type { Diagnostic, SemanticEvent } from '../../packages/toast/src/contracts/events.js';
import type { NotificationHandle } from '../../packages/toast/src/contracts/identity.js';
import type { NotificationContent } from '../../packages/toast/src/contracts/notifications.js';
import type { OperationContext, OperationHandle, OperationSource, TrackOptions } from '../../packages/toast/src/contracts/operations.js';
import { acknowledge, admit, attach, harness, presentation, record } from '../support/controller-harness.js';
import { createDeferred } from '../support/deferred.js';

function messages(id?: string): TrackOptions<string, unknown> {
  return {
    ...(id === undefined ? {} : { id }),
    pending: { title: 'Working' },
    success: (value) => ({ title: `Saved ${value}` }),
    error: { title: 'Could not save' },
  };
}

function notification<T>(operation: OperationHandle<T>): NotificationHandle {
  if (operation.admission.status !== 'created') throw new Error('Expected admitted operation');
  return operation.admission.handle;
}

describe('operation attempts and UI ownership', () => {
  it.each(['fulfill', 'reject'] as const)('assimilates a thenable once and preserves its receiver and %s outcome', async (outcome) => {
    const { controller } = harness();
    const businessError = new Error('Business failure');
    const secondReadError = new Error('Then getter was read twice');
    let reads = 0;
    const then = vi.fn(function (this: unknown, resolve: (value: string) => void, reject: (reason: unknown) => void) {
      expect(this).toBe(source);
      if (outcome === 'fulfill') resolve('business value');
      else reject(businessError);
    });
    const source = Object.defineProperty({}, 'then', {
      get: () => {
        if (++reads > 1) throw secondReadError;
        return then;
      },
    }) as PromiseLike<string>;
    const operation = controller.track(source, messages());
    if (outcome === 'fulfill') await expect(operation.result).resolves.toBe('business value');
    else await expect(operation.result).rejects.toBe(businessError);
    expect(reads).toBe(1);
    expect(then).toHaveBeenCalledTimes(1);
    expect(record(controller, notification(operation)).kind).toBe(outcome === 'fulfill' ? 'success' : 'error');
  });

  it('settles A/B/C in reverse order without merging operations, records, values, or events', async () => {
    const { controller } = harness();
    const events: SemanticEvent[] = [];
    controller.onEvent((event) => events.push(event));
    const sources = ['A', 'B', 'C'].map(() => createDeferred<string>());
    const operations = sources.map((source, index) => controller.track(source.promise, messages(['A', 'B', 'C'][index])));
    const handles = operations.map(notification);
    expect(new Set(operations.map((operation) => operation.token)).size).toBe(3);
    for (const index of [2, 1, 0]) {
      sources[index]!.resolve(String(index));
      await expect(operations[index]!.result).resolves.toBe(String(index));
      expect(record(controller, handles[index]!).content.title).toBe(`Saved ${index}`);
      for (let earlier = 0; earlier < index; earlier++) {
        expect(record(controller, handles[earlier]!).kind).toBe('loading');
      }
    }
    expect(controller.getSnapshot().notifications.map((item) => item.handle.id)).toEqual(['A', 'B', 'C']);
    expect(events.filter((event) => event.type === 'operation-settled').map((event) => ({
      id: event.handle?.id, status: event.status, uiApplied: event.uiApplied,
    }))).toEqual([
      { id: 'C', status: 'fulfilled', uiApplied: true },
      { id: 'B', status: 'fulfilled', uiApplied: true },
      { id: 'A', status: 'fulfilled', uiApplied: true },
    ]);
  });

  it.each(['resolve', 'reject'] as const)('ignores a late %s after dismiss and reuse of the same ID', async (outcome) => {
    const { controller } = harness();
    const source = createDeferred<string>();
    const mapper = vi.fn(() => ({ title: 'Obsolete result' }));
    const events: SemanticEvent[] = [];
    controller.onEvent((event) => events.push(event));
    const operation = controller.track(source.promise, { ...messages('same'), success: mapper, error: mapper });
    const oldHandle = notification(operation);
    controller.dismiss(oldHandle);
    const current = admit(controller, { id: 'same', title: 'Replacement', progress: { kind: 'determinate', value: 0.4 } });
    const before = controller.getSnapshot();
    const failure = new Error('Old request');
    if (outcome === 'resolve') {
      source.resolve('old');
      await expect(operation.result).resolves.toBe('old');
    } else {
      source.reject(failure);
      await expect(operation.result).rejects.toBe(failure);
    }
    expect(current.generation).not.toBe(oldHandle.generation);
    expect(controller.getSnapshot()).toBe(before);
    expect(record(controller, current).content.title).toBe('Replacement');
    expect(mapper).not.toHaveBeenCalled();
    expect(events.filter((event) => event.type === 'operation-settled')).toEqual([
      expect.objectContaining({ token: operation.token, handle: oldHandle, uiApplied: false }),
    ]);
  });

  it('preserves the operation and presentation tokens across title/progress updates', async () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const source = createDeferred<string>();
    const operation = controller.track(source.promise, {
      ...messages(), pending: { title: 'Pending', description: { kind: 'text', text: 'Temporary' }, progress: { kind: 'indeterminate' } },
    });
    const handle = notification(operation);
    acknowledge(bridge, lease, handle);
    const pendingPresentation = presentation(bridge, handle);
    expect(controller.update(handle, { title: 'Halfway', progress: { kind: 'determinate', value: 0.5 } })).toEqual({ status: 'applied' });
    expect(record(controller, handle).operation?.token).toBe(operation.token);
    expect(presentation(bridge, handle)).toBe(pendingPresentation);
    expect(controller.update(handle, { title: 'Must not change', kind: 'success' })).toEqual({ status: 'rejected', reason: 'operation-owned' });
    expect(controller.update(handle, { duration: 1 })).toEqual({ status: 'rejected', reason: 'operation-owned' });
    expect(record(controller, handle).content.title).toBe('Halfway');
    source.resolve('complete');
    await operation.result;
    expect(record(controller, handle)).toMatchObject({ kind: 'success', content: { title: 'Saved complete' }, operation: { token: operation.token, status: 'fulfilled' } });
    expect(record(controller, handle).content.progress).toBeUndefined();
    expect(record(controller, handle).content.description).toBeUndefined();
    expect(presentation(bridge, handle)).not.toBe(pendingPresentation);
    expect(controller.update(handle, { kind: 'info' })).toEqual({ status: 'rejected', reason: 'operation-owned' });
  });

  it('retries a terminal factory once per request with a new signal/token and an immutable first attempt', async () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const contexts: OperationContext[] = [];
    const factory = vi.fn((context: OperationContext) => {
      contexts.push(context);
      return contexts.length === 1 ? first.promise : second.promise;
    });
    const operation = controller.track(factory, messages());
    const handle = notification(operation);
    const initialResult = operation.result;
    const initialAdmission = operation.admission;
    expect(operation.retry()).toEqual({ status: 'rejected', reason: 'already-pending' });
    const error = new Error('First failed');
    first.reject(error);
    await expect(initialResult).rejects.toBe(error);
    const retried = operation.retry();
    if (retried.status !== 'started') throw new Error('Expected retry');
    expect(factory).toHaveBeenCalledTimes(2);
    expect(retried.attempt.attempt).toBe(2);
    expect(retried.attempt.token).not.toBe(operation.token);
    expect(contexts[1]!.signal).not.toBe(contexts[0]!.signal);
    expect(contexts[1]!.signal.aborted).toBe(false);
    expect(record(controller, handle).operation?.token).toBe(retried.attempt.token);
    expect(bridge.retryOperation(lease, handle, operation.token)).toEqual({ status: 'rejected', reason: 'stale-operation-token' });
    expect(bridge.cancelOperation(lease, handle, operation.token)).toEqual({ status: 'rejected', reason: 'stale-operation-token' });
    second.resolve('second');
    await expect(retried.attempt.result).resolves.toBe('second');
    expect(operation.token).toBe(contexts[0]!.token);
    expect(operation.attempt).toBe(1);
    expect(operation.result).toBe(initialResult);
    expect(operation.admission).toBe(initialAdmission);
    expect(operation.getSnapshot()).toMatchObject({ token: retried.attempt.token, attempt: 2, status: 'fulfilled', canRetry: true });
    expect(record(controller, handle).content.title).toBe('Saved second');
  });

  it.each(['resolve', 'reject'] as const)('detaches a running attempt before restart and ignores its late %s', async (outcome) => {
    const { controller } = harness();
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const contexts: OperationContext[] = [];
    const mapper = vi.fn((value: string) => ({ title: value }));
    const operation = controller.track((context) => {
      contexts.push(context);
      return contexts.length === 1 ? first.promise : second.promise;
    }, { ...messages(), success: mapper });
    const handle = notification(operation);
    const restarted = operation.restart();
    if (restarted.status !== 'started') throw new Error('Expected restart');
    expect(contexts[0]!.signal.aborted).toBe(true);
    expect(contexts[1]!.signal.aborted).toBe(false);
    expect(restarted.attempt.token).not.toBe(operation.token);
    const current = controller.getSnapshot();
    if (outcome === 'resolve') {
      first.resolve('stale');
      await expect(operation.result).resolves.toBe('stale');
    } else {
      const error = new Error('Stale failure');
      first.reject(error);
      await expect(operation.result).rejects.toBe(error);
    }
    expect(controller.getSnapshot()).toBe(current);
    expect(operation.getSnapshot()).toMatchObject({ token: restarted.attempt.token, status: 'pending', cancelRequested: false });
    expect(mapper).not.toHaveBeenCalled();
    second.resolve('latest');
    await restarted.attempt.result;
    expect(record(controller, handle).content.title).toBe('latest');
    expect(mapper).toHaveBeenCalledTimes(1);
  });

  it('keeps a dismissed operation retryable without readmitting or touching a reused ID', async () => {
    const { controller } = harness();
    const attempts = [createDeferred<string>(), createDeferred<string>()];
    let index = 0;
    const operation = controller.track(() => attempts[index++]!.promise, messages('original'));
    controller.dismiss(notification(operation));
    const replacement = admit(controller, { id: 'original', title: 'New generation' });
    attempts[0]!.reject('first');
    await expect(operation.result).rejects.toBe('first');
    const retry = operation.retry();
    if (retry.status !== 'started') throw new Error('Expected detached retry');
    attempts[1]!.resolve('second');
    await retry.attempt.result;
    expect(controller.getSnapshot().notifications).toHaveLength(1);
    expect(record(controller, replacement).content.title).toBe('New generation');
  });
});

describe('operation admission and failure isolation', () => {
  it('starts a factory with pending committed and preserves its business result at capacity', async () => {
    const { controller } = harness();
    const observations: string[] = [];
    const first = controller.track(() => {
      observations.push(controller.getSnapshot().notifications[0]?.operation?.status ?? 'missing');
      return 'first';
    }, messages('first'));
    await first.result;
    for (let index = 0; index < 99; index++) admit(controller, `fill-${index}`);
    const source = createDeferred<string>();
    const mapper = vi.fn(() => ({ title: 'Unshown' }));
    const factory = vi.fn(() => source.promise);
    const overflow = controller.track(factory, { ...messages('overflow'), success: mapper });
    expect(observations).toEqual(['pending']);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(overflow.admission).toEqual({ status: 'rejected', reason: 'capacity' });
    expect(overflow.getSnapshot()).toMatchObject({ status: 'pending', notification: null });
    expect(controller.getSnapshot().overflow).toEqual({ count: 1, pending: true });
    controller.clear();
    source.resolve('business value');
    await expect(overflow.result).resolves.toBe('business value');
    expect(controller.getSnapshot().notifications).toEqual([]);
    expect(mapper).not.toHaveBeenCalled();
  });

  it.each(['invalid-input', 'id-conflict', 'disposed'] as const)('executes a valid source despite %s admission', async (reason) => {
    const { controller } = harness();
    if (reason === 'id-conflict') admit(controller, 'taken');
    if (reason === 'disposed') controller.dispose();
    const options = reason === 'invalid-input'
      ? { ...messages(), pending: { title: '' } }
      : messages('taken');
    const source = createDeferred<string>();
    const factory = vi.fn(() => source.promise);
    const operation = controller.track(factory, options);
    expect(operation.admission).toMatchObject({ status: 'rejected', reason });
    expect(factory).toHaveBeenCalledTimes(1);
    source.resolve('business');
    await expect(operation.result).resolves.toBe('business');
    expect(operation.getSnapshot().status).toBe('fulfilled');
    expect(controller.getSnapshot().overflow.count).toBe(0);
    if (reason === 'disposed') {
      expect(operation.retry()).toEqual({ status: 'rejected', reason: 'disposed' });
      expect(operation.restart()).toEqual({ status: 'rejected', reason: 'disposed' });
      expect(operation.cancel()).toEqual({ status: 'rejected', reason: 'disposed' });
    }
  });

  it('rejects invalid sources synchronously and forbids track dedupe/cancel-for-factory without suppressing valid work', async () => {
    const { controller } = harness();
    expect(() => controller.track(42 as unknown as OperationSource<string>, messages())).toThrow(TypeError);
    expect(controller.getSnapshot().notifications).toEqual([]);
    const cancel = vi.fn();
    const factory = vi.fn(() => 'value');
    const operation = controller.track(factory, { ...messages(), cancel });
    expect(operation.admission).toMatchObject({ status: 'rejected', reason: 'invalid-input' });
    await expect(operation.result).resolves.toBe('value');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    const illegalDedupe = { ...messages(), dedupeKey: 'shared' } as unknown as TrackOptions<string, unknown>;
    const deduped = controller.track(() => 'still runs', illegalDedupe);
    expect(deduped.admission).toMatchObject({ status: 'rejected', reason: 'invalid-input' });
    await expect(deduped.result).resolves.toBe('still runs');
    expect(controller.getSnapshot().notifications).toEqual([]);
  });

  it.each(['sync', 'async'] as const)('normalizes %s rejection while preserving the exact original reason', async (mode) => {
    const { controller, clock } = harness();
    const error = { failure: 'business', secret: 'not in UI' };
    const source = createDeferred<string>();
    const operation = controller.track<string>(mode === 'sync' ? () => { throw error; } : source.promise, messages());
    if (mode === 'async') source.reject(error);
    await expect(operation.result).rejects.toBe(error);
    expect(operation.getSnapshot().status).toBe('rejected');
    expect(record(controller, notification(operation))).toMatchObject({ kind: 'error', content: { title: 'Could not save' }, remainingMs: null });
    expect(clock.pendingCount).toBe(0);
  });

  it.each([
    ['fulfilled', 'throw'], ['fulfilled', 'invalid'], ['rejected', 'throw'], ['rejected', 'invalid'],
    ['cancelled', 'throw'], ['cancelled', 'invalid'],
  ] as const)('isolates a %s mapper that returns %s output and a throwing diagnostic listener', async (status, behavior) => {
    const diagnostics: Diagnostic[] = [];
    const { controller } = harness({
      messages: { operationSuccess: 'Done', operationError: 'Error', operationCancelled: 'Cancelled' },
      onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic); throw new Error('Diagnostic callback'); },
    });
    controller.onEvent((event) => { if (event.type === 'diagnostic') throw new Error('Diagnostic event listener'); });
    const source = createDeferred<string>();
    const mapper = vi.fn((): NotificationContent<unknown> => {
      if (behavior === 'throw') throw new Error('Mapper failed');
      return { title: '' };
    });
    const operation = controller.track(() => source.promise, { ...messages(), success: mapper, error: mapper, cancelled: mapper });
    const error = Object.assign(new Error('Raw business error'), { name: status === 'cancelled' ? 'AbortError' : 'Error' });
    if (status === 'fulfilled') {
      source.resolve('original value');
      await expect(operation.result).resolves.toBe('original value');
    } else {
      if (status === 'cancelled') operation.cancel();
      source.reject(error);
      await expect(operation.result).rejects.toBe(error);
    }
    expect(operation.getSnapshot().status).toBe(status);
    expect(record(controller, notification(operation))).toMatchObject({
      kind: status === 'fulfilled' ? 'success' : status === 'cancelled' ? 'warning' : 'error',
      content: { title: status === 'fulfilled' ? 'Done' : status === 'cancelled' ? 'Cancelled' : 'Error' },
    });
    expect(mapper).toHaveBeenCalledTimes(1);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'mapper-error')).toBe(true);
    expect(diagnostics.length).toBeLessThan(5);
  });

  it('handles ignored rejected results without creating unhandled secondary rejections', async () => {
    const { controller } = harness();
    const source = createDeferred<string>();
    const operation = controller.track(source.promise, { ...messages(), error: () => { throw new Error('Mapper'); } });
    source.reject(new Error('Ignored by application'));
    // Give the native event loop an unhandled-rejection checkpoint; Vitest fails on any leak.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(operation.getSnapshot().status).toBe('rejected');
    expect(record(controller, notification(operation)).kind).toBe('error');
  });
});

describe('cooperative operation cancellation and resource lifetime', () => {
  it('publishes cancelRequested before abort and remains fulfilled when cooperative work resolves', async () => {
    const { controller } = harness();
    const source = createDeferred<string>();
    const seen: unknown[] = [];
    let context!: OperationContext;
    const operation = controller.track((nextContext) => { context = nextContext; return source.promise; }, messages());
    context.signal.addEventListener('abort', () => seen.push(operation.getSnapshot()));
    const reason = new Error('Stop requested');
    expect(operation.cancel(reason)).toEqual({ status: 'requested' });
    expect(operation.getSnapshot()).toMatchObject({ status: 'pending', cancelRequested: true });
    expect(seen).toEqual([expect.objectContaining({ status: 'pending', cancelRequested: true })]);
    expect(context.signal.reason).toBe(reason);
    expect(operation.cancel()).toEqual({ status: 'unchanged', reason: 'already-requested' });
    source.resolve('actually saved');
    await expect(operation.result).resolves.toBe('actually saved');
    expect(operation.getSnapshot()).toMatchObject({ status: 'fulfilled', cancelRequested: true });
    expect(record(controller, notification(operation)).kind).toBe('success');
    expect(operation.cancel()).toEqual({ status: 'unchanged', reason: 'settled' });
  });

  it.each([
    [true, 'AbortError', 'cancelled'], [false, 'AbortError', 'rejected'], [true, 'NetworkError', 'rejected'],
  ] as const)('classifies requested=%s, name=%s as %s without rewriting rejection', async (requested, name, status) => {
    const { controller } = harness();
    const source = createDeferred<string>();
    const operation = controller.track(() => source.promise, messages());
    if (requested) operation.cancel();
    const error = { name, message: 'Failure' };
    source.reject(error);
    await expect(operation.result).rejects.toBe(error);
    expect(operation.getSnapshot().status).toBe(status);
    expect(record(controller, notification(operation))).toMatchObject({ kind: status === 'cancelled' ? 'warning' : 'error' });
  });

  it('allows a custom cancellation protocol and isolates classifier exceptions as ordinary rejection', async () => {
    const diagnostics: Diagnostic[] = [];
    const { controller } = harness({ onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
    const sources = [createDeferred<string>(), createDeferred<string>()];
    const classifier = vi.fn(() => true);
    const cancelled = controller.track(sources[0]!.promise, { ...messages(), isCancellation: classifier });
    const failed = controller.track(() => sources[1]!.promise, {
      ...messages(), isCancellation: () => { throw new Error('Classifier failed'); },
    });
    failed.cancel();
    const firstError = { protocol: 'STOPPED' };
    const secondError = { name: 'AbortError' };
    sources[0]!.reject(firstError);
    sources[1]!.reject(secondError);
    await expect(cancelled.result).rejects.toBe(firstError);
    await expect(failed.result).rejects.toBe(secondError);
    expect(cancelled.getSnapshot()).toMatchObject({ status: 'cancelled', cancelRequested: false });
    expect(failed.getSnapshot().status).toBe('rejected');
    expect(classifier).toHaveBeenCalledWith(firstError, expect.objectContaining({ token: cancelled.token, attempt: 1 }));
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'cancellation-error')).toBe(true);
  });

  it('requires a mechanism for promise cancellation and isolates a throwing cancellation callback', async () => {
    const diagnostics: Diagnostic[] = [];
    const { controller } = harness({ onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
    const sources = [createDeferred<string>(), createDeferred<string>()];
    const plain = controller.track(sources[0]!.promise, messages());
    expect(plain.getSnapshot()).toMatchObject({ canCancel: false, canRetry: false });
    expect(plain.cancel()).toEqual({ status: 'rejected', reason: 'not-cancellable' });
    expect(plain.retry()).toEqual({ status: 'rejected', reason: 'not-retryable' });
    expect(plain.restart()).toEqual({ status: 'rejected', reason: 'not-retryable' });
    const observations: unknown[] = [];
    const cancel = vi.fn((reason: unknown) => {
      observations.push({ reason, snapshot: controlled.getSnapshot() });
      throw new Error('Cancel mechanism failed');
    });
    const controlled = controller.track(sources[1]!.promise, { ...messages(), cancel });
    expect(controlled.cancel()).toEqual({ status: 'requested' });
    expect(controlled.cancel()).toEqual({ status: 'unchanged', reason: 'already-requested' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(observations).toEqual([expect.objectContaining({ reason: expect.objectContaining({ name: 'AbortError' }), snapshot: expect.objectContaining({ status: 'pending', cancelRequested: true }) })]);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'cancellation-error')).toBe(true);
    sources[0]!.resolve('plain');
    sources[1]!.resolve('controlled');
    await expect(plain.result).resolves.toBe('plain');
    await expect(controlled.result).resolves.toBe('controlled');
  });

  it.each(['dismiss', 'clear', 'dispose'] as const)('does not abort on %s and ignores late results without invoking mappers', async (cleanup) => {
    const { controller, clock } = harness();
    const source = createDeferred<string>();
    const mapper = vi.fn(() => ({ title: 'Too late' }));
    let context!: OperationContext;
    const operation = controller.track((next) => { context = next; return source.promise; }, { ...messages(), success: mapper });
    if (cleanup === 'dismiss') controller.dismiss(notification(operation));
    else controller[cleanup]();
    expect(context.signal.aborted).toBe(false);
    const before = controller.getSnapshot();
    source.resolve('business continues');
    await expect(operation.result).resolves.toBe('business continues');
    expect(controller.getSnapshot()).toBe(before);
    expect(controller.getSnapshot().notifications).toEqual([]);
    expect(mapper).not.toHaveBeenCalled();
    expect(clock.pendingCount).toBe(0);
  });

  it('keeps live bindings through renderer detach and waits for a new host/presentation before TTL', async () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const source = createDeferred<string>();
    const operation = controller.track(() => source.promise, messages());
    const handle = notification(operation);
    acknowledge(bridge, lease, handle);
    bridge.detach(lease);
    source.resolve('detached');
    await operation.result;
    expect(record(controller, handle)).toMatchObject({ kind: 'success', content: { title: 'Saved detached' }, remainingMs: 6000 });
    clock.advanceBy(50_000);
    expect(controller.getHandle(handle.id)).toBe(handle);
    expect(clock.pendingCount).toBe(0);
    const nextLease = attach(bridge);
    expect(bridge.cancelOperation(lease, handle, operation.token)).toEqual({ status: 'rejected', reason: 'stale-lease' });
    expect(bridge.retryOperation(lease, handle, operation.token)).toEqual({ status: 'rejected', reason: 'stale-lease' });
    acknowledge(bridge, nextLease, handle);
    clock.advanceBy(6000);
    expect(controller.getHandle(handle.id)).toBeUndefined();
  });
});

describe('operation budgets, observations and renderer commands', () => {
  it('keeps pending/error persistent and starts a complete success budget only after current terminal presentation', async () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const successSource = createDeferred<string>();
    const failureSource = createDeferred<string>();
    const failure = controller.track(failureSource.promise, messages());
    const success = controller.track(successSource.promise, messages());
    const successHandle = notification(success);
    const errorHandle = notification(failure);
    acknowledge(bridge, lease, successHandle);
    const oldPresentation = presentation(bridge, successHandle);
    clock.advanceBy(100_000);
    expect(record(controller, successHandle).remainingMs).toBeNull();
    expect(clock.pendingCount).toBe(0);
    successSource.resolve('done');
    failureSource.reject('failed');
    await success.result;
    await expect(failure.result).rejects.toBe('failed');
    expect(clock.pendingCount).toBe(0);
    expect(record(controller, successHandle).remainingMs).toBe(6000);
    expect(record(controller, errorHandle).remainingMs).toBeNull();
    expect(bridge.acknowledgePresentation(lease, successHandle, oldPresentation)).toEqual({ status: 'rejected', reason: 'stale-presentation' });
    clock.advanceBy(100_000);
    acknowledge(bridge, lease, successHandle);
    expect(clock.pendingCount).toBe(1);
    clock.advanceBy(5999);
    expect(controller.getHandle(successHandle.id)).toBe(successHandle);
    clock.advanceBy(1);
    expect(controller.getHandle(successHandle.id)).toBeUndefined();
    acknowledge(bridge, lease, errorHandle);
    clock.advanceBy(100_000);
    expect(controller.getHandle(errorHandle.id)).toBe(errorHandle);
    expect(clock.pendingCount).toBe(0);
  });

  it('does not spend a stacked success budget or start timers for autoDismiss=false', async () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const operation = controller.track(() => 'queued', messages());
    const blocker = admit(controller, { title: 'Read first', duration: null });
    acknowledge(bridge, lease, blocker);
    await operation.result;
    const handle = notification(operation);
    clock.advanceBy(100_000);
    expect(record(controller, handle).remainingMs).toBe(6000);
    controller.dismiss(blocker);
    acknowledge(bridge, lease, handle);
    clock.advanceBy(6000);
    expect(controller.getHandle(handle.id)).toBeUndefined();

    const persistent = harness({ autoDismiss: false });
    const persistentLease = attach(persistent.bridge);
    const persistentOperation = persistent.controller.track(() => 'persistent', { ...messages(), success: { title: 'Success', duration: 1 } });
    await persistentOperation.result;
    const persistentHandle = notification(persistentOperation);
    acknowledge(persistent.bridge, persistentLease, persistentHandle);
    persistent.clock.advanceBy(100_000);
    expect(persistent.controller.getHandle(persistentHandle.id)).toBe(persistentHandle);
    expect(persistent.clock.pendingCount).toBe(0);
  });

  it('guards bridge operations, resets announcement phases on retry, and preserves current attempt snapshots', async () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const ordinary = admit(controller, 'ordinary');
    const sources = [createDeferred<string>(), createDeferred<string>()];
    let index = 0;
    const operation = controller.track(() => sources[index++]!.promise, messages());
    const handle = notification(operation);
    expect(bridge.retryOperation(lease, ordinary, operation.token)).toEqual({ status: 'rejected', reason: 'no-operation' });
    expect(bridge.cancelOperation(lease, ordinary, operation.token)).toEqual({ status: 'rejected', reason: 'no-operation' });
    expect(bridge.acknowledgeAnnouncements(lease, [{ kind: 'operation', handle, token: operation.token, phase: 'fulfilled' }])).toEqual({ status: 'rejected', reason: 'invalid-input' });
    expect(bridge.acknowledgeAnnouncements(lease, [{ kind: 'operation', handle, token: operation.token, phase: 'started' }])).toEqual({ status: 'applied' });
    const initial = operation.getSnapshot();
    const listener = vi.fn();
    const unsubscribe = operation.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
    expect(operation.getSnapshot()).toBe(initial);
    expect(Object.isFrozen(initial)).toBe(true);
    sources[0]!.reject('try again');
    await expect(operation.result).rejects.toBe('try again');
    expect(listener).toHaveBeenCalled();
    expect(initial.status).toBe('pending');
    const retry = bridge.retryOperation(lease, handle, operation.token);
    if (retry.status !== 'started') throw new Error('Expected bridge retry');
    expect(bridge.getSnapshot().announcements.notifications.find((entry) => entry.handle === handle)?.operation).toEqual({ token: retry.token, phases: [] });
    expect(bridge.acknowledgeAnnouncements(lease, [{ kind: 'operation', handle, token: operation.token, phase: 'fulfilled' }])).toEqual({ status: 'rejected', reason: 'stale-operation-token' });
    unsubscribe();
    unsubscribe();
    const calls = listener.mock.calls.length;
    const settled = createDeferred<void>();
    const stop = controller.onEvent((event) => {
      if (event.type === 'operation-settled' && event.token === retry.token) settled.resolve();
    });
    sources[1]!.resolve('success');
    await settled.promise;
    stop();
    expect(listener).toHaveBeenCalledTimes(calls);
    expect(operation.getSnapshot()).toMatchObject({ token: retry.token, status: 'fulfilled' });
  });
});
