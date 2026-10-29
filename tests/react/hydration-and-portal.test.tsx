import { createContext, useContext } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CloudletProvider, Toaster, createCloudlet,
  type ControllerOptions, type ReactCloudletController,
} from '../../packages/toast/src/index.js';

const controllers: ReactCloudletController[] = [];
const roots: Root[] = [];
const extraContainers: Element[] = [];
function controller(options?: ControllerOptions) {
  const instance = createCloudlet(options);
  controllers.push(instance);
  return instance;
}
function container() {
  const element = document.createElement('div');
  document.body.append(element);
  extraContainers.push(element);
  return element;
}

beforeEach(() => vi.spyOn(document, 'hasFocus').mockReturnValue(true));
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  cleanup();
  controllers.splice(0).forEach((instance) => instance.dispose());
  extraContainers.splice(0).forEach((element) => element.remove());
  vi.restoreAllMocks();
});

describe('empty SSR and hydration-safe portals', () => {
  it('rejects SVG and disconnected portal targets before attachment', () => {
    for (const target of [document.createElementNS('http://www.w3.org/2000/svg', 'svg'), document.createElement('div')]) {
      if (target.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
        document.body.append(target); extraContainers.push(target);
      }
      const diagnostics = vi.fn();
      const instance = controller({ onDiagnostic: diagnostics });
      instance.show({ title: 'Awaiting readable HTML' });
      const mounted = render(<CloudletProvider controller={instance}><Toaster container={target} /></CloudletProvider>);
      expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid-container' }));
      expect(instance.getSnapshot().notifications[0]?.pauseReasons).toContain('no-host');
      expect(target.childNodes).toHaveLength(0);
      mounted.unmount();
    }
  });

  it('hydrates an empty server render while retaining a client event admitted before mount', async () => {
    const instance = controller();
    const mount = container();
    const resolveContainer = vi.fn(() => null);
    const tree = <CloudletProvider controller={instance}><Toaster container={resolveContainer} /></CloudletProvider>;
    mount.innerHTML = renderToString(tree);
    expect(mount.innerHTML).toBe('');
    expect(resolveContainer).not.toHaveBeenCalled();
    instance.show({ title: 'Arrived before hydration', duration: null });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const recoverableError = vi.fn();
    await act(async () => {
      roots.push(hydrateRoot(mount, tree, { onRecoverableError: recoverableError }));
    });
    expect(screen.getByText('Arrived before hydration')).toBeVisible();
    expect(within(mount).queryByText('Arrived before hydration')).not.toBeInTheDocument();
    expect(resolveContainer).toHaveBeenCalledTimes(1);
    expect(recoverableError).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('preserves React context through the portal and fixes the container for an attachment', () => {
    const Context = createContext('missing');
    function RichDescription() {
      return <span>{useContext(Context)}</span>;
    }
    const instance = controller();
    instance.show({
      title: 'Portal notification', duration: null,
      description: { kind: 'rich', content: <RichDescription />, announcement: 'Context visible' },
    });
    const first = container();
    const second = container();
    const resolveFirst = vi.fn(() => first);
    const resolveSecond = vi.fn(() => second);
    const mounted = render(
      <Context.Provider value="Portal context is preserved">
        <CloudletProvider controller={instance}><Toaster container={resolveFirst} /></CloudletProvider>
      </Context.Provider>,
    );
    expect(within(first).getByText('Portal notification')).toBeVisible();
    const pill = within(first).getByRole('button', { name: 'Portal notification' });
    act(() => pill.click());
    expect(within(first).getByText('Portal context is preserved')).toBeVisible();
    mounted.rerender(
      <Context.Provider value="Portal context is preserved">
        <CloudletProvider controller={instance}><Toaster container={resolveSecond} /></CloudletProvider>
      </Context.Provider>,
    );
    expect(resolveFirst).toHaveBeenCalledTimes(1);
    expect(resolveSecond).not.toHaveBeenCalled();
    expect(within(first).getByText('Portal notification')).toBeVisible();
    expect(second).toBeEmptyDOMElement();
    mounted.unmount();
    expect(first).toBeEmptyDOMElement();
    render(<CloudletProvider controller={instance}><Toaster container={resolveSecond} /></CloudletProvider>);
    expect(within(second).getByText('Portal notification')).toBeVisible();
  });

  it('diagnoses a container in another document and does not attach or consume the notification', () => {
    const diagnostics = vi.fn();
    const instance = controller({ onDiagnostic: diagnostics });
    const foreign = document.implementation.createHTMLDocument('Foreign document').body;
    instance.show({ title: 'Waiting for a valid host', duration: null });
    const mounted = render(<CloudletProvider controller={instance}><Toaster container={foreign} /></CloudletProvider>);
    expect(screen.queryByText('Waiting for a valid host')).not.toBeInTheDocument();
    expect(foreign.childNodes).toHaveLength(0);
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid-container' }));
    expect(instance.getSnapshot().notifications[0]?.pauseReasons).toContain('no-host');
    mounted.unmount();
    render(<CloudletProvider controller={instance}><Toaster /></CloudletProvider>);
    expect(screen.getByText('Waiting for a valid host')).toBeVisible();
  });

  it('keeps empty live hosts stable as cards arrive and leave without moving arrival focus', () => {
    const instance = controller();
    const outside = document.createElement('button');
    outside.textContent = 'External control';
    document.body.append(outside);
    extraContainers.push(outside);
    outside.focus();
    render(<CloudletProvider controller={instance}><Toaster /></CloudletProvider>);
    const polite = document.querySelector('[aria-live="polite"]');
    const assertive = document.querySelector('[aria-live="assertive"]');
    expect(polite).not.toBeNull();
    expect(assertive).not.toBeNull();
    expect(polite).toBeEmptyDOMElement();
    expect(assertive).toBeEmptyDOMElement();
    act(() => { instance.show({ title: 'Arrival', duration: null }); });
    expect(document.activeElement).toBe(outside);
    expect(polite).not.toContainElement(screen.getByText('Arrival'));
    expect(assertive).not.toContainElement(screen.getByText('Arrival'));
    act(() => instance.clear());
    expect(document.querySelector('[aria-live="polite"]')).toBe(polite);
    expect(document.querySelector('[aria-live="assertive"]')).toBe(assertive);
    expect(polite).toBeEmptyDOMElement();
    expect(assertive).toBeEmptyDOMElement();
  });

  it('plumbs per-instance labels, direction, theme and nonce without changing document attributes', () => {
    const first = controller();
    const second = controller();
    first.show({ title: 'Первое', duration: null });
    second.show({ title: 'Second', duration: null });
    const firstContainer = container();
    const secondContainer = container();
    const bodyAttributes = document.body.getAttributeNames().map((name) => [name, document.body.getAttribute(name)]);
    const documentAttributes = document.documentElement.getAttributeNames().map((name) => [name, document.documentElement.getAttribute(name)]);
    render(<>
      <CloudletProvider controller={first}>
        <Toaster container={firstContainer} theme="dark" dir="rtl" nonce="first-nonce" offsets={{ gutter: { top: 12 } }} labels={{ region: 'Оповещения', close: 'Закрыть', stackSummary: title => `Открыть: ${title}` }} />
      </CloudletProvider>
      <CloudletProvider controller={second}>
        <Toaster container={secondContainer} theme="light" dir="ltr" nonce="second-nonce" offsets={{ gutter: { top: 24 } }} />
      </CloudletProvider>
    </>);
    expect(within(firstContainer).getByRole('region', { name: 'Оповещения' })).toBeInTheDocument();
    const pill = within(firstContainer).getByRole('button', { name: 'Открыть: Первое' });
    act(() => pill.click());
    expect(within(firstContainer).getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();
    expect(within(secondContainer).getByRole('region', { name: 'Notifications' })).toBeInTheDocument();
    expect(firstContainer.querySelector('[dir="rtl"]')).not.toBeNull();
    expect(secondContainer.querySelector('[dir="ltr"]')).not.toBeNull();
    expect(firstContainer.querySelector('[data-theme="dark"]')).not.toBeNull();
    expect(secondContainer.querySelector('[data-theme="light"]')).not.toBeNull();
    expect(firstContainer.querySelector('[data-cloudlet-instance]')?.getAttribute('data-cloudlet-instance'))
      .not.toBe(secondContainer.querySelector('[data-cloudlet-instance]')?.getAttribute('data-cloudlet-instance'));
    expect(firstContainer.querySelector('style')?.nonce).toBe('first-nonce');
    expect(secondContainer.querySelector('style')?.nonce).toBe('second-nonce');
    expect(document.body.getAttributeNames().map((name) => [name, document.body.getAttribute(name)])).toEqual(bodyAttributes);
    expect(document.documentElement.getAttributeNames().map((name) => [name, document.documentElement.getAttribute(name)])).toEqual(documentAttributes);
  });
});
