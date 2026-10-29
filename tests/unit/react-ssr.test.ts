import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.restoreAllMocks());

describe('React entry without a DOM', () => {
  it('imports, constructs and server-renders a stable empty host without browser access or timers', async () => {
    expect('window' in globalThis).toBe(false);
    expect('document' in globalThis).toBe(false);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const api = await import('../../packages/toast/src/index.js');
    const controller = api.createCloudlet();
    const server = controller.getServerSnapshot();
    controller.show({ title: 'Queued before SSR' });
    const resolveContainer = vi.fn(() => { throw new Error('The container resolver must wait for mount'); });
    const tree = createElement(api.CloudletProvider, { controller }, createElement(api.Toaster, { container: resolveContainer }));
    expect(renderToString(tree)).toBe('');
    expect(renderToString(tree)).toBe('');
    expect(controller.getServerSnapshot()).toBe(server);
    expect(server.notifications).toEqual([]);
    expect(controller.getSnapshot().notifications).toHaveLength(1);
    expect(resolveContainer).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    controller.dispose();
  });
});
