import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CloudletProvider, Toaster, createCloudlet,
  type CloudletPart, type ReactCloudletController, type ToasterProps,
} from '../../packages/toast/src/index.js';

const controllers: ReactCloudletController[] = [];
function tree(instance: ReactCloudletController, options: ToasterProps = {}) {
  return <CloudletProvider controller={instance}><Toaster {...options} /></CloudletProvider>;
}
/** 100 records and 1 missed; the top record has a description, an action and progress. */
function crowded() {
  const instance = createCloudlet();
  controllers.push(instance);
  for (let index = 0; index < 101; index++) {
    instance.show({
      title: `Item ${index}`, duration: null, attention: 'stack', kind: index === 99 ? 'success' : 'info',
      ...(index === 99 ? {
        description: { kind: 'text', text: 'Saved to the shared folder' },
        action: { kind: 'command', label: 'Undo', run: vi.fn() },
        progress: { kind: 'determinate', value: 0.5 },
      } : {}),
    });
  }
  return instance;
}
const host = () => screen.getByRole('region', { name: 'Notifications' });
const pill = () => document.querySelector<HTMLButtonElement>('[data-cloudlet-pill]')!;

/** Part → own class of the element it lands on. */
const own: Record<CloudletPart, string> = {
  host: 'cloudlet-host', stack: 'cloudlet-stack', pill: 'cloudlet-pill', tail: 'cloudlet-tail', badge: 'cloudlet-badge',
  island: 'cloudlet-shell', header: 'cloudlet-header', icon: 'cloudlet-icon', title: 'cloudlet-title', close: 'cloudlet-close',
  body: 'cloudlet-body', description: 'cloudlet-description', actions: 'cloudlet-actions', action: 'cloudlet-action',
  indicator: 'cloudlet-indicator', overflow: 'cloudlet-overflow', form: 'cloudlet-form', field: 'cloudlet-field',
  'field-error': 'cloudlet-field-error',
};
/** A form's parts; tests/react/forms.test.tsx checks them on a notification with a form. */
const formParts: readonly CloudletPart[] = ['form', 'field', 'field-error'];
const parts = Object.keys(own) as CloudletPart[];
const classNames = Object.fromEntries(parts.map(part => [part, `app-${part} app-shared`])) as Record<CloudletPart, string>;
/** Live elements only: snapshot containers hold inert copies of the same classes. */
const live = (part: CloudletPart) => [...document.querySelectorAll(`.app-${part}`)]
  .filter(element => !element.closest('[inert]'));

beforeEach(() => vi.spyOn(document, 'hasFocus').mockReturnValue(true));
afterEach(() => {
  cleanup();
  controllers.splice(0).forEach(instance => instance.dispose());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('classNames', () => {
  it('adds every CloudletPart class next to the own class of its element, collapsed and open', () => {
    render(tree(crowded(), { classNames }));
    const collapsed: CloudletPart[] = ['host', 'stack', 'pill', 'tail', 'badge', 'island', 'header', 'icon', 'title'];
    for (const part of collapsed) {
      const elements = live(part);
      expect(elements.length, part).toBeGreaterThan(0);
      for (const element of elements) {
        expect(element, part).toHaveClass(own[part], `app-${part}`, 'app-shared');
      }
    }
    expect(live('tail')).toHaveLength(2);
    expect(live('host')[0]).toBe(host());
    expect(live('pill')[0]).toBe(pill());
    expect(live('island')[0]).toBe(document.querySelector('.cloudlet-stack > .cloudlet-shell'));

    fireEvent.click(pill());
    expect(host()).toHaveAttribute('data-state', 'island');
    for (const part of parts.filter(part => part !== 'pill' && part !== 'tail' && !formParts.includes(part))) {
      const elements = live(part);
      expect(elements.length, part).toBeGreaterThan(0);
      for (const element of elements) expect(element, part).toHaveClass(own[part], `app-${part}`, 'app-shared');
    }
    expect(live('close')[0]).toBe(screen.getByRole('button', { name: 'Close notification' }));
    expect(live('action')[0]).toBe(screen.getByRole('button', { name: 'Undo' }));
    expect(live('island')[0]).toBe(screen.getByRole('region', { name: 'Current notifications' }));
    expect(live('overflow')[0]).toContainElement(screen.getByRole('button', { name: 'Acknowledge missed notifications' }));
    expect(live('description')[0]).toHaveTextContent('Saved to the shared folder');
  });

  it('never replaces own classes and ignores blank or non-string values; later renders update them', () => {
    const instance = crowded();
    const view = render(tree(instance, { classNames: { host: '  ', pill: 42 as unknown as string, badge: ' spaced ' } }));
    expect(host().className).toBe('cloudlet-host');
    expect(pill().className).toBe('cloudlet-pill');
    expect(document.querySelector('.cloudlet-badge')!.className).toBe('cloudlet-badge spaced');
    view.rerender(tree(instance, { classNames: { host: 'later' } }));
    expect(host().className).toBe('cloudlet-host later');
    expect(document.querySelector('.cloudlet-badge')!.className).toBe('cloudlet-badge');
  });

  it('marks the primary action apart from neutral controls', () => {
    render(tree(crowded()));
    fireEvent.click(pill());
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveClass('cloudlet-action', 'cloudlet-primary');
    expect(screen.getByRole('button', { name: 'Close notification' })).not.toHaveClass('cloudlet-primary');
  });
});

describe('data attributes for styling and tests', () => {
  it('describes the host and the current card, and keeps them stable across commits', () => {
    const instance = crowded();
    const view = render(tree(instance, { position: 'top-center', theme: 'dark' }));
    expect(host()).toHaveAttribute('data-state', 'stack');
    expect(host()).not.toHaveAttribute('data-island-reason');
    expect(host()).toHaveAttribute('data-position', 'top-center');
    expect(host()).toHaveAttribute('data-edge', 'top');
    expect(host()).toHaveAttribute('data-theme', 'dark');
    expect(host()).toHaveAttribute('data-reduced-motion', 'false');
    expect(host()).not.toHaveAttribute('data-dragging');
    const card = document.querySelector('.cloudlet-slide')!;
    expect(card).toHaveAttribute('data-kind', 'success');
    expect(card).toHaveAttribute('data-current', 'true');
    // The icon carries the kind too, so its blur-swap snapshot keeps the outgoing colour.
    expect(document.querySelector('.cloudlet-slide .cloudlet-icon')).toHaveAttribute('data-kind', 'success');

    fireEvent.click(pill());
    expect(host()).toHaveAttribute('data-state', 'island');
    expect(host()).toHaveAttribute('data-island-reason', 'user');
    expect(document.querySelector('.cloudlet-slide .cloudlet-body')).toHaveAttribute('data-kind', 'success');
    act(() => { fireEvent.keyDown(screen.getByRole('region', { name: 'Current notifications' }), { key: 'ArrowRight' }); });
    const next = document.querySelector('.cloudlet-clip > .cloudlet-slide')!;
    expect(next).toHaveAttribute('data-kind', 'info');
    expect(next).toHaveAttribute('data-current', 'true');
    expect(document.querySelectorAll('[data-current]')).toHaveLength(1);

    view.rerender(tree(instance, { position: 'bottom-center', theme: 'light' }));
    expect(host()).toHaveAttribute('data-position', 'bottom-center');
    expect(host()).toHaveAttribute('data-edge', 'bottom');
    expect(host()).toHaveAttribute('data-theme', 'light');
    expect(host()).toHaveAttribute('data-reduced-motion', 'false');
    act(() => { fireEvent.keyDown(screen.getByRole('region', { name: 'Current notifications' }), { key: 'Escape' }); });
    expect(host()).toHaveAttribute('data-state', 'stack');
    expect(host()).not.toHaveAttribute('data-island-reason');
  });

  it('defaults to the system theme and reflects reduced motion', () => {
    const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn((query: string) => query.includes('reduced-motion') ? media : { ...media, matches: true }));
    render(tree(crowded()));
    expect(host()).toHaveAttribute('data-theme', 'system');
    expect(host()).toHaveAttribute('data-position', 'auto');
    expect(host()).toHaveAttribute('data-edge', 'top');
    expect(host()).toHaveAttribute('data-reduced-motion', 'true');
  });
});

describe('status icon', () => {
  it('draws a glyph per kind, a spinner for loading and the record icon in the same circle', () => {
    const instance = createCloudlet();
    controllers.push(instance);
    render(tree(instance));
    const icon = () => document.querySelector('.cloudlet-clip > .cloudlet-slide .cloudlet-icon')!;
    for (const kind of ['success', 'error', 'info', 'warning'] as const) {
      act(() => { instance.clear(); instance.show({ title: kind, kind, duration: null, attention: 'stack' }); });
      expect(icon()).toHaveAttribute('data-kind', kind);
      expect(icon()).toHaveAttribute('aria-hidden', 'true');
      expect(icon().querySelector('svg.cloudlet-glyph > path')).not.toBeNull();
      expect(icon().querySelector('.cloudlet-ring')).toBeNull();
    }
    act(() => { instance.clear(); instance.show({ title: 'Loading', kind: 'loading', duration: null, attention: 'stack' }); });
    expect(icon().querySelector('.cloudlet-spinner')).not.toBeNull();
    // With progress the ring is the activity indicator: no spinner inside it.
    act(() => { instance.clear(); instance.show({ title: 'Upload', kind: 'loading', duration: null, attention: 'stack', progress: { kind: 'indeterminate' } }); });
    expect(icon().querySelector('.cloudlet-spinner')).toBeNull();
    expect(icon().querySelector('.cloudlet-ring')).toHaveAttribute('data-progress', 'indeterminate');
    act(() => { instance.clear(); instance.show({ title: 'Custom', duration: null, attention: 'stack', icon: <span data-testid="own-icon">★</span> }); });
    expect(icon().querySelector('.cloudlet-glyph')).toContainElement(screen.getByTestId('own-icon'));
  });
});
