import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudletProvider, Toaster, createCloudlet } from '../../packages/toast/src/index.js';
import type { ReactCloudletController } from '../../packages/toast/src/index.js';
import { getRendererBridge } from '../../packages/toast/src/core/bridge.js';

// The real host sampler: progress shares the single RAF of the host.
vi.unmock('../../packages/toast/src/react/motion.js');

const controllers: ReactCloudletController[] = [];
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
let time = 0;

beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
});
afterEach(() => {
  cleanup();
  controllers.splice(0).forEach(controller => controller.dispose());
  frames.clear(); frameId = time = 0;
});

function nextFrame() {
  time += 16;
  const callbacks = [...frames.values()];
  frames.clear();
  act(() => callbacks.forEach(callback => callback(time)));
}
function settle() {
  for (let index = 0; index < 400 && frames.size; index++) nextFrame();
  expect(frames.size).toBe(0);
}

function mount(strict = false) {
  const controller = createCloudlet();
  controllers.push(controller);
  const admitted = controller.show({ title: 'Uploading', duration: null, progress: { kind: 'determinate', value: 0.1 } });
  if (admitted.status !== 'created') throw new Error('The progress notification was not admitted');
  const tree = <CloudletProvider controller={controller}><Toaster /></CloudletProvider>;
  const mounted = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  settle();
  // The ring is drawn around the shared status icon already in the pill; the Island exposes it.
  fireEvent.click(document.querySelector('[data-cloudlet-pill]')!);
  settle();
  const progress = screen.getByRole('progressbar', { name: 'Uploading' });
  const fill = progress.querySelector('.cloudlet-ring > .cloudlet-progress-fill')!;
  return { controller, handle: admitted.handle, mounted, progress, fill };
}
/** Drawn arc of the ring in percent (`pathLength` is 100). */
const arc = (fill: Element) => Number(fill.getAttribute('stroke-dasharray')?.split(' ')[0]);

describe('progress through the host sampler', () => {
  it('tweens from the shown value to the latest of several commits and then stops the frame loop', () => {
    const { controller, handle, progress, fill } = mount();
    expect(progress).toHaveAttribute('aria-valuenow', '10');
    expect(fill).toHaveAttribute('stroke-dasharray', '10 100');
    expect(progress).toHaveClass('cloudlet-icon');
    expect(document.querySelector('.cloudlet-progress')).toBeNull();
    const bridge = getRendererBridge(controller);
    const presentation = bridge.getSnapshot().presentation?.token;
    for (const value of [0.2, 0.4, 0.75]) {
      act(() => flushSync(() => { controller.update(handle, { progress: { kind: 'determinate', value } }); }));
    }
    // The accessible value is immediate; the bar starts from what was shown.
    expect(progress).toHaveAttribute('aria-valuenow', '75');
    expect(arc(fill)).toBeLessThan(20);
    nextFrame();
    const moving = arc(fill);
    expect(moving).toBeGreaterThan(10);
    expect(moving).toBeLessThan(75);
    settle();
    expect(fill).toHaveAttribute('stroke-dasharray', '75 100');
    expect(bridge.getSnapshot().presentation).toMatchObject({ token: presentation, readable: true });
  });

  it('preserves progress semantics and leaves the indeterminate arc to markup', () => {
    const { controller, handle, progress, fill } = mount();
    act(() => flushSync(() => { controller.update(handle, { progress: { kind: 'indeterminate', label: 'Waiting for the server' } }); }));
    expect(screen.getByRole('progressbar', { name: 'Waiting for the server' })).toBe(progress);
    settle();
    expect(progress).toHaveAttribute('aria-valuemin', '0');
    expect(progress).toHaveAttribute('aria-valuemax', '100');
    expect(progress).not.toHaveAttribute('aria-valuenow');
    expect(fill).toHaveAttribute('stroke-dasharray', '25 75');
    expect(fill.parentElement).toHaveAttribute('data-progress', 'indeterminate');
    act(() => flushSync(() => { controller.update(handle, { progress: { kind: 'determinate', value: 1 } }); }));
    expect(screen.getByRole('progressbar', { name: 'Uploading' })).toHaveAttribute('aria-valuenow', '100');
    // A new determinate phase starts at its value instead of tweening from the indeterminate look.
    expect(fill).toHaveAttribute('stroke-dasharray', '100 100');
    settle();
    expect(fill).toHaveAttribute('stroke-dasharray', '100 100');
  });

  it('draws the ring in the collapsed pill and tweens it there as well', () => {
    const controller = createCloudlet();
    controllers.push(controller);
    const admitted = controller.show({ title: 'Uploading', duration: null, attention: 'stack', progress: { kind: 'determinate', value: 0.3 } });
    if (admitted.status !== 'created') throw new Error('The progress notification was not admitted');
    render(<CloudletProvider controller={controller}><Toaster /></CloudletProvider>);
    settle();
    expect(document.querySelector('.cloudlet-host')).toHaveAttribute('data-state', 'stack');
    const fill = document.querySelector('.cloudlet-heading .cloudlet-progress-fill')!;
    expect(fill).toHaveAttribute('stroke-dasharray', '30 100');
    act(() => flushSync(() => { controller.update(admitted.handle, { progress: { kind: 'determinate', value: 0.6 } }); }));
    nextFrame();
    expect(arc(fill)).toBeGreaterThan(30);
    expect(arc(fill)).toBeLessThan(60);
    settle();
    expect(fill).toHaveAttribute('stroke-dasharray', '60 100');
    // Collapsed, the header is hidden from assistive technology: the pill names the record.
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('cancels pending progress writes across Strict Mode cleanup and unmount', () => {
    const { controller, handle, mounted, fill } = mount(true);
    act(() => flushSync(() => { controller.update(handle, { progress: { kind: 'determinate', value: 0.9 } }); }));
    const write = vi.spyOn(fill, 'setAttribute');
    mounted.unmount();
    nextFrame();
    expect(write).not.toHaveBeenCalled();
    expect(controller.getSnapshot().notifications).toHaveLength(1);
    expect(frames.size).toBe(0);
  });
});
