import { renderToString } from 'react-dom/server';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactCloudletController } from '../../packages/toast/src/index.js';

// tests/setup/react.ts preloads the renderer for every other adapter test. A fresh module
// graph here starts cold, as a page does: the renderer chunk is not loaded yet.
type Package = typeof import('../../packages/toast/src/index.js');
type Bindings = typeof import('../../packages/toast/src/react/bindings.js');
let cloudlet: Package;
let bindings: Bindings;
const controllers: ReactCloudletController[] = [];

beforeEach(async () => {
  vi.resetModules();
  cloudlet = await import('../../packages/toast/src/index.js');
  bindings = await import('../../packages/toast/src/react/bindings.js');
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  controllers.splice(0).forEach((instance) => instance.dispose());
  vi.doUnmock('../../packages/toast/src/react/renderer.js');
  vi.restoreAllMocks();
});

function controller(options?: Parameters<Package['createCloudlet']>[0]) {
  const instance = cloudlet.createCloudlet(options);
  controllers.push(instance);
  return instance;
}

describe('lazily loaded renderer', () => {
  it('renders no host until the chunk arrives, then shows what was queued before it', async () => {
    const { CloudletProvider, Toaster } = cloudlet;
    const instance = controller();
    instance.show({ title: 'Queued before the renderer', duration: null });
    render(<CloudletProvider controller={instance}><Toaster /></CloudletProvider>);
    expect(document.querySelector('.cloudlet-host')).toBeNull();
    expect(instance.getSnapshot().notifications[0]?.pauseReasons).toContain('no-host');
    expect(await screen.findByText('Queued before the renderer')).toBeVisible();
    expect(document.querySelectorAll('.cloudlet-host')).toHaveLength(1);
  });

  it('fetches the chunk once for every Toaster', async () => {
    const { CloudletProvider, Toaster } = cloudlet;
    expect(bindings.loadRenderer()).toBe(bindings.loadRenderer());
    const first = controller();
    const second = controller();
    first.show({ title: 'First page owner', duration: null });
    second.show({ title: 'Second page owner', duration: null });
    render(<>
      <CloudletProvider controller={first}><Toaster /></CloudletProvider>
      <CloudletProvider controller={second}><Toaster /></CloudletProvider>
    </>);
    expect(await screen.findByText('First page owner')).toBeVisible();
    expect(await screen.findByText('Second page owner')).toBeVisible();
  });

  it('does not start the chunk during a server render', () => {
    const { CloudletProvider, Toaster } = cloudlet;
    const instance = controller();
    instance.show({ title: 'Server render', duration: null });
    expect(renderToString(<CloudletProvider controller={instance}><Toaster /></CloudletProvider>)).toBe('');
    // Nothing is cached: the first client call is the one that starts the fetch.
    const started = bindings.loadRenderer();
    expect(bindings.loadRenderer()).toBe(started);
  });

  it('reports a failed chunk as a diagnostic and fetches again on the next mount', async () => {
    vi.doMock('../../packages/toast/src/react/renderer.js', () => { throw new Error('offline'); });
    const { CloudletProvider, Toaster } = cloudlet;
    const diagnostics = vi.fn();
    const instance = controller({ onDiagnostic: diagnostics });
    instance.show({ title: 'Waiting for the network', duration: null });
    const first = render(<CloudletProvider controller={instance}><Toaster /></CloudletProvider>);
    await vi.waitFor(() => expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({
      code: 'renderer-load-error', source: 'Toaster', error: expect.any(Error),
    })));
    expect(document.querySelector('.cloudlet-host')).toBeNull();
    act(() => first.unmount());
    vi.doUnmock('../../packages/toast/src/react/renderer.js');
    render(<CloudletProvider controller={instance}><Toaster /></CloudletProvider>);
    expect(await screen.findByText('Waiting for the network')).toBeVisible();
  });
});
