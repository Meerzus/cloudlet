import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CloudletProvider, Toaster, createCloudlet,
  type CloudletMotionConstants, type NotificationHandle, type ReactCloudletController, type ReactNotificationSpec, type ToasterProps,
} from '../../packages/toast/src/index.js';
import { getRendererBridge } from '../../packages/toast/src/core/bridge.js';
import { motionControl } from '../support/motion-mock.js';
import { designMotion } from '../../apps/lab/src/design-motion.js';

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
const host = () => screen.getByRole('region', { name: 'Notifications' });
const shell = () => document.querySelector<HTMLElement>('.cloudlet-stack > .cloudlet-shell')!;
const pill = () => document.querySelector<HTMLButtonElement>('[data-cloudlet-pill]');
const island = () => screen.getByRole('region', { name: 'Current notifications' });
const layer = (name: string) => document.querySelector<HTMLElement>(`.cloudlet-host .${name}`);
const presentation = (instance: ReactCloudletController) => getRendererBridge(instance).getSnapshot().presentation;
/** Pre-mutation snapshots are inert pictures: no ids, roles, aria, data hooks, links or tab stops. */
function expectInert(container: HTMLElement | null) {
  expect(container).toHaveAttribute('inert');
  expect(container).toHaveAttribute('aria-hidden', 'true');
  expect(container!.children).toHaveLength(1);
  for (const node of [container!.firstElementChild!, ...container!.firstElementChild!.querySelectorAll('*')]) {
    for (const { name } of node.attributes) {
      expect(['id', 'role', 'tabindex', 'href'].includes(name) || name.startsWith('aria-') || name.startsWith('data-cloudlet-'), `${node.tagName} ${name}`).toBe(false);
    }
  }
}

beforeEach(() => vi.spyOn(document, 'hasFocus').mockReturnValue(true));
afterEach(() => {
  cleanup();
  controllers.splice(0).forEach(instance => instance.dispose());
  external.splice(0).forEach(element => element.remove());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('one shell for the pill and the Island', () => {
  it('data-resolved-theme names the effective theme and follows the system scheme while the theme is system', () => {
    const listeners = new Set<() => void>();
    const scheme = { matches: true };
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() { return query === '(prefers-color-scheme: dark)' ? scheme.matches : false; }, media: query,
      addEventListener: (_type: string, listener: () => void) => { if (query === '(prefers-color-scheme: dark)') listeners.add(listener); },
      removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener); },
    }));
    const instance = controller();
    admit(instance, 'Themed');
    const mounted = render(tree(instance));
    expect(host()).toHaveAttribute('data-theme', 'system');
    expect(host()).toHaveAttribute('data-resolved-theme', 'dark');
    scheme.matches = false;
    act(() => listeners.forEach(listener => listener()));
    expect(host()).toHaveAttribute('data-resolved-theme', 'light');
    mounted.rerender(tree(instance, { theme: 'dark' }));
    expect(host()).toHaveAttribute('data-resolved-theme', 'dark');
    mounted.unmount();
    expect(listeners.size).toBe(0);
    vi.unstubAllGlobals();
  });

  it('renders the collapsed stack as one named pill with aria-hidden tails and a badge', () => {
    const instance = controller();
    ['A', 'B', 'C'].forEach(title => admit(instance, title));
    render(tree(instance));
    expect(host()).toHaveAttribute('data-state', 'stack');
    expect(host()).toHaveAttribute('data-edge', 'top');
    const button = screen.getByRole('button', { name: 'C, 3 notifications' });
    expect(button).toBe(pill());
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', shell().id);
    expect(shell()).toHaveAttribute('data-state', 'stack');
    expect(shell()).toHaveAttribute('data-kind', 'info');
    expect(shell()).not.toHaveAttribute('role');
    // Visible title and icon belong to the pill's name, not to a second reading stop.
    expect(screen.queryByRole('heading')).toBeNull();
    const tails = document.querySelectorAll('.cloudlet-stack > [data-cloudlet-tail]');
    expect(tails).toHaveLength(2);
    tails.forEach(tail => expect(tail).toHaveAttribute('aria-hidden', 'true'));
    expect(document.querySelector('.cloudlet-badge')).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector('.cloudlet-badge-value')).toHaveTextContent('3');
    expect(motionControl.calls).toEqual(expect.arrayContaining(['shape:instant', 'enter', 'tails:settle:2', 'badge:true']));
  });

  it('speaks the carousel and slide roles from labels, so a localized Island has no English role words', () => {
    const instance = controller();
    ['A', 'B'].forEach(title => admit(instance, title));
    render(tree(instance, { labels: { island: 'Current notifications', carousel: 'carousel', slide: 'slide', page: (index, total) => `${index} of ${total}` } }));
    act(() => pill()!.click());
    const region = screen.getByRole('region', { name: 'Current notifications' });
    expect(region).toHaveAttribute('aria-roledescription', 'carousel');
    expect(within(region).getByRole('group', { name: '1 of 2' })).toHaveAttribute('aria-roledescription', 'slide');
  });

  it('opens into the carousel with the same title and icon nodes and removes the tails', () => {
    const instance = controller();
    ['A', 'B', 'C'].forEach(title => admit(instance, title));
    render(tree(instance));
    const title = document.querySelector('[data-cloudlet-title]');
    const icon = document.querySelector('.cloudlet-icon');
    act(() => pill()!.click());
    expect(host()).toHaveAttribute('data-state', 'island');
    expect(host()).toHaveAttribute('data-island-reason', 'user');
    expect(island()).toBe(shell());
    expect(island()).toHaveAttribute('aria-roledescription', 'carousel');
    expect(island()).toHaveAccessibleDescription('Press Escape to collapse');
    expect(screen.getByRole('heading', { name: 'C' })).toBe(title);
    expect(document.querySelector('.cloudlet-icon')).toBe(icon);
    const slide = within(island()).getByRole('group', { name: '1 of 3' });
    expect(slide).toHaveAttribute('aria-roledescription', 'slide');
    expect(slide).toHaveAttribute('data-current', 'true');
    expect(slide).toHaveAttribute('data-kind', 'info');
    expect(pill()).toBeNull();
    expect(document.querySelectorAll('[data-cloudlet-tail]')).toHaveLength(0);
    expect(motionControl.calls).toEqual(expect.arrayContaining(['shape:open', 'open']));
  });

  it('moves keyboard focus to the Island title, leaves pointer and external focus alone, and returns it on Escape', async () => {
    const user = userEvent.setup();
    const application = outside();
    const instance = controller();
    ['A', 'B'].forEach(title => admit(instance, title));
    render(tree(instance));
    application.focus();
    // A pointer open with focus elsewhere (Safari never focuses buttons on click) does not move focus.
    act(() => pill()!.click());
    expect(application).toHaveFocus();
    act(() => screen.getByRole('heading', { name: 'B' }).focus());
    await user.keyboard('{Escape}');
    expect(pill()).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'B' })).toHaveFocus();
    expect(document.querySelector('[data-cloudlet-title]')).toHaveFocus();
  });

  it('slides with one inert snapshot and one live set of controls, keeping close focused', async () => {
    const user = userEvent.setup();
    const instance = controller();
    const [a, b, c] = ['A', 'B', 'C'].map(title => admit(instance, title, { description: { kind: 'text', text: `${title} body` } }));
    render(tree(instance));
    act(() => pill()!.click());
    const close = screen.getByRole('button', { name: 'Close notification' });
    act(() => close.focus());
    motionControl.hold();
    await user.keyboard('{ArrowRight}');
    expect(instance.getSnapshot().island.current).toBe(b);
    expect(motionControl.calls).toContain('slide:1');
    expectInert(layer('cloudlet-slide-out'));
    expect(layer('cloudlet-slide-out')).toHaveTextContent('C body');
    await user.keyboard('{End}');
    expect(instance.getSnapshot().island.current).toBe(a);
    // A slide interrupting a slide replaces the snapshot instead of stacking another.
    expectInert(layer('cloudlet-slide-out'));
    expect(layer('cloudlet-slide-out')).toHaveTextContent('B body');
    expect(screen.getAllByRole('button', { name: 'Close notification' })).toEqual([close]);
    expect(close).toHaveFocus();
    expect(presentation(instance)).toMatchObject({ handle: a, readable: false });
    act(() => motionControl.flush());
    expect(layer('cloudlet-slide-out')!.children).toHaveLength(0);
    expect(presentation(instance)).toMatchObject({ handle: a, readable: true });
    expect(c).toBeDefined();
  });

  it('closes the current slide towards the older one with a forward slide', async () => {
    const user = userEvent.setup();
    const instance = controller();
    const [older] = ['Older', 'Newer'].map(title => admit(instance, title));
    render(tree(instance));
    act(() => pill()!.click());
    const close = screen.getByRole('button', { name: 'Close notification' });
    act(() => close.focus());
    await user.keyboard('{Enter}');
    expect(instance.getSnapshot().island.current).toBe(older);
    expect(motionControl.calls).toContain('slide:1');
    expect(close).toHaveFocus();
  });

  it('blur-swaps the header and crossfades the body of the updated current slide with one snapshot each', () => {
    const instance = controller();
    const handle = admit(instance, 'Uploading', { description: { kind: 'text', text: 'Step 1' } });
    render(tree(instance));
    act(() => pill()!.click());
    const title = screen.getByRole('heading', { name: 'Uploading' });
    motionControl.hold();
    act(() => { instance.update(handle, { title: 'Still uploading', description: { kind: 'text', text: 'Step 2' } }); });
    act(() => { instance.update(handle, { title: 'Almost there', description: { kind: 'text', text: 'Step 3' } }); });
    expect(screen.getByRole('heading', { name: 'Almost there' })).toBe(title);
    expectInert(layer('cloudlet-heading-out'));
    expect(layer('cloudlet-heading-out')).toHaveTextContent('Still uploading');
    expectInert(layer('cloudlet-body-out'));
    expect(layer('cloudlet-body-out')).toHaveTextContent('Step 2');
    expect(motionControl.calls.filter(call => call === 'swap:header')).toHaveLength(2);
    act(() => motionControl.flush());
    expect(layer('cloudlet-heading-out')!.children).toHaveLength(0);
    expect(layer('cloudlet-body-out')!.children).toHaveLength(0);
  });

  it('accepts rapid repeated clicks on close (detail > 1 dismisses the next record each time)', () => {
    const instance = controller();
    ['A', 'B', 'C'].forEach(title => admit(instance, title));
    render(tree(instance));
    act(() => pill()!.click());
    const close = () => within(island()).getByRole('button', { name: 'Close notification' });
    const rapid = (detail: number) => act(() => { close().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail })); });
    rapid(1);
    expect(instance.getSnapshot().notifications).toHaveLength(2);
    rapid(2);
    expect(instance.getSnapshot().notifications).toHaveLength(1);
    rapid(3);
    expect(instance.getSnapshot().notifications).toHaveLength(0);
  });

  it('crossfades a stream of body updates once and then changes the text in place (bodyQuiet)', () => {
    motionControl.constants = { bodyQuiet: 600 } as unknown as CloudletMotionConstants;
    motionControl.now = 10_000;
    const instance = controller();
    const handle = admit(instance, 'Uploading', { description: { kind: 'text', text: '1 of 20' } });
    render(tree(instance));
    act(() => pill()!.click());
    const bodySwaps = () => motionControl.calls.filter(call => call === 'swap:body').length;
    motionControl.now += 150; act(() => { instance.update(handle, { description: { kind: 'text', text: '2 of 20' } }); });
    expect(bodySwaps()).toBe(1);
    motionControl.now += 150; act(() => { instance.update(handle, { description: { kind: 'text', text: '3 of 20' } }); });
    motionControl.now += 150; act(() => { instance.update(handle, { description: { kind: 'text', text: '4 of 20' } }); });
    expect(bodySwaps()).toBe(1);
    expect(island()).toHaveTextContent('4 of 20');
    expect(layer('cloudlet-body-out')!.children).toHaveLength(0);
    motionControl.now += 700; act(() => { instance.update(handle, { description: { kind: 'text', text: '20 of 20' } }); });
    expect(bodySwaps()).toBe(2);
  });

  it('collapses from a not-top slide with a header swap to the top and a fading chrome snapshot', () => {
    const instance = controller();
    const [, b, c] = ['A', 'B', 'C'].map(title => admit(instance, title));
    render(tree(instance));
    act(() => pill()!.click());
    act(() => within(island()).getByRole('button', { name: '2 of 3' }).click());
    expect(instance.getSnapshot().island.current).toBe(b);
    motionControl.hold();
    act(() => screen.getByRole('heading', { name: 'B' }).focus());
    act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(host()).toHaveAttribute('data-state', 'stack');
    expect(screen.getByRole('button', { name: 'C, 3 notifications' })).toHaveFocus();
    expectInert(layer('cloudlet-heading-out'));
    expect(layer('cloudlet-heading-out')).toHaveTextContent('B');
    expectInert(layer('cloudlet-chrome-out'));
    expect(within(layer('cloudlet-chrome-out')!).queryAllByRole('button')).toEqual([]);
    expect(motionControl.calls).toEqual(expect.arrayContaining(['collapse:2', 'swap:header']));
    expect(presentation(instance)).toMatchObject({ handle: c, readable: false });
    act(() => motionControl.flush());
    expect(presentation(instance)).toMatchObject({ handle: c, readable: true });
    expect(layer('cloudlet-chrome-out')!.children).toHaveLength(0);
  });

  it('raises the first tail when the top pill is dismissed and exits the shell after the last record', () => {
    const instance = controller();
    const a = admit(instance, 'A');
    const b = admit(instance, 'B');
    render(tree(instance));
    motionControl.hold();
    act(() => { instance.dismiss(b); });
    expect(screen.getByRole('button', { name: 'A' })).toBe(pill());
    expect(motionControl.calls).toEqual(expect.arrayContaining(['exit', 'rise', 'swap:header:in', 'tails:rise:0']));
    expectInert(layer('cloudlet-exit'));
    expect(layer('cloudlet-exit')).toHaveTextContent('B');
    expect(presentation(instance)).toMatchObject({ handle: a, readable: false });
    act(() => motionControl.flush());
    expect(presentation(instance)).toMatchObject({ handle: a, readable: true });
    motionControl.hold();
    act(() => { instance.dismiss(a); });
    expect(shell()).not.toBeVisible();
    expect(layer('cloudlet-exit')).toHaveTextContent('A');
    act(() => motionControl.flush());
    expect(layer('cloudlet-exit')!.children).toHaveLength(0);
  });

  it('re-pends the same record while a terminal update swaps its header', async () => {
    const instance = controller();
    let resolve!: (value: string) => void;
    const operation = instance.track(new Promise<string>(done => { resolve = done; }), { pending: { title: 'Saving' }, success: { title: 'Saved' }, error: { title: 'Failed' } });
    render(tree(instance));
    const before = presentation(instance)!;
    expect(before.readable).toBe(true);
    motionControl.hold();
    await act(async () => { resolve('ok'); await operation.result; });
    expect(screen.getByRole('button', { name: 'Saved' })).toBe(pill());
    expect(presentation(instance)).toMatchObject({ handle: before.handle, readable: false });
    expect(presentation(instance)!.token).not.toBe(before.token);
    act(() => motionControl.flush());
    expect(presentation(instance)).toMatchObject({ readable: true });
  });

  it('follows prefers-reduced-motion on mount and on the fly, and forwards timeScale and overrides', () => {
    let listener: (() => void) | null = null;
    const media = { matches: true, addEventListener: (_: string, callback: () => void) => { listener = callback; }, removeEventListener: vi.fn() };
    const width = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn((query: string) => query.includes('reduced-motion') ? media : width));
    const instance = controller();
    admit(instance, 'Only');
    const view = render(tree(instance, { motion: { timeScale: 0.25 } }));
    expect(host()).toHaveAttribute('data-reduced-motion', 'true');
    media.matches = false;
    act(() => listener!());
    expect(host()).toHaveAttribute('data-reduced-motion', 'false');
    expect(motionControl.calls).toContain('reduced:false');
    view.rerender(tree(instance, { motion: { timeScale: 0.5 } }));
    expect(motionControl.calls).toContain('timeScale:0.5');
    const overrides = { enter: { duration: 900 } };
    view.rerender(tree(instance, { motion: { timeScale: 0.5, overrides } }));
    view.rerender(tree(instance, { motion: { timeScale: 0.5, overrides } }));
    expect(motionControl.calls.filter(call => call.startsWith('constants:'))).toEqual(['constants:enter=900']);
    view.rerender(tree(instance, { motion: { timeScale: 0.5 } }));
    expect(motionControl.calls.filter(call => call.startsWith('constants:'))).toEqual(['constants:enter=900', `constants:enter=${designMotion.enter.duration}`]);
    view.unmount();
    expect(media.removeEventListener.mock.calls.map(call => call.slice(0, 2))).toEqual([['change', listener]]);
  });

  it('releases the sampler, observers and CSSOM rules on unmount', () => {
    const observers: { disconnect: ReturnType<typeof vi.fn>; targets: Element[] }[] = [];
    vi.stubGlobal('ResizeObserver', class {
      readonly record = { disconnect: vi.fn(), targets: [] as Element[] };
      constructor() { observers.push(this.record); }
      observe(target: Element) { this.record.targets.push(target); }
      disconnect() { this.record.disconnect(); }
    });
    const instance = controller();
    admit(instance, 'Only');
    const view = render(tree(instance));
    expect(observers).toHaveLength(1);
    expect(observers[0]!.targets.map(target => target.className)).toEqual(['cloudlet-clip', 'cloudlet-host']);
    const sheet = document.querySelector<HTMLStyleElement>('style[data-cloudlet-motion]')!.sheet!;
    expect(sheet.cssRules.length).toBeGreaterThan(10);
    view.unmount();
    expect(observers[0]!.disconnect).toHaveBeenCalledOnce();
    expect(sheet.cssRules).toHaveLength(0);
    expect(motionControl.calls).toContain('dispose');
  });
});
