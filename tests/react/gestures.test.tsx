import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CloudletProvider, Toaster, createCloudlet,
  type NotificationHandle, type ReactCloudletController, type ReactNotificationSpec, type ToasterProps,
} from '../../packages/toast/src/index.js';
import { motionControl } from '../support/motion-mock.js';

const controllers: ReactCloudletController[] = [];
function controller(options: Parameters<typeof createCloudlet>[0] = { autoDismiss: false }) {
  const instance = createCloudlet(options);
  controllers.push(instance);
  return instance;
}
function tree(instance: ReactCloudletController, options: ToasterProps = {}) {
  return <CloudletProvider controller={instance}><Toaster {...options} /></CloudletProvider>;
}
function admit(instance: ReactCloudletController, title: string, options: Partial<ReactNotificationSpec> = {}): NotificationHandle {
  let handle!: NotificationHandle;
  act(() => {
    const result = instance.show({ title, attention: 'stack', ...options });
    if (result.status !== 'created') throw new Error('Notification not created');
    handle = result.handle;
  });
  return handle;
}
const host = () => screen.getByRole('region', { name: 'Notifications' });
const pill = () => document.querySelector<HTMLButtonElement>('[data-cloudlet-pill]')!;
const title = () => document.querySelector<HTMLElement>('.cloudlet-clip > .cloudlet-slide [data-cloudlet-title]')!;
const peek = () => document.querySelector<HTMLElement>('.cloudlet-clip > .cloudlet-peek');
const pauses = (instance: ReactCloudletController, handle: NotificationHandle) =>
  instance.getSnapshot().notifications.find(item => item.handle === handle)?.pauseReasons ?? [];

let time = 0;
/** Pointer events as jsdom lacks PointerEvent: pointerId, isPrimary and timeStamp are defined on a MouseEvent. */
function pointer(type: string, target: EventTarget, x: number, y = 0, at = (time += 16), id = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, detail: 1 });
  Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: id === 1 }, timeStamp: { value: at } });
  act(() => { target.dispatchEvent(event); });
  return event;
}
/** down → moves → up; `points` are absolute client positions, 16 ms apart. */
function swipe(target: Element, points: readonly (readonly [number, number])[], up = true) {
  const [start, ...rest] = points;
  pointer('pointerdown', target, start![0], start![1]);
  const moves = rest.map(([x, y]) => pointer('pointermove', target, x, y));
  if (up) { const [x, y] = rest.at(-1) ?? start!; pointer('pointerup', target, x, y); }
  return moves;
}
const calls = (prefix: string) => motionControl.calls.filter(call => call.startsWith(prefix));
function open(instance: ReactCloudletController) {
  act(() => pill().click());
  expect(instance.getSnapshot().island.open).toBe(true);
}

const captures = new Set<number>();
beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  captures.clear();
  HTMLElement.prototype.setPointerCapture = vi.fn((id: number) => { captures.add(id); });
  HTMLElement.prototype.hasPointerCapture = vi.fn((id: number) => captures.has(id));
  HTMLElement.prototype.releasePointerCapture = vi.fn((id: number) => { captures.delete(id); });
});
afterEach(() => {
  controllers.splice(0).forEach(instance => instance.dispose());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('stack: horizontal swipe dismiss of the top pill', () => {
  it('follows the finger, pauses the record, and flings it out with reason swipe while the tails stay', () => {
    const instance = controller();
    const closed = vi.fn();
    const older = admit(instance, 'Older');
    const top = admit(instance, 'Top', { onClose: closed });
    render(tree(instance));
    motionControl.calls.length = 0;
    pointer('pointerdown', pill(), 100, 10);
    expect(pauses(instance, top)).toContain('gesture');
    // Below the 8 px intent nothing moves and nothing is captured.
    expect(pointer('pointermove', pill(), 106, 11).defaultPrevented).toBe(false);
    expect(calls('drag')).toEqual([]);
    expect(pointer('pointermove', pill(), 140, 12).defaultPrevented).toBe(true);
    expect(captures.has(1)).toBe(true);
    expect(host()).toHaveAttribute('data-dragging', 'x');
    pointer('pointermove', pill(), 230, 12);
    expect(calls('drag')).toEqual(['drag:dragX:40', 'drag:dragX:130']);
    // Only the pill follows: tails, presence and morph stay untouched during the drag
    // (the pause commit only re-confirms the badge and the measured shape).
    expect(motionControl.calls.filter(call => !/^(drag|shape|badge):/u.test(call))).toEqual([]);
    pointer('pointerup', pill(), 230, 12);
    expect(closed).toHaveBeenCalledWith(expect.objectContaining({ handle: top, reason: 'swipe' }));
    expect(motionControl.calls).toContain('exit:fling:1');
    expect(motionControl.calls).toContain('rise');
    expect(calls('release')).toEqual([]);
    expect(host()).not.toHaveAttribute('data-dragging');
    expect(captures.size).toBe(0);
    expect(instance.getSnapshot().stack).toEqual([older]);
    expect(pauses(instance, older)).not.toContain('gesture');
  });

  it.each([[-24, 0.6], [-200, 0]])('dismisses leftwards by velocity or distance (%s px)', (distance, speed) => {
    const instance = controller();
    admit(instance, 'Older');
    const top = admit(instance, 'Top');
    render(tree(instance));
    pointer('pointerdown', pill(), 300, 0, 1000);
    pointer('pointermove', pill(), 300 + distance / 2, 0, 1000 + (speed ? Math.abs(distance / 2) / speed : 300));
    pointer('pointermove', pill(), 300 + distance, 0, 1000 + (speed ? Math.abs(distance) / speed : 600));
    pointer('pointerup', pill(), 300 + distance, 0, 1000 + (speed ? Math.abs(distance) / speed + 1 : 610));
    expect(instance.getSnapshot().stack).not.toContain(top);
    expect(motionControl.calls).toContain('exit:fling:-1');
  });

  it('springs back below the threshold and suppresses the click that follows the drag', () => {
    const instance = controller();
    const top = admit(instance, 'Top');
    render(tree(instance));
    pointer('pointerdown', pill(), 100, 0, 1000);
    pointer('pointermove', pill(), 130, 0, 1100);
    pointer('pointerup', pill(), 130, 0, 1400);
    expect(calls('release')).toEqual(['release:dragX:0']);
    expect(instance.getSnapshot().stack).toEqual([top]);
    expect(pauses(instance, top)).not.toContain('gesture');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    act(() => { pill().dispatchEvent(click); });
    expect(click.defaultPrevented).toBe(true);
    expect(instance.getSnapshot().island.open).toBe(false);
    // Keyboard and AT activation (detail 0) is never suppressed.
    act(() => pill().click());
    expect(instance.getSnapshot().island.open).toBe(true);
  });

  it('leaves vertical travel to the page: no capture, no prevented move, the pause ends', () => {
    const instance = controller();
    const top = admit(instance, 'Top');
    render(tree(instance));
    const moves = swipe(pill(), [[100, 100], [102, 112], [104, 160]], false);
    expect(moves.map(move => move.defaultPrevented)).toEqual([false, false]);
    expect(captures.size).toBe(0);
    expect(calls('drag')).toEqual([]);
    expect(pauses(instance, top)).not.toContain('gesture');
    pointer('pointerup', pill(), 104, 160);
    expect(instance.getSnapshot().stack).toEqual([top]);
  });

  it('cancels when the target changes under the finger (a new arrival takes the top)', () => {
    const instance = controller();
    const first = admit(instance, 'First');
    render(tree(instance));
    swipe(pill(), [[100, 0], [140, 0], [180, 0]], false);
    expect(calls('drag')).toHaveLength(2);
    const second = admit(instance, 'Second');
    expect(calls('release')).toEqual(['release:dragX:0']);
    expect(host()).not.toHaveAttribute('data-dragging');
    pointer('pointerup', pill(), 400, 0);
    expect(instance.getSnapshot().stack).toEqual([second, first]);
  });

  it.each(['cancel', 'lostcapture', 'second pointer'])('cancels on %s and springs back', reason => {
    const instance = controller();
    const top = admit(instance, 'Top');
    render(tree(instance));
    swipe(pill(), [[100, 0], [150, 0], [260, 0]], false);
    if (reason === 'cancel') pointer('pointercancel', pill(), 260);
    else if (reason === 'lostcapture') pointer('lostpointercapture', host(), 260);
    else pointer('pointerdown', pill(), 10, 0, time += 16, 2);
    expect(calls('release')).toEqual(['release:dragX:0']);
    pointer('pointerup', pill(), 260);
    expect(instance.getSnapshot().stack).toEqual([top]);
    expect(pauses(instance, top)).not.toContain('gesture');
  });

  it('keeps the swipe when touch moves the implicit capture from the pill to the host', () => {
    const instance = controller();
    admit(instance, 'Older');
    const top = admit(instance, 'Top');
    render(tree(instance));
    swipe(pill(), [[100, 0], [120, 0]], false);
    // The pill's own (implicit) capture loss bubbles to the host: not a cancellation.
    pointer('lostpointercapture', pill(), 120);
    expect(calls('release')).toEqual([]);
    pointer('pointermove', pill(), 260);
    pointer('pointerup', pill(), 260);
    expect(instance.getSnapshot().stack).not.toContain(top);
  });

  it('blocks native drag and selection only while it owns a press', () => {
    const instance = controller();
    admit(instance, 'Top');
    render(tree(instance));
    const dragstart = () => { const event = new Event('dragstart', { bubbles: true, cancelable: true }); act(() => { pill().dispatchEvent(event); }); return event.defaultPrevented; };
    const selectstart = () => { const event = new Event('selectstart', { bubbles: true, cancelable: true }); act(() => { pill().dispatchEvent(event); }); return event.defaultPrevented; };
    expect(dragstart()).toBe(false);
    pointer('pointerdown', pill(), 100, 0);
    expect(dragstart()).toBe(true);
    expect(selectstart()).toBe(false);
    pointer('pointermove', pill(), 130, 0);
    expect(selectstart()).toBe(true);
    pointer('pointerup', pill(), 130, 0, time += 500);
    expect(dragstart()).toBe(false);
    expect(selectstart()).toBe(false);
  });

  it('turns swipes off under reduced motion', () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('reduced-motion'), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const instance = controller();
    const top = admit(instance, 'Top');
    render(tree(instance));
    swipe(pill(), [[100, 0], [150, 0], [300, 0]]);
    expect(calls('drag')).toEqual([]);
    expect(instance.getSnapshot().stack).toEqual([top]);
  });
});

describe('Island: horizontal swipe navigation', () => {
  function three() {
    const instance = controller();
    // Only the body slides (task 17): the preview shows the neighbour's body, so each record has one.
    const [a, b, c] = ['A', 'B', 'C'].map(name => admit(instance, name, { description: { kind: 'text', text: `${name} body` } }));
    return { instance, a: a!, b: b!, c: c! };
  }

  it('shows the inert neighbour only during the drag and navigates on release with the release velocity', () => {
    const { instance, b, c } = three();
    render(tree(instance));
    open(instance);
    motionControl.calls.length = 0;
    pointer('pointerdown', title(), 200, 20);
    expect(pauses(instance, c)).toContain('gesture');
    pointer('pointermove', title(), 140, 22);
    const preview = peek();
    expect(preview).not.toBeNull();
    expect(preview).toHaveAttribute('inert');
    expect(preview).toHaveAttribute('aria-hidden', 'true');
    expect(preview).toHaveTextContent('B body');
    expect(preview!.querySelector('.cloudlet-heading')).toBeNull();
    for (const node of preview!.querySelectorAll('*')) {
      for (const { name } of node.attributes) expect(name === 'id' || name === 'href' || name.startsWith('data-cloudlet-'), name).toBe(false);
    }
    // The live slide is still the only `.cloudlet-slide` child of the clip.
    expect(document.querySelectorAll('.cloudlet-clip > .cloudlet-slide')).toHaveLength(1);
    pointer('pointermove', title(), 40, 22);
    expect(calls('drag')).toEqual(['drag:slide:-60', 'drag:slide:-160']);
    pointer('pointerup', title(), 40, 22);
    expect(instance.getSnapshot().island.current).toBe(b);
    expect(calls('fling')).toHaveLength(1);
    expect(calls('fling')[0]).toMatch(/^fling:slide:-\d+/u);
    expect(motionControl.calls).toContain('slide:1');
    expect(peek()).toBeNull();
    expect(pauses(instance, c)).not.toContain('gesture');
    // The shell never morphs or moves for a swipe navigation.
    expect(motionControl.calls.some(call => call === 'open' || call.startsWith('collapse') || call.startsWith('drag:dragX'))).toBe(false);
  });

  it('navigates towards newer records with a rightward swipe and springs back below the threshold', () => {
    const { instance, a, b } = three();
    render(tree(instance));
    open(instance);
    act(() => { instance.getSnapshot(); });
    act(() => screen.getAllByRole('button', { name: /of 3$/u })[1]!.click());
    expect(instance.getSnapshot().island.current).toBe(b);
    motionControl.calls.length = 0;
    pointer('pointerdown', title(), 100, 20, 5000);
    pointer('pointermove', title(), 150, 20, 5100);
    expect(peek()).toHaveTextContent('C body');
    pointer('pointerup', title(), 150, 20, 5400);
    expect(instance.getSnapshot().island.current).toBe(b);
    expect(calls('release')).toEqual(['release:slide:0']);
    expect(peek()).toBeNull();
    swipe(title(), [[100, 20], [180, 20], [260, 20]]);
    expect(instance.getSnapshot().island.current).not.toBe(b);
    expect(instance.getSnapshot().island.current).not.toBe(a);
    expect(motionControl.calls).toContain('slide:-1');
  });

  it('resists at the edges with a rubber band and no neighbour', () => {
    const { instance, c } = three();
    render(tree(instance));
    open(instance);
    swipe(title(), [[100, 20], [110, 20], [300, 20]]);
    const drag = calls('drag:slide').map(call => Number(call.split(':')[2]));
    expect(drag.at(-1)).toBeGreaterThan(0);
    expect(drag.at(-1)).toBeLessThan(100);
    expect(peek()).toBeNull();
    expect(instance.getSnapshot().island.current).toBe(c);
    expect(calls('release')).toEqual(['release:slide:0']);
  });

  it('mirrors the sides in RTL: older records lie to the left', () => {
    const { instance, b, c } = three();
    render(tree(instance, { dir: 'rtl' }));
    expect(host()).toHaveAttribute('dir', 'rtl');
    open(instance);
    // Leftwards there is nothing newer than the top record in RTL: resistance.
    swipe(title(), [[300, 20], [290, 20], [100, 20]]);
    expect(instance.getSnapshot().island.current).toBe(c);
    expect(peek()).toBeNull();
    motionControl.calls.length = 0;
    pointer('pointerdown', title(), 100, 20);
    pointer('pointermove', title(), 160, 20);
    expect(peek()).toHaveTextContent('B body');
    pointer('pointermove', title(), 300, 20);
    pointer('pointerup', title(), 300, 20);
    expect(instance.getSnapshot().island.current).toBe(b);
    // Logical +1 (older) arrives from the left in RTL.
    expect(motionControl.calls).toContain('slide:-1');
  });

  it('mirrors keyboard slides in RTL', async () => {
    const user = userEvent.setup();
    const { instance, b } = three();
    render(tree(instance, { dir: 'rtl' }));
    act(() => pill().focus());
    await user.keyboard('{Enter}');
    motionControl.calls.length = 0;
    await user.keyboard('{ArrowLeft}');
    expect(instance.getSnapshot().island.current).toBe(b);
    expect(motionControl.calls).toContain('slide:-1');
  });

  it('never starts from buttons or links inside the Island', () => {
    const { instance, c } = three();
    render(tree(instance));
    open(instance);
    const close = screen.getByRole('button', { name: 'Close notification' });
    swipe(close, [[100, 20], [160, 20], [300, 20]]);
    const dot = screen.getAllByRole('button', { name: /of 3$/u })[2]!;
    swipe(dot, [[100, 20], [160, 20], [300, 20]]);
    expect(calls('drag')).toEqual([]);
    expect(instance.getSnapshot().island.current).toBe(c);
    expect(pauses(instance, c)).not.toContain('gesture');
  });

  it('navigates with a horizontal trackpad swipe and leaves vertical wheel scrolling alone', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { instance, b, c } = three();
    render(tree(instance));
    open(instance);
    const wheel = (deltaX: number, deltaY: number) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX, deltaY });
      Object.defineProperty(event, 'timeStamp', { value: time += 16 });
      act(() => { title().dispatchEvent(event); });
      return event;
    };
    expect(wheel(0, 40).defaultPrevented).toBe(false);
    expect(wheel(30, 4).defaultPrevented).toBe(false);
    act(() => { vi.advanceTimersByTime(200); });
    expect(calls('drag')).toEqual([]);
    const slow = wheel(10, 1);
    expect(slow.defaultPrevented).toBe(true);
    expect(calls('drag:slide')).toEqual(['drag:slide:-10']);
    expect(peek()).toHaveTextContent('B body');
    expect(instance.getSnapshot().island.current).not.toBe(b);
    // A flick commits at once (task 17): the momentum tail of the same stream is swallowed, not dragged.
    const events = [40, 40, 40].map(delta => wheel(delta, 2));
    expect(events.every(event => event.defaultPrevented)).toBe(true);
    expect(calls('drag:slide')).toEqual(['drag:slide:-10', 'drag:slide:-50']);
    expect(instance.getSnapshot().island.current).toBe(b);
    expect(peek()).toBeNull();
    expect(host()).not.toHaveAttribute('data-dragging');
    // Vertical scrolling during the momentum tail stays native; a reversed swipe starts a new stream at once.
    expect(wheel(3, 40).defaultPrevented).toBe(false);
    // Within `wheelLock` the same stream cannot commit again, however it accelerates (one gesture keeps speeding up).
    expect(wheel(80, 0).defaultPrevented).toBe(true);
    expect(calls('drag:slide')).toEqual(['drag:slide:-10', 'drag:slide:-50']);
    for (let i = 0; i < 26; i++) wheel(20, 0);
    expect(calls('drag:slide')).toEqual(['drag:slide:-10', 'drag:slide:-50']);
    expect(wheel(-60, 0).defaultPrevented).toBe(true);
    expect(wheel(-60, 0).defaultPrevented).toBe(true);
    expect(calls('drag:slide')).toEqual(['drag:slide:-10', 'drag:slide:-50', 'drag:slide:60', 'drag:slide:120']);
    expect(instance.getSnapshot().island.current).toBe(c);
    act(() => { vi.advanceTimersByTime(140); });
    expect(instance.getSnapshot().island.current).toBe(c);
  });

  it('ignores trackpad swipes on the collapsed stack and pinch zoom', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { instance } = three();
    render(tree(instance));
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 60 });
    act(() => { pill().dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    open(instance);
    act(() => { vi.advanceTimersByTime(200); });
    const zoom = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 60, ctrlKey: true });
    act(() => { title().dispatchEvent(zoom); });
    expect(zoom.defaultPrevented).toBe(false);
    expect(calls('drag')).toEqual([]);
  });
});

describe('Island: vertical swipe on the header collapses to the stack', () => {
  it('collapses on a swipe towards the top edge, keeps body scrolling native', () => {
    const instance = controller();
    admit(instance, 'Older');
    admit(instance, 'Details', { description: { kind: 'text', text: 'Long body text' } });
    render(tree(instance, { position: 'top-center' }));
    open(instance);
    const body = screen.getByText('Long body text');
    const moves = swipe(body, [[100, 100], [101, 80], [101, 20]]);
    expect(moves.map(move => move.defaultPrevented)).toEqual([false, false]);
    expect(instance.getSnapshot().island.open).toBe(true);
    // Away from the edge: strong resistance and no collapse.
    swipe(title(), [[100, 30], [100, 60], [100, 200]]);
    expect(Number(calls('drag:dragY').at(-1)!.split(':')[2])).toBeLessThan(24);
    expect(instance.getSnapshot().island.open).toBe(true);
    motionControl.calls.length = 0;
    swipe(title(), [[100, 60], [100, 40], [100, -40]]);
    const dragged = calls('drag:dragY').map(call => Number(call.split(':')[2]));
    expect(dragged.at(-1)).toBeLessThan(0);
    expect(dragged.at(-1)).toBeGreaterThan(-100);
    expect(instance.getSnapshot().island.open).toBe(false);
    expect(host()).toHaveAttribute('data-state', 'stack');
    expect(motionControl.calls).toContain('release:dragY:0');
    expect(motionControl.calls).toContain('collapse:1');
  });

  it('commits a slow pull of 32 px towards the edge even when 30% of a tall Island is out of reach', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      width: 352, height: 300, top: 0, left: 0, right: 352, bottom: 300, x: 0, y: 0, toJSON() {},
    }));
    const instance = controller();
    admit(instance, 'Tall');
    render(tree(instance, { position: 'top-center' }));
    open(instance);
    const slow = (distance: number) => {
      pointer('pointerdown', title(), 100, 60, time += 16);
      pointer('pointermove', title(), 100, 60 - distance, time += 400);
      pointer('pointerup', title(), 100, 60 - distance, time += 400);
    };
    slow(31);
    expect(instance.getSnapshot().island.open).toBe(true);
    slow(33);
    expect(instance.getSnapshot().island.open).toBe(false);
  });

  it('collapses downwards at the bottom edge and leaves the record in the stack', () => {
    const instance = controller();
    const only = admit(instance, 'Only');
    render(tree(instance, { position: 'bottom-center' }));
    expect(host()).toHaveAttribute('data-edge', 'bottom');
    open(instance);
    swipe(title(), [[100, 60], [100, 40], [100, -60]]);
    expect(instance.getSnapshot().island.open).toBe(true);
    swipe(title(), [[100, 60], [100, 80], [100, 160]]);
    expect(instance.getSnapshot().island.open).toBe(false);
    expect(instance.getSnapshot().stack).toEqual([only]);
  });
});

describe('placement', () => {
  it('re-evaluates the auto edge when the 48rem breakpoint flips', () => {
    let wide = false;
    const listeners: (() => void)[] = [];
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      get matches() { return query.includes('min-width') ? wide : false; },
      addEventListener: (_: string, callback: () => void) => { if (query.includes('min-width')) listeners.push(callback); },
      removeEventListener: vi.fn(),
    })));
    const instance = controller();
    admit(instance, 'Only');
    render(tree(instance));
    expect(host()).toHaveAttribute('data-position', 'auto');
    expect(host()).toHaveAttribute('data-edge', 'bottom');
    wide = true;
    act(() => listeners.forEach(listener => listener()));
    expect(host()).toHaveAttribute('data-edge', 'top');
  });

  it('keeps explicit positions regardless of the breakpoint', () => {
    const instance = controller();
    admit(instance, 'Only');
    const view = render(tree(instance, { position: 'bottom-center' }));
    expect(host()).toHaveAttribute('data-edge', 'bottom');
    view.rerender(tree(instance, { position: 'top-center' }));
    expect(host()).toHaveAttribute('data-edge', 'top');
  });
});

describe('attention while the user interacts', () => {
  const action = { kind: 'command' as const, label: 'Undo', run: vi.fn() };

  it('defers the auto-open while a swipe holds the pill and restarts the delay afterwards', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const application = document.createElement('button');
    document.body.append(application);
    application.focus();
    const instance = controller();
    render(tree(instance, { attention: { delay: 300 } }));
    const candidate = admit(instance, 'Undo available', { attention: 'auto', action });
    // A slow drag that springs back: the record stays.
    pointer('pointerdown', pill(), 100, 0, time += 16);
    pointer('pointermove', pill(), 130, 0, time += 400);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(instance.getSnapshot().island.open).toBe(false);
    expect(pauses(instance, candidate)).toContain('gesture');
    pointer('pointerup', pill(), 130, 0, time += 400);
    expect(instance.getSnapshot().stack).toEqual([candidate]);
    act(() => { vi.advanceTimersByTime(299); });
    expect(instance.getSnapshot().island.open).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(instance.getSnapshot().island).toEqual({ open: true, reason: 'attention', current: candidate });
    expect(application).toHaveFocus();
    application.remove();
  });

  it('defers while the pointer hovers the host', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const instance = controller();
    render(tree(instance, { attention: { delay: 200 } }));
    const candidate = admit(instance, 'Undo available', { attention: 'auto', action });
    act(() => { host().dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(instance.getSnapshot().island.open).toBe(false);
    act(() => { host().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(instance.getSnapshot().island.current).toBe(candidate);
  });
});
