import { StrictMode, useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CloudletProvider, Toaster, createCloudlet, useCloudlet, useOptionalCloudlet,
  type ControllerOptions, type ReactCloudletController, type SemanticEvent,
} from '../../packages/toast/src/index.js';
import { createDeferred } from '../support/deferred.js';

const controllers: ReactCloudletController[] = [];
function controller(options?: ControllerOptions) {
  const instance = createCloudlet(options);
  controllers.push(instance);
  return instance;
}
function tree(instance: ReactCloudletController) {
  return <CloudletProvider controller={instance}><Toaster /></CloudletProvider>;
}
function advance(milliseconds: number) {
  act(() => vi.advanceTimersByTime(milliseconds));
}

beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  controllers.splice(0).forEach((instance) => instance.dispose());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('React controller lifecycle', () => {
  it('returns the exact external controller and never disposes it when Provider unmounts', () => {
    const instance = controller();
    const observed: ReactCloudletController[] = [];
    function Consumer() {
      observed.push(useCloudlet());
      return null;
    }
    const mounted = render(<CloudletProvider controller={instance}><Consumer /></CloudletProvider>);
    expect(observed).toEqual([instance]);
    mounted.unmount();
    expect(instance.show({ title: 'Provider does not own this controller' }).status).toBe('created');
    expect(instance.getSnapshot().disposed).toBe(false);
  });

  it('reports a missing Provider instead of silently making a singleton', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Consumer() {
      useCloudlet();
      return null;
    }
    expect(() => render(<Consumer />)).toThrow(/CloudletProvider/);
  });

  it('acknowledges committed content and spends only six seconds of presented, mounted time', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const instance = controller();
    const events: SemanticEvent[] = [];
    instance.onEvent((event) => events.push(event));
    instance.show({ id: 'first', title: 'First' });
    instance.show({ id: 'second', title: 'Second' });
    advance(20_000);
    expect(vi.getTimerCount()).toBe(0);
    render(tree(instance));
    expect(screen.getByText('Second')).toBeVisible();
    expect(screen.queryByText('First')).not.toBeInTheDocument();
    expect(instance.getSnapshot().notifications[1]?.pauseReasons).toEqual([]);
    expect(events.filter((event) => event.type === 'presented')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(2); // One TTL scheduler and one bounded speech batch.
    advance(300);
    expect(vi.getTimerCount()).toBe(1);
    advance(5_699);
    expect(instance.getHandle('second')).toBeDefined();
    advance(1);
    expect(instance.getHandle('second')).toBeUndefined();
    expect(screen.getByText('First')).toBeVisible();
    expect(instance.getSnapshot().notifications[0]?.remainingMs).toBe(6_000);
    advance(5_999);
    expect(instance.getHandle('first')).toBeDefined();
    advance(1);
    expect(instance.getSnapshot().notifications).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts a null controller: Toaster renders nothing, useOptionalCloudlet returns null and useCloudlet still throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const optional: (ReactCloudletController | null)[] = [];
    function Optional() {
      optional.push(useOptionalCloudlet());
      return null;
    }
    render(<Optional />);
    expect(optional).toEqual([null]);
    expect(() => render(<Toaster />)).toThrow(/CloudletProvider/);
    cleanup();
    function Strict() {
      useCloudlet();
      return null;
    }
    expect(() => render(<CloudletProvider controller={null}><Strict /></CloudletProvider>)).toThrow(/has a controller/);
    cleanup();
    const instance = controller();
    instance.show({ title: 'Waiting for the owner', duration: null });
    const mounted = render(<CloudletProvider controller={null}><Optional /><Toaster /></CloudletProvider>);
    expect(document.querySelector('.cloudlet-host')).toBeNull();
    expect(optional.at(-1)).toBeNull();
    mounted.rerender(<CloudletProvider controller={instance}><Optional /><Toaster /></CloudletProvider>);
    expect(optional.at(-1)).toBe(instance);
    expect(screen.getByText('Waiting for the owner')).toBeInTheDocument();
  });

  it('Toaster autoDismiss overrides the controller option live and restores it when removed', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const instance = controller();
    instance.show({ id: 'saved', title: 'Saved' });
    const mounted = render(<CloudletProvider controller={instance}><Toaster autoDismiss={false} /></CloudletProvider>);
    expect(instance.getSnapshot().notifications[0]?.remainingMs).toBeNull();
    advance(30_000);
    expect(instance.getHandle('saved')).toBeDefined();
    mounted.rerender(<CloudletProvider controller={instance}><Toaster /></CloudletProvider>);
    advance(5_999);
    expect(instance.getHandle('saved')).toBeDefined();
    advance(1);
    expect(instance.getHandle('saved')).toBeUndefined();
    const diagnostics = vi.fn();
    const strict = controller({ autoDismiss: false, onDiagnostic: diagnostics });
    strict.show({ id: 'kept', title: 'Kept' });
    mounted.rerender(<CloudletProvider controller={strict}><Toaster autoDismiss={'yes' as unknown as boolean} /></CloudletProvider>);
    expect(diagnostics).toHaveBeenCalledTimes(1);
    expect(diagnostics.mock.calls[0]?.[0]).toMatchObject({ code: 'invalid-input', source: 'Toaster.autoDismiss' });
    mounted.rerender(<CloudletProvider controller={strict}><Toaster autoDismiss /></CloudletProvider>);
    advance(6_000);
    expect(strict.getHandle('kept')).toBeUndefined();
  });

  it('preserves remaining budget across detach, repeated mount and explicit dispose', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const instance = controller();
    instance.show({ id: 'saved', title: 'Saved' });
    const mounted = render(tree(instance));
    advance(2_000);
    mounted.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(instance.getSnapshot().notifications[0]).toMatchObject({ remainingMs: 4_000, pauseReasons: expect.arrayContaining(['no-host']) });
    advance(30_000);
    expect(instance.getHandle('saved')).toBeDefined();
    const remounted = render(tree(instance));
    advance(3_999);
    expect(instance.getHandle('saved')).toBeDefined();
    advance(1);
    expect(instance.getHandle('saved')).toBeUndefined();
    act(() => { instance.show({ title: 'Another message' }); });
    expect(vi.getTimerCount()).toBe(2);
    act(() => instance.dispose());
    expect(vi.getTimerCount()).toBe(0);
    expect(instance.getSnapshot().disposed).toBe(true);
    expect(screen.queryByText('Another message')).not.toBeInTheDocument();
    remounted.unmount();
    expect(instance.show({ title: 'Too late' })).toEqual({ status: 'rejected', reason: 'disposed' });
  });

  it('survives Strict Mode with one TTL scheduler, one bounded speech batch and one first presentation', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const diagnostics = vi.fn();
    const instance = controller({ onDiagnostic: diagnostics });
    const events: SemanticEvent[] = [];
    instance.onEvent((event) => events.push(event));
    instance.show({ title: 'Strict mode message' });
    const mounted = render(<StrictMode>{tree(instance)}</StrictMode>);
    expect(screen.getAllByText('Strict mode message')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(2);
    advance(300);
    expect(vi.getTimerCount()).toBe(1);
    expect(events.filter((event) => event.type === 'presented' && event.firstPresentation)).toHaveLength(1);
    expect(diagnostics).not.toHaveBeenCalled();
    mounted.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(instance.getSnapshot().disposed).toBe(false);
  });

  it('preserves a running operation across detach and acknowledges its terminal content on remount', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const instance = controller();
    const source = createDeferred<string>();
    let signal: AbortSignal | undefined;
    const operation = instance.track((context) => {
      signal = context.signal;
      return source.promise;
    }, { pending: { title: 'Saving while mounted' }, success: { title: 'Saved while detached' }, error: { title: 'Failed' } });
    const mounted = render(tree(instance));
    mounted.unmount();
    expect(signal?.aborted).toBe(false);
    await act(async () => { source.resolve('original result'); });
    await expect(operation.result).resolves.toBe('original result');
    expect(operation.getSnapshot().status).toBe('fulfilled');
    advance(30_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(instance.getSnapshot().notifications[0]?.remainingMs).toBe(6_000);
    render(tree(instance));
    expect(screen.getByText('Saved while detached')).toBeVisible();
    expect(instance.getSnapshot().notifications[0]?.pauseReasons).toEqual([]);
    advance(6_000);
    expect(instance.getSnapshot().notifications).toHaveLength(0);
  });

  it('rejects a second host and leaves the owning host alive when the rejected one unmounts', () => {
    const diagnostics = vi.fn();
    const instance = controller({ onDiagnostic: diagnostics });
    instance.show({ title: 'One owner', duration: null });
    const first = render(tree(instance));
    const second = render(tree(instance));
    expect(screen.getAllByText('One owner')).toHaveLength(1);
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ code: 'second-host' }));
    second.unmount();
    expect(screen.getByText('One owner')).toBeVisible();
    expect(instance.getSnapshot().notifications[0]?.pauseReasons).not.toContain('no-host');
    first.unmount();
    expect(instance.getSnapshot().notifications[0]?.pauseReasons).toContain('no-host');
    render(tree(instance));
    expect(screen.getByText('One owner')).toBeVisible();
  });

  it('keeps identical logical IDs in independent controllers isolated', () => {
    const first = controller();
    const second = controller();
    first.show({ id: 'same', title: 'First instance', duration: null });
    second.show({ id: 'same', title: 'Second instance', duration: null });
    render(<>{tree(first)}{tree(second)}</>);
    expect(screen.getByText('First instance')).toBeVisible();
    expect(screen.getByText('Second instance')).toBeVisible();
    act(() => first.clear());
    expect(screen.queryByText('First instance')).not.toBeInTheDocument();
    expect(screen.getByText('Second instance')).toBeVisible();
    expect(second.getHandle('same')).toBeDefined();
  });

  it('keeps events admitted in child mount effects until the host attaches', () => {
    const instance = controller();
    function Producer() {
      const owned = useCloudlet();
      useEffect(() => { owned.show({ id: 'from-effect', title: 'Effect event', duration: null }); }, [owned]);
      return null;
    }
    render(<CloudletProvider controller={instance}><Producer /><Toaster /></CloudletProvider>);
    expect(screen.getByText('Effect event')).toBeVisible();
    expect(instance.getHandle('from-effect')).toBeDefined();
  });

  it('combines visibility and window-focus pauses without losing elapsed readable time', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const instance = controller();
    instance.show({ title: 'Pause me' });
    render(tree(instance));
    advance(1_000);
    visibility.mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('blur'));
    expect(instance.getSnapshot().notifications[0]?.pauseReasons).toEqual(expect.arrayContaining(['document-hidden', 'window-blur']));
    advance(10_000);
    visibility.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    expect(instance.getSnapshot().notifications[0]?.pauseReasons).toContain('window-blur');
    expect(instance.getSnapshot().notifications[0]?.pauseReasons).not.toContain('document-hidden');
    advance(10_000);
    expect(instance.getSnapshot().notifications[0]?.remainingMs).toBe(5_000);
    fireEvent(window, new Event('focus'));
    advance(4_999);
    expect(screen.getByText('Pause me')).toBeVisible();
    advance(1);
    expect(screen.queryByText('Pause me')).not.toBeInTheDocument();
  });

  it.each(['detach', 'dispose'] as const)('removes its document/window listeners on %s and ignores later browser events', (release) => {
    const documentAdd = vi.spyOn(document, 'addEventListener');
    const documentRemove = vi.spyOn(document, 'removeEventListener');
    const windowAdd = vi.spyOn(window, 'addEventListener');
    const windowRemove = vi.spyOn(window, 'removeEventListener');
    const instance = controller();
    instance.show({ title: 'Keep detached', duration: null });
    const mounted = render(tree(instance));
    if (release === 'detach') mounted.unmount();
    else act(() => instance.dispose());
    for (const [kind, listener] of documentAdd.mock.calls.filter(([kind]) => kind === 'visibilitychange')) {
      expect(documentRemove.mock.calls.some(([removedKind, removed]) => removedKind === kind && removed === listener)).toBe(true);
    }
    for (const [kind, listener] of windowAdd.mock.calls.filter(([kind]) => kind === 'focus' || kind === 'blur')) {
      expect(windowRemove.mock.calls.some(([removedKind, removed]) => removedKind === kind && removed === listener)).toBe(true);
    }
    const snapshot = instance.getSnapshot();
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('blur'));
    fireEvent(window, new Event('focus'));
    expect(instance.getSnapshot()).toBe(snapshot);
  });
});
