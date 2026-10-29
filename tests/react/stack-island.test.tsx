import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CloudletProvider, Toaster, createCloudlet,
  type NotificationHandle, type ReactCloudletController, type ReactNotificationSpec, type ToasterProps,
} from '../../packages/toast/src/index.js';
import { getRendererBridge } from '../../packages/toast/src/core/bridge.js';
import { motionControl } from '../support/motion-mock.js';

const controllers: ReactCloudletController[] = [];
const external: Element[] = [];
function controller() {
  const instance = createCloudlet({ autoDismiss: false });
  controllers.push(instance);
  return instance;
}
function tree(instance: ReactCloudletController, options: ToasterProps = {}) {
  return <CloudletProvider controller={instance}><Toaster {...options} /></CloudletProvider>;
}
function admit(instance: ReactCloudletController, title: string, options: Partial<ReactNotificationSpec> = {}): NotificationHandle {
  const result = instance.show({ title, attention: 'stack', ...options });
  if (result.status !== 'created') throw new Error('Notification not created');
  return result.handle;
}
function outside(label = 'Application action') {
  const element = document.createElement('button');
  element.textContent = label;
  document.body.append(element);
  external.push(element);
  return element;
}
const pill = () => document.querySelector<HTMLButtonElement>('[data-cloudlet-pill]');
const island = () => screen.getByRole('region', { name: 'Current notifications' });
/** Records focused subtrees that React removes or hides; the renderer must move focus first. */
function protectMutations() {
  const violations: string[] = [];
  const removeChild = Node.prototype.removeChild;
  vi.spyOn(Node.prototype, 'removeChild').mockImplementation(function <T extends Node>(this: Node, child: T): T {
    if (child.contains(document.activeElement)) violations.push('Focused subtree removed');
    return removeChild.call(this, child) as T;
  });
  return violations;
}

beforeEach(() => vi.spyOn(document, 'hasFocus').mockReturnValue(true));
afterEach(() => {
  cleanup();
  controllers.splice(0).forEach(instance => instance.dispose());
  external.splice(0).forEach(element => element.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('collapsed stack', () => {
  it('shows only the top record as one named pill and keeps arrivals away from focus', () => {
    const application = outside();
    application.focus();
    const instance = controller();
    admit(instance, 'Older');
    render(tree(instance));
    expect(screen.getByRole('button', { name: 'Older' })).toHaveAttribute('aria-expanded', 'false');
    act(() => { admit(instance, 'Newest'); });
    const button = screen.getByRole('button', { name: 'Newest, 2 notifications' });
    expect(button).toBe(pill());
    expect(screen.queryByText('Older')).not.toBeInTheDocument();
    expect(application).toHaveFocus();
    const host = screen.getByRole('region', { name: 'Notifications' });
    expect(host).toHaveAttribute('data-state', 'stack');
    expect(host).not.toHaveAttribute('data-island-reason');
  });

  it('counts missed notifications in the badge and the pill name, and acknowledges them in the Island row', async () => {
    const user = userEvent.setup();
    const instance = createCloudlet();
    controllers.push(instance);
    for (let index = 0; index < 101; index++) instance.show({ title: `Item ${index}`, duration: null, attention: 'stack' });
    render(tree(instance));
    // DESIGN §10: no separate card; the badge is 100 records + 1 missed.
    expect(document.querySelector('.cloudlet-host > .cloudlet-overflow')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Acknowledge missed notifications' })).toBeNull();
    expect(document.querySelector('.cloudlet-badge-value')).toHaveTextContent('101');
    act(() => pill()!.focus());
    expect(pill()).toHaveAccessibleName('Item 99, 100 notifications, 1 missed');
    await user.keyboard('{Enter}');
    const row = within(island()).getByText('1 missed notifications').closest('.cloudlet-indicator');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('1 of 100')).toBeInTheDocument();
    const acknowledge = within(row as HTMLElement).getByRole('button', { name: 'Acknowledge missed notifications' });
    acknowledge.focus();
    await user.keyboard('{Enter}');
    expect(instance.getSnapshot().overflow.pending).toBe(false);
    expect(within(island()).queryByText('1 missed notifications')).toBeNull();
    // Focus stays in the Island: the removed button hands it to the title.
    expect(screen.getByRole('heading', { name: 'Item 99' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(pill()).toHaveAccessibleName('Item 99, 100 notifications');
    expect(document.querySelector('.cloudlet-badge-value')).toHaveTextContent('100');
  });

  it('shows the badge for a single record with missed notifications', () => {
    const instance = createCloudlet();
    controllers.push(instance);
    const motion = motionControl.calls;
    for (let index = 0; index < 101; index++) instance.show({ title: `Item ${index}`, duration: null, attention: 'stack' });
    act(() => { for (const handle of instance.getSnapshot().stack.slice(1)) instance.dismiss(handle); });
    render(tree(instance));
    expect(instance.getSnapshot().stack).toHaveLength(1);
    expect(document.querySelector('.cloudlet-badge-value')).toHaveTextContent('2');
    expect(motion).toContain('badge:true');
    expect(pill()).toHaveAccessibleName('Item 99, 1 missed');
    act(() => { instance.acknowledgeOverflow(); });
    expect(motion.at(-1)).toBe('badge:false');
  });

  it('focuses the acknowledgement in the Island, or the pill when collapsed, for requestFocus overflow', async () => {
    const user = userEvent.setup();
    const instance = createCloudlet();
    controllers.push(instance);
    for (let index = 0; index < 101; index++) instance.show({ title: `Item ${index}`, duration: null, attention: 'stack' });
    render(tree(instance));
    act(() => { instance.requestFocus({ kind: 'overflow' }); });
    expect(pill()).toHaveFocus();
    await user.keyboard('{Enter}');
    act(() => { instance.requestFocus({ kind: 'overflow' }); });
    expect(screen.getByRole('button', { name: 'Acknowledge missed notifications' })).toHaveFocus();
  });
});

describe('Island', () => {
  it('opens on the top slide, navigates with arrows/Home/End and dots, and collapses back to the pill', async () => {
    const user = userEvent.setup();
    const instance = controller();
    const [a, b, c] = ['A', 'B', 'C'].map(title => admit(instance, title));
    render(tree(instance));
    act(() => pill()!.focus());
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'C' })).toHaveFocus();
    expect(within(island()).getByRole('group', { name: '1 of 3' })).toHaveAttribute('aria-roledescription', 'slide');
    expect(screen.getByRole('region', { name: 'Notifications' })).toHaveAttribute('data-state', 'island');
    expect(screen.getByRole('region', { name: 'Notifications' })).toHaveAttribute('data-island-reason', 'user');
    await user.keyboard('{ArrowRight}');
    expect(instance.getSnapshot().island.current).toBe(b);
    await user.keyboard('{End}');
    expect(instance.getSnapshot().island.current).toBe(a);
    await user.keyboard('{ArrowRight}');
    expect(instance.getSnapshot().island.current).toBe(a);
    await user.keyboard('{Home}');
    expect(instance.getSnapshot().island.current).toBe(c);
    const dots = within(island()).getAllByRole('button', { name: /of 3$/ });
    expect(dots.map(dot => dot.getAttribute('aria-current'))).toEqual(['true', null, null]);
    act(() => dots[1]!.click());
    expect(instance.getSnapshot().island.current).toBe(b);
    act(() => screen.getByRole('heading', { name: 'B' }).focus());
    await user.keyboard('{Escape}');
    expect(instance.getSnapshot().island).toEqual({ open: false, reason: null, current: null });
    expect(screen.getByRole('button', { name: 'C, 3 notifications' })).toHaveFocus();
  });

  it('mirrors arrow navigation in RTL and shows a page label instead of dots above five slides', async () => {
    const user = userEvent.setup();
    const instance = controller();
    const handles = ['1', '2', '3', '4', '5', '6'].map(title => admit(instance, title));
    render(tree(instance, { dir: 'rtl' }));
    act(() => pill()!.focus());
    await user.keyboard('{Enter}');
    expect(within(island()).queryAllByRole('button', { name: /of 6$/ })).toEqual([]);
    expect(within(island()).getByText('1 of 6')).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(instance.getSnapshot().island.current).toBe(handles[4]);
  });

  it('moves current to the older slide on close, keeps focus on close and restores external focus after the last', async () => {
    const user = userEvent.setup();
    const application = outside();
    application.focus();
    const instance = controller();
    admit(instance, 'Older');
    admit(instance, 'Newer');
    render(tree(instance));
    act(() => pill()!.click());
    const close = screen.getByRole('button', { name: 'Close notification' });
    act(() => close.focus());
    const violations = protectMutations();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'Older' })).toBeVisible();
    expect(close).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(instance.getSnapshot()).toMatchObject({ notifications: [], island: { open: false, reason: null } });
    expect(application).toHaveFocus();
    expect(violations).toEqual([]);
  });

  it('moves focus off a departing control before commit when a slide loses its retry button', async () => {
    const instance = controller();
    let fail!: (error: Error) => void;
    const operation = instance.track(({ attempt }) => attempt === 1
      ? new Promise<string>((_resolve, reject) => { fail = reject; }) : new Promise<string>(() => undefined),
    { pending: { title: 'Saving' }, success: { title: 'Saved' }, error: { title: 'Failed' } });
    render(tree(instance));
    act(() => pill()!.click());
    await act(async () => { fail(new Error('Offline')); });
    await expect(operation.result).rejects.toThrow('Offline');
    const retry = screen.getByRole('button', { name: 'Retry' });
    act(() => retry.focus());
    const violations = protectMutations();
    act(() => retry.click());
    expect(violations).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Saving' })).toHaveFocus();
  });

  it('releases the host focus pause when the last record leaves while focused', async () => {
    const user = userEvent.setup();
    const application = outside();
    application.focus();
    const instance = controller();
    admit(instance, 'Last');
    render(tree(instance));
    act(() => pill()!.click());
    act(() => screen.getByRole('button', { name: 'Close notification' }).focus());
    expect(instance.getSnapshot().notifications[0]?.pauseReasons).toContain('focus');
    await user.keyboard('{Enter}');
    expect(application).toHaveFocus();
    act(() => { admit(instance, 'Next'); });
    expect(instance.getSnapshot().notifications[0]?.pauseReasons).not.toContain('focus');
  });

  it('collapses on a pointer press outside the host', () => {
    const application = outside();
    const instance = controller();
    admit(instance, 'Only');
    render(tree(instance));
    act(() => pill()!.click());
    fireEvent.pointerDown(island());
    expect(instance.getSnapshot().island.open).toBe(true);
    fireEvent.pointerDown(application);
    expect(instance.getSnapshot().island.open).toBe(false);
  });

  it('auto-opens by attention after the Toaster delay without moving focus', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const application = outside();
    application.focus();
    const instance = controller();
    render(tree(instance, { attention: { delay: 250 } }));
    let handle!: NotificationHandle;
    act(() => { handle = admit(instance, 'Undo available', { attention: 'auto', action: { kind: 'command', label: 'Undo', run: vi.fn() } }); });
    act(() => { vi.advanceTimersByTime(249); });
    expect(instance.getSnapshot().island.open).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(instance.getSnapshot().island).toEqual({ open: true, reason: 'attention', current: handle });
    expect(screen.getByRole('region', { name: 'Notifications' })).toHaveAttribute('data-island-reason', 'attention');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeVisible();
    expect(application).toHaveFocus();
  });

  it('falls back to the default delay and reports an invalid Toaster attention delay', () => {
    const diagnostics = vi.fn();
    const instance = createCloudlet({ onDiagnostic: diagnostics });
    controllers.push(instance);
    render(tree(instance, { attention: { delay: -5 } }));
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeInTheDocument();
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid-input', source: 'Toaster.attention' }));
  });

  it('acknowledges the presented pill or slide once and re-presents a slide after navigation', () => {
    const instance = controller();
    const presented: { handle: NotificationHandle; first: boolean }[] = [];
    instance.onEvent(event => { if (event.type === 'presented') presented.push({ handle: event.handle, first: event.firstPresentation }); });
    const older = admit(instance, 'Older');
    const newer = admit(instance, 'Newer');
    render(tree(instance));
    expect(presented).toEqual([{ handle: newer, first: true }]);
    act(() => pill()!.click());
    expect(presented).toHaveLength(1);
    act(() => within(island()).getByRole('button', { name: '2 of 2' }).click());
    act(() => within(island()).getByRole('button', { name: '1 of 2' }).click());
    expect(presented).toEqual([{ handle: newer, first: true }, { handle: older, first: true }, { handle: newer, first: false }]);
    expect(getRendererBridge(instance).getSnapshot().presentation).toMatchObject({ handle: newer, readable: true });
  });
});

describe('external restoration and native navigation', () => {
  it.each(['removed', 'hidden ancestor', 'disabled'] as const)('uses another external control when the remembered target is %s', async condition => {
    const user = userEvent.setup();
    const previous = outside('Previous');
    const next = outside('Available application control');
    previous.focus();
    const instance = controller();
    admit(instance, 'Last notification');
    render(tree(instance));
    act(() => pill()!.click());
    const close = screen.getByRole('button', { name: 'Close notification' });
    act(() => close.focus());
    if (condition === 'removed') previous.remove();
    else if (condition === 'disabled') previous.disabled = true;
    else {
      const parent = document.createElement('div');
      document.body.append(parent);
      external.push(parent);
      parent.append(previous);
      parent.style.display = 'none';
    }
    const violations = protectMutations();
    await user.keyboard('{Enter}');
    expect(next).toHaveFocus();
    expect(violations).toEqual([]);
  });

  it('uses the document body when the application has no remaining focus target, without adding a tab stop', () => {
    const previous = outside();
    previous.focus();
    const instance = controller();
    admit(instance, 'Last notification');
    render(tree(instance));
    act(() => pill()!.click());
    const close = screen.getByRole('button', { name: 'Close notification' });
    act(() => close.focus());
    previous.remove();
    const violations = protectMutations();
    fireEvent.click(close);
    expect(document.body).toHaveFocus();
    expect(document.body).not.toHaveAttribute('tabindex');
    expect(violations).toEqual([]);
  });

  it('preserves browser focus ownership when navigation removes the last record', async () => {
    const application = outside();
    application.focus();
    const instance = controller();
    admit(instance, 'Navigation', { action: { kind: 'link', label: 'Open result', href: '#result' } });
    render(tree(instance));
    act(() => pill()!.click());
    const link = screen.getByRole('link', { name: 'Open result' });
    act(() => link.focus());
    const focus = vi.spyOn(application, 'focus');
    await act(async () => { fireEvent(link, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })); });
    expect(instance.getSnapshot().notifications).toHaveLength(0);
    expect(focus).not.toHaveBeenCalled();
    expect(application).not.toHaveFocus();
  });
});
