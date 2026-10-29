import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudletProvider, Toaster, createCloudlet } from '../../packages/toast/src/index.js';
import type { ReactCloudletController, ToasterProps } from '../../packages/toast/src/index.js';
import { getRendererBridge } from '../../packages/toast/src/core/bridge.js';
import { createDeferred } from '../support/deferred.js';

const controllers: ReactCloudletController[] = [];
function create() {
  const controller = createCloudlet({ autoDismiss: false });
  controllers.push(controller);
  return controller;
}
function mount(controller: ReactCloudletController, props: ToasterProps = {}) {
  const tree = <StrictMode><CloudletProvider controller={controller}><Toaster {...props} /></CloudletProvider></StrictMode>;
  const result = render(tree);
  const polite = document.querySelector('[data-cloudlet-announcer="polite"]')!;
  const assertive = document.querySelector('[data-cloudlet-announcer="assertive"]')!;
  return { ...result, polite, assertive };
}
async function advance(ms = 300) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function visibility(state: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});
afterEach(() => {
  cleanup(); controllers.splice(0).forEach(controller => controller.dispose());
  vi.useRealTimers(); vi.restoreAllMocks();
});

describe('one semantic announcer on the existing live hosts', () => {
  it('starts empty, coalesces a fixed 300 ms burst and uses explicit urgency rather than error kind', async () => {
    const controller = create();
    controller.show({ title: 'Urgent', announcementPriority: 'assertive' });
    const { polite, assertive } = mount(controller);
    expect(polite).toBeEmptyDOMElement(); expect(assertive).toBeEmptyDOMElement();
    await advance(200);
    // The newer record takes the top; the older one speaks as an aggregate on its own channel.
    act(() => { controller.show({ title: 'Routine error', kind: 'error' }); });
    await advance(99);
    expect(polite).toBeEmptyDOMElement();
    await advance(1);
    expect(polite.textContent).toBe('Routine error');
    expect(assertive.textContent).toBe('1 notifications queued');
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(2);
  });

  it('announces an aggregate stack, then latest rich announcement on first presentation, never visual slot text', async () => {
    const controller = create();
    const queued = controller.show({ title: 'Old queued title', attention: 'stack', description: { kind: 'rich', content: <span>Visual only</span>, announcement: 'Original spoken body' } });
    const current = controller.show({ title: 'Current' });
    if (queued.status !== 'created' || current.status !== 'created') throw new Error('admission');
    const { polite } = mount(controller);
    await advance();
    expect(polite.textContent).toBe('Current. 1 notifications queued');
    act(() => { controller.update(queued.handle, { title: 'Latest title', description: { kind: 'rich', content: <span>Still visual only</span>, announcement: 'Текущий текст العربية' } }); controller.dismiss(current.handle); });
    await advance(600);
    expect(polite.textContent).toBe('Latest title. Текущий текст العربية');
    const write = vi.spyOn(polite, 'replaceChildren');
    const other = controller.show({ title: 'Silent top', announcementPriority: 'off' });
    if (other.status !== 'created') throw new Error('admission');
    await advance();
    act(() => { controller.dismiss(other.handle); });
    await advance();
    expect(write).not.toHaveBeenCalled();
  });

  it('speaks a slide shown again inside the open Island (back navigation, the next after a close), never on open or collapse', async () => {
    const controller = create();
    for (const title of ['Oldest', 'Middle', 'Newest']) controller.show({ title, attention: 'stack' });
    const { polite } = mount(controller);
    await advance();
    expect(polite.textContent).toBe('Newest. 2 notifications queued');
    const write = vi.spyOn(polite, 'replaceChildren');
    act(() => { document.querySelector<HTMLButtonElement>('[data-cloudlet-pill]')!.click(); });
    await advance(600);
    expect(write).not.toHaveBeenCalled();
    const island = () => screen.getByRole('region', { name: 'Current notifications' });
    act(() => { fireEvent.keyDown(island(), { key: 'ArrowRight' }); });
    await advance(600);
    expect(polite.textContent).toBe('Middle');
    // Back to a slide that was already presented: the shared title node gives focus no change to report.
    act(() => { fireEvent.keyDown(island(), { key: 'ArrowLeft' }); });
    await advance(600);
    expect(polite.textContent).toBe('Newest');
    act(() => { fireEvent.keyDown(island(), { key: 'ArrowRight' }); });
    await advance(600);
    expect(polite.textContent).toBe('Middle');
    // Closing moves to the older slide first (never presented yet), then to the newer one already seen.
    act(() => { screen.getByRole('button', { name: 'Close notification' }).click(); });
    await advance(600);
    expect(polite.textContent).toBe('Oldest');
    act(() => { screen.getByRole('button', { name: 'Close notification' }).click(); });
    await advance(600);
    expect(polite.textContent).toBe('Newest');
    write.mockClear();
    act(() => { fireEvent.keyDown(island(), { key: 'Escape' }); });
    await advance(600);
    expect(write).not.toHaveBeenCalled();
    act(() => { document.querySelector<HTMLButtonElement>('[data-cloudlet-pill]')!.click(); });
    await advance(600);
    act(() => { controller.show({ title: 'Arrival', attention: 'stack' }); });
    await advance(600);
    expect(polite.textContent).toBe('1 notifications queued');
  });

  it('changes the region for a repeated message so a second identical failure is spoken again', async () => {
    const controller = create();
    const attempts = [createDeferred<string>(), createDeferred<string>()];
    const operation = controller.track(({ attempt }) => attempts[attempt - 1]!.promise, {
      pending: { title: 'Saving' }, success: { title: 'Saved' }, error: { title: 'Save failed', announcementPriority: 'assertive' },
    });
    void operation.result.catch(() => undefined);
    const { assertive } = mount(controller, { announcements: { operation: (item, phase) => `${phase}: ${item.content.title}` } });
    await advance();
    await act(async () => { attempts[0]!.reject(new Error('first')); });
    await advance();
    const first = assertive.textContent;
    expect(first).toBe('rejected: Save failed');
    act(() => { operation.retry(); });
    await advance();
    await act(async () => { attempts[1]!.reject(new Error('second')); });
    await advance();
    expect(assertive.textContent).not.toBe(first);
    expect(assertive.textContent?.trim()).toBe('rejected: Save failed');
  });

  it('keeps the live regions beside the host, outside its animated subtree, and removes them on unmount', () => {
    const controller = create();
    controller.show({ title: 'Placed' });
    const { polite, assertive, unmount } = mount(controller);
    const host = document.querySelector('.cloudlet-host')!;
    for (const region of [polite, assertive]) {
      expect(host.contains(region)).toBe(false);
      expect(region.parentElement).toBe(host.parentElement);
    }
    unmount();
    expect(document.querySelectorAll('[data-cloudlet-announcer]')).toHaveLength(0);
  });

  it('re-inserts its live regions once on the next frame, the change VoiceOver in Safari needs to speak assertive text', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => frames.push(callback));
    const controller = create();
    controller.show({ title: 'Placed', announcementPriority: 'assertive' });
    const { polite, assertive } = mount(controller);
    const observer = new MutationObserver(() => {});
    observer.observe(polite.parentElement!, { childList: true });
    act(() => { frames.splice(0).forEach(callback => callback(0)); });
    const records = observer.takeRecords();
    expect(records.flatMap(record => [...record.removedNodes])).toEqual(expect.arrayContaining([polite, assertive]));
    expect(records.flatMap(record => [...record.addedNodes])).toEqual(expect.arrayContaining([polite, assertive]));
    expect(polite.previousElementSibling).toBe(document.querySelector('.cloudlet-host'));
    await advance();
    expect(assertive.textContent).toBe('Placed');
  });

  it('does not announce progress frames, reflow, ordinary text edits or remount again', async () => {
    const controller = create();
    const admitted = controller.show({ title: 'Upload', progress: { kind: 'determinate', value: 0 } });
    if (admitted.status !== 'created') throw new Error('admission');
    const mounted = mount(controller);
    await advance();
    const write = vi.spyOn(mounted.polite, 'replaceChildren');
    act(() => { for (let i = 1; i <= 30; i++) controller.update(admitted.handle, { progress: { kind: 'determinate', value: i / 30 }, title: `Upload ${i}` }); });
    fireEvent.click(document.querySelector('[data-cloudlet-pill]')!);
    expect(screen.getByRole('region', { name: 'Current notifications', description: 'Press Escape to collapse' })).toBeInTheDocument();
    act(() => window.dispatchEvent(new Event('resize')));
    await advance(600);
    expect(write).not.toHaveBeenCalled();
    mounted.unmount();
    const remounted = mount(controller);
    await advance(600);
    expect(remounted.polite).toBeEmptyDOMElement();
  });

  it('coalesces start and fast terminal into one current operation message and persists both acknowledgements', async () => {
    const controller = create(); const deferred = createDeferred<string>();
    const operation = controller.track(deferred.promise, { pending: { title: 'Working' }, success: { title: 'Finished' }, error: { title: 'Failed' } });
    const mounted = mount(controller);
    await advance(100);
    await act(async () => { deferred.resolve('done'); });
    await advance(200);
    expect(mounted.polite.textContent).toBe('Finished');
    expect(getRendererBridge(controller).getSnapshot().announcements.notifications[0]?.operation?.phases).toEqual(['started', 'fulfilled']);
    await expect(operation.result).resolves.toBe('done');
    mounted.unmount();
    const next = mount(controller); await advance();
    expect(next.polite).toBeEmptyDOMElement();
  });

  it('announces cancellation request and retry phases once per attempt and keeps errors polite by default', async () => {
    const controller = create(); const first = createDeferred<void>(); const second = createDeferred<void>();
    const operation = controller.track(({ attempt }) => attempt === 1 ? first.promise : second.promise,
      { pending: { title: 'Saving' }, success: { title: 'Saved' }, error: { title: 'Save failed' } });
    const { polite, assertive } = mount(controller, { announcements: { operation: (item, phase) => `${phase}: ${item.content.title}` } });
    await advance(); expect(polite.textContent).toBe('started: Saving');
    act(() => { operation.cancel(); }); await advance();
    expect(polite.textContent).toBe('cancel-requested: Cancellation requested');
    await act(async () => { first.reject(new Error('failure')); }); await advance();
    expect(polite.textContent).toBe('rejected: Save failed'); expect(assertive).toBeEmptyDOMElement();
    act(() => { operation.retry(); }); await advance();
    expect(polite.textContent).toBe('started: Saving');
    await act(async () => { second.resolve(); }); await advance();
    expect(polite.textContent).toBe('fulfilled: Saved');
  });

  it('keeps action pending/failure separate from operation result and dedupes failure across remount', async () => {
    const controller = create(); const deferred = createDeferred<void>();
    controller.show({ title: 'Permission', kind: 'success', action: { kind: 'command', label: 'Confirm', run: () => deferred.promise, errorMessage: () => 'Try again' } });
    const props: ToasterProps = { announcements: { actionPending: () => 'Действие выполняется', actionError: (_item, error) => `Ошибка действия: ${error}` } };
    const mounted = mount(controller, props); await advance();
    fireEvent.click(document.querySelector('[data-cloudlet-pill]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); await advance();
    expect(mounted.polite.textContent).toBe('Действие выполняется');
    await act(async () => { deferred.reject(new Error('private failure')); }); await advance();
    expect(mounted.polite.textContent).toBe('Ошибка действия: Try again');
    mounted.unmount();
    const next = mount(controller, props); await advance();
    expect(next.polite).toBeEmptyDOMElement();
  });

  it('clears pending hidden speech and resumes with one current aggregate, never stale states', async () => {
    const controller = create(); const deferred = createDeferred<void>();
    controller.track(deferred.promise, { pending: { title: 'Hidden pending' }, success: { title: 'Hidden finished' }, error: { title: 'Hidden failed' } });
    const { polite, assertive } = mount(controller, { announcements: { resumed: count => `Сейчас уведомлений: ${count}` } });
    await advance(100); visibility('hidden');
    const temporary = controller.show({ title: 'Removed while hidden', announcementPriority: 'assertive' });
    const queued = controller.show({ title: 'Queued obsolete', announcementPriority: 'polite' });
    if (temporary.status !== 'created' || queued.status !== 'created') throw new Error('admission');
    await act(async () => { deferred.resolve(); controller.dismiss(temporary.handle); controller.update(queued.handle, { title: 'Queued latest' }); });
    await advance(2000);
    expect(polite).toBeEmptyDOMElement(); expect(assertive).toBeEmptyDOMElement();
    visibility('visible'); await advance();
    expect(polite.textContent).toBe('Сейчас уведомлений: 2');
    expect(assertive).toBeEmptyDOMElement();
    // The stacked operation is presented for the first time with its current phase only.
    act(() => { controller.dismiss(queued.handle); }); await advance(600);
    expect(polite.textContent).toBe('Hidden finished');
  });

  it('does not carry an empty resume into a later first notification', async () => {
    const controller = create();
    const { polite, assertive } = mount(controller);
    visibility('hidden'); visibility('visible');
    await advance(5_000);
    act(() => { controller.show({ title: 'New urgent arrival', announcementPriority: 'assertive' }); });
    await advance();
    expect(polite).toBeEmptyDOMElement();
    expect(assertive.textContent).toBe('New urgent arrival');
  });

  it('forgets a pending resume when every old notification is cleared before its flush', async () => {
    const controller = create();
    controller.show({ title: 'Old notification' });
    const { polite, assertive } = mount(controller);
    await advance();
    visibility('hidden'); visibility('visible');
    await advance(100);
    act(() => { controller.clear(); });
    await advance(1_000);
    act(() => { controller.show({ title: 'New notification' }); });
    await advance();
    expect(polite.textContent).toBe('New notification');
    expect(assertive).toBeEmptyDOMElement();
  });

  it('preserves explicit urgency in resume aggregates, including arrivals inside the fixed resume window', async () => {
    const controller = create();
    controller.show({ title: 'Routine current' });
    controller.show({ title: 'Urgent queued', announcementPriority: 'assertive' });
    controller.show({ title: 'Silent queued', announcementPriority: 'off' });
    const { polite, assertive } = mount(controller, { announcements: { resumed: count => `Current count: ${count}` } });
    await advance();
    visibility('hidden'); visibility('visible');
    await advance(100);
    act(() => { controller.show({ title: 'Urgent after return', announcementPriority: 'assertive' }); });
    await advance(199);
    expect(polite).toBeEmptyDOMElement(); expect(assertive).toBeEmptyDOMElement();
    await advance(1);
    expect(polite.textContent).toBe('Current count: 1');
    expect(assertive.textContent).toBe('Current count: 2');
  });

  it('keeps first presentation pending for an unreadable selected card after the resume aggregate', async () => {
    const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 0, height: 0, x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {},
    });
    const controller = create();
    controller.show({ title: 'Waiting for layout' });
    const { polite } = mount(controller);
    visibility('hidden'); visibility('visible');
    await advance();
    expect(polite.textContent).toBe('1 current notifications');
    expect(getRendererBridge(controller).getSnapshot().announcements.notifications[0]?.firstPresentation).toBe(false);
    geometry.mockReturnValue({
      width: 352, height: 56, x: 0, y: 0, top: 0, left: 0, right: 352, bottom: 56, toJSON() {},
    });
    act(() => window.dispatchEvent(new Event('resize')));
    await advance(600);
    expect(polite.textContent).toBe('Waiting for layout');
    expect(getRendererBridge(controller).getSnapshot().announcements.notifications[0]?.firstPresentation).toBe(true);
  });

  it('does not leak off records into either live channel, aggregates or remount', async () => {
    const controller = create();
    controller.show({ title: 'Silent current', announcementPriority: 'off' });
    controller.show({ title: 'Silent queued', announcementPriority: 'off' });
    const mounted = mount(controller); await advance();
    expect(mounted.polite).toBeEmptyDOMElement(); expect(mounted.assertive).toBeEmptyDOMElement();
    act(() => { controller.dismiss(controller.getSnapshot().stack[0]!); }); await advance();
    visibility('hidden'); visibility('visible'); await advance();
    expect(mounted.polite).toBeEmptyDOMElement();
    expect(getRendererBridge(controller).getSnapshot().announcements.notifications.every(item => item.firstPresentation)).toBe(true);
  });

  it('announces dedupe occurrences once and does not retain dismissed pending records', async () => {
    const controller = create();
    const admitted = controller.show({ title: 'Repeated', dedupeKey: 'one' });
    if (admitted.status !== 'created') throw new Error('admission');
    const { polite } = mount(controller); await advance();
    act(() => { controller.show({ title: 'Unused', dedupeKey: 'one' }); controller.show({ title: 'Unused', dedupeKey: 'one' }); });
    await advance(); expect(polite.textContent).toBe('Repeated. 3 occurrences');
    const write = vi.spyOn(polite, 'replaceChildren');
    act(() => { const short = controller.show({ title: 'Never speak' }); if (short.status === 'created') controller.dismiss(short.handle); });
    await advance(); expect(write).not.toHaveBeenCalled();
  });

  it('isolates throwing and invalid formatters, and uses safe plain fallback text', async () => {
    const diagnostics = vi.fn();
    const controller = createCloudlet({ autoDismiss: false, onDiagnostic: diagnostics }); controllers.push(controller);
    controller.show({ title: 'Safe title', description: { kind: 'rich', content: <b>Unspoken</b>, announcement: 'Safe body' } });
    const { polite } = mount(controller, { announcements: { notification: () => { throw new Error('formatter'); } } });
    await advance(); expect(polite.textContent).toBe('Safe title. Safe body');
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ code: 'formatter-error', source: 'Toaster.announcements.notification' }));
  });

  it('discards a batch invalidated by a reentrant formatter before writing or acknowledging it', async () => {
    const controller = create(); const admitted = controller.show({ title: 'Old' });
    if (admitted.status !== 'created') throw new Error('admission');
    let called = false;
    const { polite } = mount(controller, { announcements: { notification: item => {
      if (!called) { called = true; controller.update(admitted.handle, { title: 'Current' }); }
      return item.content.title;
    } } });
    await advance(); expect(polite).toBeEmptyDOMElement();
    await advance(); expect(polite.textContent).toBe('Current');
  });

  it('does not reschedule a stale batch when its formatter unmounts the attachment', async () => {
    const controller = create();
    controller.show({ title: 'Unmount while formatting' });
    let unmount: (() => void) | undefined;
    const mounted = mount(controller, { announcements: { notification: item => {
      unmount?.();
      return item.content.title;
    } } });
    unmount = mounted.unmount;
    await advance();
    expect(document.querySelector('.cloudlet-host')).toBeNull();
    expect(mounted.polite).toBeEmptyDOMElement();
    expect(controller.getSnapshot().notifications).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(getRendererBridge(controller).getSnapshot().announcements.notifications[0]?.firstPresentation).toBe(false);
  });

  it('cancels attachment batching and bounds the controller ledger to live records', async () => {
    const controller = create(); controller.show({ title: 'Detach before speech' });
    const mounted = mount(controller);
    mounted.unmount(); await advance();
    expect(mounted.polite).toBeEmptyDOMElement();
    expect(getRendererBridge(controller).getSnapshot().announcements.notifications[0]?.firstPresentation).toBe(false);
    act(() => { controller.clear(); });
    expect(getRendererBridge(controller).getSnapshot().announcements.notifications).toEqual([]);
  });
});
