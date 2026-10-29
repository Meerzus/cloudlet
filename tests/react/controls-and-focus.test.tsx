import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CloudletProvider, Toaster, createCloudlet,
  type ControllerOptions, type ReactCloudletController,
} from '../../packages/toast/src/index.js';
import { createDeferred } from '../support/deferred.js';

const controllers: ReactCloudletController[] = [];
const outsideElements: Element[] = [];
function controller(options?: ControllerOptions) {
  const instance = createCloudlet(options);
  controllers.push(instance);
  return instance;
}
function tree(instance: ReactCloudletController) {
  return <CloudletProvider controller={instance}><Toaster /></CloudletProvider>;
}
function externalButton() {
  const button = document.createElement('button');
  button.textContent = 'Outside the notifications';
  document.body.append(button);
  outsideElements.push(button);
  button.focus();
  return button;
}
/** Card controls exist only inside the open Island. */
function openIsland() {
  const pill = document.querySelector<HTMLButtonElement>('[data-cloudlet-pill]');
  if (!pill) throw new Error('Pill not rendered');
  act(() => pill.click());
}
function removalsOfFocus() {
  const removeChild = Node.prototype.removeChild;
  const removed: Node[] = [];
  vi.spyOn(Node.prototype, 'removeChild').mockImplementation(function <T extends Node>(this: Node, child: T): T {
    if (child.contains(document.activeElement)) removed.push(child);
    return removeChild.call(this, child) as T;
  });
  return removed;
}

beforeEach(() => vi.spyOn(document, 'hasFocus').mockReturnValue(true));
afterEach(() => {
  cleanup();
  controllers.splice(0).forEach((instance) => instance.dispose());
  outsideElements.splice(0).forEach((element) => element.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('native controls and focus ownership', () => {
  it('opens the Island from the pill by keyboard, collapses with Escape and closes with a separate button', async () => {
    const user = userEvent.setup();
    const instance = controller();
    const close = vi.fn();
    instance.show({ title: 'Details', description: { kind: 'text', text: 'Island body' }, duration: null, attention: 'stack', onClose: close });
    render(tree(instance));
    const pill = screen.getByRole('button', { name: 'Details' });
    expect(pill).toHaveAttribute('aria-expanded', 'false');
    expect(pill.querySelector('button, a')).toBeNull();
    expect(screen.queryByText('Island body')).not.toBeInTheDocument();
    act(() => pill.focus());
    await user.keyboard('{Enter}');
    const island = screen.getByRole('region', { name: 'Current notifications' });
    expect(island).toHaveAttribute('aria-roledescription', 'carousel');
    expect(pill).toHaveAttribute('aria-controls', island.id);
    expect(screen.getByText('Island body')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Details' })).toHaveFocus();
    expect(instance.getSnapshot().island).toMatchObject({ open: true, reason: 'user' });
    expect(instance.getSnapshot().notifications[0]?.pauseReasons).toContain('island');
    await user.keyboard('{Escape}');
    expect(instance.getSnapshot().island.open).toBe(false);
    expect(screen.getByRole('button', { name: 'Details' })).toHaveFocus();
    openIsland();
    const closeButton = screen.getByRole('button', { name: 'Close notification' });
    act(() => closeButton.focus());
    await user.keyboard(' ');
    expect(instance.getSnapshot().notifications).toHaveLength(0);
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ reason: 'close-button' }));
  });

  it('keeps a failed keyboard action visible, blocks pending duplicates and closes after a successful retry', async () => {
    const user = userEvent.setup();
    const instance = controller();
    const first = createDeferred<void>();
    const second = createDeferred<void>();
    const run = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const close = vi.fn();
    instance.show({
      title: 'Needs confirmation', onClose: close,
      action: { kind: 'command', label: 'Confirm', run, errorMessage: () => 'Please retry the action' },
    });
    render(tree(instance));
    openIsland();
    const action = screen.getByRole('button', { name: 'Confirm' });
    act(() => action.focus());
    await user.keyboard('{Enter}');
    expect(run).toHaveBeenCalledTimes(1);
    expect(action).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(action);
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => { first.reject(new Error('Business command failed')); });
    expect(screen.getByText('Please retry the action')).toBeVisible();
    expect(instance.getSnapshot().notifications).toHaveLength(1);
    expect(action).not.toHaveAttribute('aria-disabled', 'true');
    act(() => action.focus());
    await user.keyboard(' ');
    expect(run).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve(); });
    expect(instance.getSnapshot().notifications).toHaveLength(0);
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ reason: 'action-success' }));
  });

  it('keeps navigation a real anchor and respects prevented activation', async () => {
    const instance = controller();
    instance.show({ title: 'Download ready', action: { kind: 'link', label: 'Open report', href: '/report', target: '_blank', rel: 'noopener' } });
    const mounted = render(<div onClick={(event) => event.preventDefault()} onAuxClick={(event) => event.preventDefault()}>{tree(instance)}</div>);
    openIsland();
    const link = screen.getByRole('link', { name: 'Open report' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/report');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener');
    expect(link.closest('button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open report' })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(link); });
    expect(instance.getSnapshot().notifications).toHaveLength(1);
    await act(async () => { fireEvent(link, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })); });
    expect(instance.getSnapshot().notifications).toHaveLength(1);
    mounted.unmount();
  });

  it.each(['click', 'auxclick'])('closes on accepted link %s with the navigation reason', async (eventType) => {
    const instance = controller();
    const close = vi.fn();
    instance.show({ title: 'Jump to report', onClose: close, action: { kind: 'link', label: 'Jump', href: '#report' } });
    render(tree(instance));
    openIsland();
    await act(async () => {
      fireEvent(screen.getByRole('link', { name: 'Jump' }), new MouseEvent(eventType, { bubbles: true, cancelable: true, button: eventType === 'auxclick' ? 1 : 0 }));
    });
    expect(instance.getSnapshot().notifications).toHaveLength(0);
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ reason: 'navigation' }));
  });

  it('forwards retry and cancellation controls to the existing operation runner', async () => {
    const user = userEvent.setup();
    const instance = controller();
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const signals: AbortSignal[] = [];
    const operation = instance.track(({ attempt, signal }) => {
      signals.push(signal);
      return attempt === 1 ? first.promise : second.promise;
    }, { pending: { title: 'Saving' }, success: { title: 'Saved' }, error: { title: 'Save failed' } });
    render(tree(instance));
    openIsland();
    await user.click(screen.getByRole('button', { name: 'Request cancellation' }));
    expect(signals[0]?.aborted).toBe(true);
    expect(operation.getSnapshot()).toMatchObject({ status: 'pending', cancelRequested: true });
    const failure = new Error('Server failure');
    await act(async () => { first.reject(failure); });
    await expect(operation.result).rejects.toBe(failure);
    expect(screen.getByText('Save failed')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(operation.getSnapshot()).toMatchObject({ status: 'pending', attempt: 2 });
    expect(signals[1]?.aborted).toBe(false);
    await act(async () => { second.resolve('saved'); });
    expect(screen.getByText('Saved')).toBeVisible();
    expect(operation.getSnapshot()).toMatchObject({ status: 'fulfilled', attempt: 2, canRetry: true });
    // A successful attempt offers no Retry button; the API can still restart it.
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('keeps a stable anchor and keeps focus on the same close control while current moves to an older slide', () => {
    const outside = externalButton();
    const instance = controller();
    instance.show({ title: 'First notification', duration: null, attention: 'stack' });
    const second = instance.show({ title: 'Second notification', duration: null, attention: 'stack' });
    if (second.status !== 'created') throw new Error('Second notification was not admitted');
    render(tree(instance));
    expect(document.activeElement).toBe(outside);
    act(() => instance.requestFocus());
    const anchor = document.activeElement;
    expect(anchor).not.toBe(outside);
    expect(anchor).not.toBe(document.body);
    openIsland();
    act(() => instance.requestFocus({ kind: 'notification', handle: second.handle, control: 'close' }));
    const close = screen.getByRole('button', { name: 'Close notification' });
    expect(close).toHaveFocus();
    const removed = removalsOfFocus();
    act(() => instance.dismiss(second.handle));
    expect(removed).toEqual([]);
    expect(screen.getByText('First notification')).toBeVisible();
    expect(close).toHaveFocus();
    act(() => instance.clear());
    expect(removed).toEqual([]);
    expect(document.activeElement).toBe(outside);
    expect(anchor?.isConnected).toBe(true);
  });

  it('restores an external focus target before an entire focused host unmounts', () => {
    const outside = externalButton();
    const instance = controller();
    const notification = instance.show({ title: 'Unmount me', duration: null });
    if (notification.status !== 'created') throw new Error('Notification was not admitted');
    const mounted = render(tree(instance));
    openIsland();
    act(() => instance.requestFocus({ kind: 'notification', handle: notification.handle, control: 'close' }));
    expect(screen.getByRole('button', { name: 'Close notification' })).toHaveFocus();
    mounted.unmount();
    expect(document.activeElement).toBe(outside);
  });

  it('combines hover and focus pauses and releases focus on leaving the host', () => {
    const outside = externalButton();
    const instance = controller();
    instance.show({ title: 'Older item', duration: null });
    const top = instance.show({ title: 'Top item', duration: null });
    if (top.status !== 'created') throw new Error('Notifications were not admitted');
    render(tree(instance));
    const region = screen.getByRole('region', { name: 'Notifications' });
    fireEvent.mouseEnter(region);
    act(() => instance.requestFocus({ kind: 'notification', handle: top.handle }));
    expect(screen.getByRole('button', { name: 'Top item, 2 notifications' })).toHaveFocus();
    expect(instance.getSnapshot().notifications[1]?.pauseReasons).toEqual(expect.arrayContaining(['hover', 'focus']));
    fireEvent.mouseLeave(region);
    expect(instance.getSnapshot().notifications[1]?.pauseReasons).toContain('focus');
    expect(instance.getSnapshot().notifications[1]?.pauseReasons).not.toContain('hover');
    act(() => outside.focus());
    expect(instance.getSnapshot().notifications[1]?.pauseReasons).not.toContain('focus');
    expect(document.activeElement).toBe(outside);
  });
});

describe('rich-slot failure boundary', () => {
  it('keeps a suspended rich slot local to its card', () => {
    const instance = controller();
    const pending = new Promise<never>(() => undefined);
    function SuspendedSlot(): ReactElement { throw pending; }
    instance.show({ title: 'Readable sibling', duration: null, attention: 'stack' });
    instance.show({ title: 'Suspended card', icon: <SuspendedSlot />, duration: null });
    render(<><main>Application content</main><CloudletProvider controller={instance}><Toaster /></CloudletProvider></>);
    expect(screen.getByText('Application content')).toBeVisible();
    expect(screen.getByText('Suspended card')).toBeVisible();
    expect(screen.getByText('Content unavailable')).toBeVisible();
    expect(instance.getSnapshot().notifications[1]?.pauseReasons).not.toContain('presentation-pending');
  });

  it.each([true, false])('rejects slot autofocus without stale focus pause (external focus: %s)', (hasExternalFocus) => {
    const outside = hasExternalFocus ? externalButton() : document.body;
    const instance = controller();
    const next = instance.show({ title: 'Next notification', duration: null });
    const invalid = instance.show({ title: 'Invalid autofocus slot', icon: <input autoFocus />, duration: null });
    if (next.status !== 'created' || invalid.status !== 'created') throw new Error('Notification was not admitted');
    render(tree(instance));
    expect(document.activeElement).toBe(outside);
    expect(screen.queryByRole('textbox', { hidden: true })).not.toBeInTheDocument();
    expect(instance.getSnapshot().notifications[1]?.pauseReasons).not.toContain('focus');
    act(() => { instance.dismiss(invalid.handle); });
    expect(screen.getByText('Next notification')).toBeVisible();
  });

  it('isolates a broken card from a neighboring card in the same controller', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const instance = controller();
    function BrokenSlot(): ReactElement {
      throw new Error('One card failed');
    }
    instance.show({ title: 'Healthy neighboring card', duration: null, attention: 'stack' });
    instance.show({ title: 'Broken card', icon: <BrokenSlot />, duration: null });
    render(<CloudletProvider controller={instance}><Toaster /></CloudletProvider>);
    expect(screen.getByText('Content unavailable')).toBeVisible();
    openIsland();
    act(() => screen.getByRole('button', { name: '2 of 2' }).click());
    expect(screen.getByText('Healthy neighboring card')).toBeVisible();
    expect(instance.getSnapshot().notifications.map((item) => item.pauseReasons.includes('presentation-pending'))).toEqual([false, false]);
  });

  it('recovers a slot after unsupported interactive content is replaced by valid content', () => {
    const diagnostics = vi.fn();
    const instance = controller({ onDiagnostic: diagnostics });
    const admitted = instance.show({ title: 'Recoverable slot', icon: <button>Unsupported button</button>, duration: null });
    if (admitted.status !== 'created') throw new Error('Notification was not admitted');
    render(tree(instance));
    expect(screen.queryByText('Unsupported button')).not.toBeInTheDocument();
    expect(screen.getByText('Content unavailable')).toBeVisible();
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ code: 'slot-error' }));
    act(() => { instance.update(admitted.handle, { icon: <span>Recovered slot</span> }); });
    expect(screen.queryByText('Content unavailable')).not.toBeInTheDocument();
    expect(screen.getByText('Recovered slot')).toBeVisible();
  });

  it('isolates a rich render error from another instance and the fulfilled business result', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const diagnostics = vi.fn();
    const failed = controller({ onDiagnostic: diagnostics });
    const healthy = controller();
    function BrokenSlot(): ReactElement {
      throw new Error('Rich slot render exploded');
    }
    const source = createDeferred<string>();
    const operation = failed.track(source.promise, {
      pending: { title: 'Waiting' },
      success: { title: 'Business succeeded', icon: <BrokenSlot /> },
      error: { title: 'Business failed' },
    });
    healthy.show({ title: 'Healthy sibling', duration: null });
    const mounted = render(<>{tree(failed)}{tree(healthy)}</>);
    await act(async () => { source.resolve('original business value'); });
    await expect(operation.result).resolves.toBe('original business value');
    expect(operation.getSnapshot().status).toBe('fulfilled');
    expect(screen.getByText('Content unavailable')).toBeVisible();
    expect(screen.getByText('Healthy sibling')).toBeVisible();
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ code: 'slot-error' }));
    mounted.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(failed.getSnapshot().disposed).toBe(false);
    expect(healthy.getSnapshot().disposed).toBe(false);
  });
});
