import { describe, expect, it, vi } from 'vitest';
import type { Diagnostic, SemanticEvent } from '../../packages/toast/src/contracts/events.js';
import type { ActionResult } from '../../packages/toast/src/contracts/internal.js';
import type { ActionContext, CloseNotice } from '../../packages/toast/src/contracts/notifications.js';
import type { ActionSnapshot } from '../../packages/toast/src/contracts/snapshots.js';
import { acknowledge, admit, attach, current as currentHandles, harness, presentation, record } from '../support/controller-harness.js';
import { createDeferred } from '../support/deferred.js';

async function flushActions(): Promise<void> {
  // ActionResult intentionally has no promise; cross a native microtask/unhandled-rejection checkpoint.
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('command action attempts', () => {
  it('commits pending/token before invoking the handler, rejects reentry and double-click, and closes only on success', async () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const source = createDeferred<void>();
    const states: ActionSnapshot[] = [];
    const contexts: ActionContext[] = [];
    const reentrant: ActionResult[] = [];
    const closed: CloseNotice[] = [];
    const run = vi.fn((context: ActionContext) => {
      contexts.push(context);
      states.push(record(controller, context.handle).action);
      reentrant.push(bridge.invokeAction(lease, context.handle));
      return source.promise;
    });
    const handle = admit(controller, { title: 'Save', action: { kind: 'command', label: 'Save', run }, onClose: (notice) => closed.push(notice) });
    expect(bridge.invokeAction(lease, handle)).toEqual({ status: 'started' });
    expect(states).toEqual([{ status: 'pending', token: contexts[0]!.token }]);
    expect(reentrant).toEqual([{ status: 'rejected', reason: 'already-pending' }]);
    expect(bridge.invokeAction(lease, handle)).toEqual({ status: 'rejected', reason: 'already-pending' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(controller.getHandle(handle.id)).toBe(handle);
    expect(closed).toEqual([]);
    source.resolve();
    await flushActions();
    expect(controller.getHandle(handle.id)).toBeUndefined();
    expect(closed).toEqual([{ handle, reason: 'action-success' }]);
  });

  it('releases a failed attempt, keeps the message available, and permits a fresh successful action token', async () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const first = createDeferred<void>();
    const second = createDeferred<void>();
    const contexts: ActionContext[] = [];
    const events: SemanticEvent[] = [];
    controller.onEvent((event) => events.push(event));
    const run = vi.fn((context: ActionContext) => {
      contexts.push(context);
      return contexts.length === 1 ? first.promise : second.promise;
    });
    const failure = new Error('Server rejected save');
    const errorMessage = vi.fn(() => 'Try saving again');
    const handle = admit(controller, { title: 'Draft', action: { kind: 'command', label: 'Save', run, errorMessage } });
    bridge.invokeAction(lease, handle);
    first.reject(failure);
    await flushActions();
    expect(record(controller, handle)).toMatchObject({ content: { title: 'Draft' }, action: { status: 'failed', token: contexts[0]!.token, message: 'Try saving again' } });
    expect(record(controller, handle).pauseReasons).not.toContain('action-pending');
    expect(errorMessage).toHaveBeenCalledWith(failure);
    expect(bridge.invokeAction(lease, handle)).toEqual({ status: 'started' });
    expect(contexts[1]!.token).not.toBe(contexts[0]!.token);
    expect(record(controller, handle).action).toEqual({ status: 'pending', token: contexts[1]!.token });
    second.resolve();
    await flushActions();
    expect(run).toHaveBeenCalledTimes(2);
    expect(controller.getHandle(handle.id)).toBeUndefined();
    expect(events.filter((event) => event.type === 'action-started')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'action-failed')).toEqual([
      expect.objectContaining({ handle, token: contexts[0]!.token, message: 'Try saving again' }),
    ]);
    expect(events.filter((event) => event.type === 'closed')).toEqual([expect.objectContaining({ handle, reason: 'action-success' })]);
  });

  it('normalizes synchronous throws as action failures and isolates both error mapper and diagnostic exceptions', async () => {
    const diagnostics: Diagnostic[] = [];
    const { controller, bridge } = harness({
      messages: { actionError: 'Не удалось выполнить' },
      onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic); throw new Error('Diagnostic callback failed'); },
    });
    const lease = attach(bridge);
    controller.onEvent((event) => { if (event.type === 'diagnostic') throw new Error('Diagnostic event failed'); });
    const businessError = new Error('Command failed');
    const mapper = vi.fn(() => { throw new Error('Error formatting failed'); });
    const handle = admit(controller, {
      title: 'Action', action: { kind: 'command', label: 'Run', run: () => { throw businessError; }, errorMessage: mapper },
    });
    expect(() => bridge.invokeAction(lease, handle)).not.toThrow();
    await flushActions();
    expect(mapper).toHaveBeenCalledWith(businessError);
    expect(record(controller, handle).action).toMatchObject({ status: 'failed', message: 'Не удалось выполнить' });
    expect(record(controller, handle).pauseReasons).not.toContain('action-pending');
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'mapper-error')).toBe(true);
    expect(diagnostics.length).toBeLessThan(5);
  });

  it('uses the localized action fallback when errorMessage returns invalid output', async () => {
    const diagnostics: Diagnostic[] = [];
    const { controller, bridge } = harness({ messages: { actionError: 'Try again' }, onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
    const lease = attach(bridge);
    const source = createDeferred<void>();
    const handle = admit(controller, { title: 'Draft', action: { kind: 'command', label: 'Save', run: () => source.promise, errorMessage: () => ' ' } });
    bridge.invokeAction(lease, handle);
    source.reject('original error');
    await flushActions();
    expect(record(controller, handle).action).toMatchObject({ status: 'failed', message: 'Try again' });
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'mapper-error')).toBe(true);
  });

  it.each(['value', 'void', 'thenable'] as const)('accepts a synchronous %s handler result', async (mode) => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const run = vi.fn(() => mode === 'value' ? 42 : mode === 'void' ? undefined : { then: (resolve: (value: string) => void) => resolve('done') });
    const handle = admit(controller, { title: 'Command', action: { kind: 'command', label: 'Run', run } });
    expect(bridge.invokeAction(lease, handle)).toEqual({ status: 'started' });
    await flushActions();
    expect(run).toHaveBeenCalledTimes(1);
    expect(controller.getHandle(handle.id)).toBeUndefined();
  });

  it('allows title/progress changes without invalidating an action and rejects action replacement atomically', async () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const source = createDeferred<void>();
    const handle = admit(controller, { title: 'Original', action: { kind: 'command', label: 'Save', run: () => source.promise } });
    acknowledge(bridge, lease, handle);
    const originalPresentation = presentation(bridge, handle);
    bridge.invokeAction(lease, handle);
    const pending = record(controller, handle).action;
    expect(controller.update(handle, { title: 'Working', progress: { kind: 'determinate', value: 0.75 } })).toEqual({ status: 'applied' });
    expect(record(controller, handle).action).toEqual(pending);
    expect(presentation(bridge, handle)).toBe(originalPresentation);
    expect(controller.update(handle, { title: 'Rejected patch', action: null })).toEqual({ status: 'rejected', reason: 'action-pending' });
    expect(record(controller, handle).content.title).toBe('Working');
    source.resolve();
    await flushActions();
    expect(controller.getHandle(handle.id)).toBeUndefined();
  });

  it('allows replacing a failed action and clears its old error without reusing its token', async () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const first = createDeferred<void>();
    const second = createDeferred<void>();
    const handle = admit(controller, { title: 'Command', action: { kind: 'command', label: 'First', run: () => first.promise } });
    bridge.invokeAction(lease, handle);
    first.reject('first failed');
    await flushActions();
    const failure = record(controller, handle).action;
    if (failure.status !== 'failed') throw new Error('Expected failed action');
    expect(controller.update(handle, { action: { kind: 'command', label: 'Second', run: () => second.promise } })).toEqual({ status: 'applied' });
    expect(record(controller, handle).action).toEqual({ status: 'idle' });
    bridge.invokeAction(lease, handle);
    expect(record(controller, handle).action).not.toEqual({ status: 'pending', token: failure.token });
    second.resolve();
    await flushActions();
    expect(controller.getHandle(handle.id)).toBeUndefined();
  });
});

describe('action lifetime, navigation descriptors and scheduler ownership', () => {
  it.each(['resolve', 'reject'] as const)('ignores a late action %s after dismiss/reuse, including its error formatter', async (outcome) => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const source = createDeferred<void>();
    const errorMessage = vi.fn(() => 'Old error');
    const old = admit(controller, { id: 'same', title: 'Old', action: { kind: 'command', label: 'Run', run: () => source.promise, errorMessage } });
    bridge.invokeAction(lease, old);
    controller.dismiss(old);
    const replacement = admit(controller, { id: 'same', title: 'Replacement' });
    const before = controller.getSnapshot();
    if (outcome === 'resolve') source.resolve();
    else source.reject(new Error('Late failure'));
    await flushActions();
    expect(controller.getSnapshot()).toBe(before);
    expect(controller.getHandle('same')).toBe(replacement);
    expect(errorMessage).not.toHaveBeenCalled();
  });

  it.each(['clear', 'dispose'] as const)('detaches action results on %s and does not resurrect records', async (cleanup) => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const sources = [createDeferred<void>(), createDeferred<void>()];
    const errorMessage = vi.fn(() => 'Late error');
    const handles = sources.map((source, index) => admit(controller, {
      title: String(index), action: { kind: 'command', label: 'Run', run: () => source.promise, errorMessage },
    }));
    for (const handle of handles) expect(bridge.invokeAction(lease, handle)).toEqual({ status: 'started' });
    controller[cleanup]();
    const before = controller.getSnapshot();
    sources[0]!.resolve();
    sources[1]!.reject('late failure');
    await flushActions();
    expect(controller.getSnapshot()).toBe(before);
    expect(controller.getSnapshot().notifications).toEqual([]);
    expect(errorMessage).not.toHaveBeenCalled();
    expect(clock.pendingCount).toBe(0);
  });

  it('completes a stacked action without changing the presented record', async () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const source = createDeferred<void>();
    const parked = admit(controller, { title: 'Action', action: { kind: 'command', label: 'Run', run: () => source.promise } });
    const current = admit(controller, { title: 'Read me', duration: null });
    bridge.invokeAction(lease, parked);
    acknowledge(bridge, lease, current);
    const token = presentation(bridge, current);
    source.resolve();
    await flushActions();
    expect(controller.getHandle(parked.id)).toBeUndefined();
    expect(currentHandles(controller)).toEqual([current]);
    expect(bridge.getSnapshot().presentation).toEqual({ handle: current, token, readable: true });
  });

  it('keeps a stacked action available after failure without changing the presented record', async () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const source = createDeferred<void>();
    const queued = admit(controller, { title: 'Stacked', action: { kind: 'command', label: 'Run', run: () => source.promise } });
    const current = admit(controller, { title: 'Current', duration: null });
    expect(bridge.invokeAction(lease, queued)).toEqual({ status: 'started' });
    source.reject(new Error('Failed in queue'));
    await flushActions();
    expect(record(controller, queued).action.status).toBe('failed');
    expect(currentHandles(controller)).toEqual([current]);
    expect(controller.getSnapshot().stack).toEqual([current, queued]);
  });

  it('lets an action finish through detach while rejecting callbacks from the old lease', async () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const source = createDeferred<void>();
    const handle = admit(controller, { title: 'Command', action: { kind: 'command', label: 'Run', run: () => source.promise } });
    bridge.invokeAction(lease, handle);
    bridge.detach(lease);
    const nextLease = attach(bridge);
    expect(bridge.invokeAction(lease, handle)).toEqual({ status: 'rejected', reason: 'stale-lease' });
    expect(bridge.invokeAction(nextLease, handle)).toEqual({ status: 'rejected', reason: 'already-pending' });
    source.resolve();
    await flushActions();
    expect(controller.getHandle(handle.id)).toBeUndefined();
  });

  it('uses one scheduler, pauses an explicit duration while pending, and resumes the exact remaining budget after failure', async () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const source = createDeferred<void>();
    const handle = admit(controller, { title: 'Command', duration: 6000, attention: 'stack', action: { kind: 'command', label: 'Run', run: () => source.promise } });
    acknowledge(bridge, lease, handle);
    clock.advanceBy(2000);
    bridge.invokeAction(lease, handle);
    expect(record(controller, handle).remainingMs).toBe(4000);
    expect(record(controller, handle).pauseReasons).toContain('action-pending');
    expect(clock.pendingCount).toBe(0);
    clock.advanceBy(50_000);
    source.reject('not saved');
    await flushActions();
    expect(record(controller, handle).remainingMs).toBe(4000);
    expect(clock.pendingCount).toBe(1);
    clock.advanceBy(3999);
    expect(controller.getHandle(handle.id)).toBe(handle);
    clock.advanceBy(1);
    expect(controller.getHandle(handle.id)).toBeUndefined();
    expect(clock.pendingCount).toBe(0);
  });

  it('isolates close/semantic callbacks from successful actions and never dispatches links through the command runner', async () => {
    const diagnostics: Diagnostic[] = [];
    const { controller, bridge } = harness({ onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
    const lease = attach(bridge);
    const source = createDeferred<void>();
    const handle = admit(controller, {
      title: 'Command', action: { kind: 'command', label: 'Run', run: () => source.promise },
      onClose: () => { throw new Error('Close observer failed'); },
    });
    controller.onEvent((event) => { if (event.type === 'action-started') throw new Error('Action observer failed'); });
    expect(bridge.invokeAction(lease, handle)).toEqual({ status: 'started' });
    source.resolve();
    await flushActions();
    expect(controller.getHandle(handle.id)).toBeUndefined();
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('listener-error');
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('callback-error');
    const navigation = { kind: 'link' as const, label: 'Open', href: '/destination', target: '_blank' as const, rel: 'external' };
    const link = admit(controller, { title: 'Continue', action: navigation });
    expect(record(controller, link).content.action).toEqual(navigation);
    expect(bridge.invokeAction(lease, link)).toEqual({ status: 'rejected', reason: 'no-command' });
    expect(controller.getHandle(link.id)).toBe(link);
    expect(bridge.dismiss(lease, link, 'navigation')).toEqual({ status: 'applied' });
  });

  it('keeps action and operation tokens independent when a tracked pending message has a command', async () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const business = createDeferred<string>();
    const action = createDeferred<void>();
    const operation = controller.track(business.promise, {
      pending: { title: 'Working', action: { kind: 'command', label: 'Inspect', run: () => action.promise } },
      success: { title: 'Complete' }, error: { title: 'Failed' },
    });
    if (operation.admission.status !== 'created') throw new Error('Expected operation admission');
    const handle = operation.admission.handle;
    bridge.invokeAction(lease, handle);
    const actionState = record(controller, handle).action;
    if (actionState.status !== 'pending') throw new Error('Expected action pending');
    expect(String(actionState.token)).not.toBe(String(operation.token));
    action.resolve();
    await flushActions();
    expect(controller.getHandle(handle.id)).toBeUndefined();
    business.resolve('value');
    await expect(operation.result).resolves.toBe('value');
    expect(operation.getSnapshot().status).toBe('fulfilled');
    expect(controller.getSnapshot().notifications).toEqual([]);
  });

  it.each([
    ['terminal', 'resolve'], ['terminal', 'reject'], ['retry', 'resolve'], ['retry', 'reject'],
  ] as const)('invalidates an action on operation %s replacement before its late %s', async (transition, outcome) => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const firstBusiness = createDeferred<string>();
    const secondBusiness = createDeferred<string>();
    const action = createDeferred<void>();
    const errorMessage = vi.fn(() => 'Obsolete action error');
    const command = { kind: 'command' as const, label: 'Inspect', run: () => action.promise, errorMessage };
    let attempts = 0;
    const operation = controller.track(() => ++attempts === 1 ? firstBusiness.promise : secondBusiness.promise, {
      pending: { title: 'Working', action: command }, success: { title: 'Complete' }, error: { title: 'Failed', action: command },
    });
    if (operation.admission.status !== 'created') throw new Error('Expected operation admission');
    const handle = operation.admission.handle;
    if (transition === 'retry') {
      firstBusiness.reject('first failed');
      await expect(operation.result).rejects.toBe('first failed');
    }
    bridge.invokeAction(lease, handle);
    expect(record(controller, handle).action.status).toBe('pending');
    let retriedResult: Promise<string> | undefined;
    if (transition === 'terminal') {
      firstBusiness.resolve('complete');
      await operation.result;
    } else {
      const retry = operation.retry();
      if (retry.status !== 'started') throw new Error('Expected retry');
      retriedResult = retry.attempt.result;
    }
    expect(record(controller, handle).action).toEqual({ status: 'idle' });
    expect(record(controller, handle).pauseReasons).not.toContain('action-pending');
    const before = controller.getSnapshot();
    if (outcome === 'resolve') action.resolve();
    else action.reject('obsolete failure');
    await flushActions();
    expect(controller.getSnapshot()).toBe(before);
    expect(controller.getHandle(handle.id)).toBe(handle);
    expect(errorMessage).not.toHaveBeenCalled();
    if (retriedResult) {
      secondBusiness.resolve('retry complete');
      await expect(retriedResult).resolves.toBe('retry complete');
      expect(record(controller, handle).kind).toBe('success');
    }
  });
});
