import { describe, expect, it, vi } from 'vitest';
import type { ChangeSource, SemanticEvent } from '../../packages/toast/src/contracts/events.js';
import type { NotificationHandle } from '../../packages/toast/src/contracts/identity.js';
import type { CloseNotice } from '../../packages/toast/src/contracts/notifications.js';
import type { TrackOptions } from '../../packages/toast/src/contracts/operations.js';
import { createToasterPort } from '../../packages/toast/src/core/agent-port.js';
import { acknowledge, admit, attach, harness } from '../support/controller-harness.js';
import { createDeferred } from '../support/deferred.js';

const quiet = (id: string, extra: object = {}) => ({ id, title: id, duration: null, attention: 'stack' as const, ...extra });
const tracked = (id: string): TrackOptions<string, unknown> => ({
  id, pending: { title: 'Working' }, success: { title: 'Saved' }, error: { title: 'Failed' },
});
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup() {
  const t = harness();
  const port = createToasterPort<unknown>(t.controller);
  const events: SemanticEvent[] = [];
  t.controller.onEvent((event) => { events.push(event); });
  /** `type source` of every event, or of the events of one type. */
  const sources = (type?: SemanticEvent['type']) => events.filter((event) => !type || event.type === type).map((event) => event.source);
  const closed = (handle: NotificationHandle) => events.find((event) => event.type === 'closed' && event.handle === handle)?.source;
  const island = () => t.controller.getSnapshot().island.source;
  return { ...t, port, events, sources, closed, island };
}

describe('who caused an event', () => {
  it('admission, deduplication, update and overflow belong to the app', () => {
    const t = setup();
    const handle = admit(t.controller, { id: 'a', title: 'A', dedupeKey: 'key' });
    t.controller.show({ title: 'A again', dedupeKey: 'key' });
    t.controller.update(handle, { title: 'Changed' });
    for (let index = 0; index < 99; index += 1) admit(t.controller, quiet(`filler-${index}`));
    t.controller.show({ title: 'One too many' });
    expect(t.events.filter((event) => ['deduplicated', 'updated', 'overflow'].includes(event.type)).map((event) => [event.type, event.source]))
      .toEqual([['deduplicated', 'app'], ['updated', 'app'], ['overflow', 'app']]);
    expect(new Set(t.sources('admitted'))).toEqual(new Set(['app']));
  });

  it('presentation, diagnostics and disposal belong to the system', () => {
    const t = setup();
    const lease = attach(t.bridge);
    const handle = admit(t.controller, quiet('a'));
    acknowledge(t.bridge, lease, handle);
    t.controller.show({ title: '' });
    t.controller.dispose();
    expect(t.sources('presented')).toEqual(['system']);
    expect(t.sources('diagnostic')).toEqual(['system']);
    expect(t.sources('disposed')).toEqual(['system']);
  });

  it('one notification closed by the renderer, the controller, the agent port and the timer names four sources', () => {
    const close: Record<ChangeSource, (t: ReturnType<typeof setup>, lease: ReturnType<typeof attach>, handle: NotificationHandle) => void> = {
      user: (t, lease, handle) => { t.bridge.dismiss(lease, handle, 'close-button'); },
      app: (t, _lease, handle) => { t.controller.dismiss(handle); },
      agent: (t, _lease, handle) => { t.port.dismiss(handle); },
      system: (t) => { t.clock.advanceBy(1_000); },
    };
    for (const source of ['user', 'app', 'agent', 'system'] as const) {
      const t = setup();
      const lease = attach(t.bridge);
      const notices: CloseNotice[] = [];
      const handle = admit(t.controller, { id: 'a', title: 'A', duration: 1_000, attention: 'stack', onClose: (notice) => notices.push(notice) });
      acknowledge(t.bridge, lease, handle);
      close[source](t, lease, handle);
      expect(t.closed(handle)).toBe(source);
      // `onClose` hears the same source as the event.
      expect(notices).toEqual([{ handle, reason: source === 'system' ? 'timeout' : source === 'user' ? 'close-button' : 'programmatic', source }]);
    }
  });

  it('a swipe, a followed link and the Clear all button are the person', () => {
    const t = setup();
    const lease = attach(t.bridge);
    const swiped = admit(t.controller, quiet('swiped'));
    const link = admit(t.controller, quiet('link', { action: { kind: 'link', label: 'Open', href: '/report' } }));
    t.bridge.dismiss(lease, swiped, 'swipe');
    t.bridge.dismiss(lease, link, 'navigation');
    const rest = [admit(t.controller, quiet('b')), admit(t.controller, quiet('c'))];
    t.bridge.openIsland(lease, 'user');
    t.bridge.clearAll(lease);
    expect([swiped, link, ...rest].map(t.closed)).toEqual(['user', 'user', 'user', 'user']);
  });

  it('clear() is the app, the agent step clear is the agent, dispose() is the system', () => {
    const app = setup();
    const a = admit(app.controller, quiet('a'));
    app.controller.clear();
    expect(app.closed(a)).toBe('app');

    const agent = setup();
    const b = admit(agent.controller, quiet('b'));
    agent.port.clear();
    expect(agent.closed(b)).toBe('agent');

    const system = setup();
    const notices: CloseNotice[] = [];
    const handles = ['c', 'd'].map((id) => admit(system.controller, quiet(id, { onClose: (notice: CloseNotice) => notices.push(notice) })));
    system.controller.dispose();
    expect(handles.map(system.closed)).toEqual(['system', 'system']);
    expect(notices.map((notice) => notice.source)).toEqual(['system', 'system']);
  });

  it('a listener that calls the controller from an agent\'s event does not inherit the agent', () => {
    const t = setup();
    const first = admit(t.controller, quiet('first'));
    const second = admit(t.controller, quiet('second'));
    const third = admit(t.controller, quiet('third', { onClose: () => { t.controller.dismiss(second); } }));
    t.controller.onEvent((event) => {
      if (event.type === 'closed' && event.handle === first) t.controller.dismiss(third);
    });
    t.port.dismiss(first);
    expect([first, third, second].map(t.closed)).toEqual(['agent', 'app', 'app']);
  });

  it('an action attempt keeps the source of whoever pressed, however long it runs', async () => {
    for (const who of ['user', 'agent'] as const) {
      const t = setup();
      const lease = attach(t.bridge);
      const work = createDeferred<void>();
      const bystander = admit(t.controller, quiet('bystander'));
      const handle = admit(t.controller, quiet('save', { action: { kind: 'command', label: 'Save', agent: 'allow', run: () => work.promise } }));
      const press = () => who === 'user' ? t.bridge.invokeAction(lease, handle) : t.port.press(handle, 'allow', new AbortController().signal);
      const pressed = press();
      // Others act while the callback runs: none of them becomes the attempt's source.
      t.controller.dismiss(bystander);
      t.bridge.openIsland(lease, 'user');
      (who === 'user' ? t.port : t.controller).dismiss(admit(t.controller, quiet('other')));
      work.resolve();
      await flush();
      await pressed;
      expect(t.sources('action-started')).toEqual([who]);
      expect(t.events.find((event) => event.type === 'closed' && event.reason === 'action-success')).toMatchObject({ handle, source: who });
    }
  });

  it('a failed attempt carries the source of whoever pressed, and the next attempt its own', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    const run = vi.fn().mockRejectedValueOnce(new Error('No')).mockRejectedValueOnce(new Error('No'));
    const handle = admit(t.controller, quiet('save', { action: { kind: 'command', label: 'Save', agent: 'allow', run } }));
    await t.port.press(handle, 'allow', new AbortController().signal);
    t.bridge.invokeAction(lease, handle);
    await flush();
    expect(t.sources('action-started')).toEqual(['agent', 'user']);
    expect(t.sources('action-failed')).toEqual(['agent', 'user']);
  });

  it('a person who presses after the agent was refused is the source', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    const handle = admit(t.controller, quiet('pay', { action: { kind: 'command', label: 'Pay', agent: 'deny', run: () => undefined } }));
    expect(t.port.press(handle, 'confirm', new AbortController().signal)).toEqual({ status: 'rejected', reason: 'stale' });
    t.port.summon(handle);
    t.bridge.invokeAction(lease, handle);
    await flush();
    expect(t.sources('action-started')).toEqual(['user']);
    expect(t.closed(handle)).toBe('user');
  });

  it('the first attempt of an operation is the app, admitted or not', () => {
    const t = setup();
    t.controller.track(new Promise<string>(() => {}), tracked('job'));
    t.controller.track(new Promise<string>(() => {}), { ...tracked('bad'), pending: { title: '' } });
    expect(t.events.filter((event) => event.type === 'operation-started').map((event) => [event.handle?.id ?? null, event.source]))
      .toEqual([['job', 'app'], [null, 'app']]);
  });

  it('a retry and a cancellation name who asked; the outcome is the system', async () => {
    const retry: Record<'user' | 'agent' | 'app', (t: ReturnType<typeof setup>, lease: ReturnType<typeof attach>, handle: NotificationHandle, operation: { retry: () => unknown }) => void> = {
      user: (t, lease, handle) => { t.bridge.retryOperation(lease, handle, t.controller.getSnapshot().notifications[0]!.operation!.token); },
      agent: (t, _lease, handle) => { t.port.retry(handle); },
      app: (_t, _lease, _handle, operation) => { operation.retry(); },
    };
    const cancel: typeof retry = {
      user: (t, lease, handle) => { t.bridge.cancelOperation(lease, handle, t.controller.getSnapshot().notifications[0]!.operation!.token); },
      agent: (t, _lease, handle) => { t.port.cancel(handle); },
      app: (_t, _lease, _handle, operation) => { (operation as unknown as { cancel: () => unknown }).cancel(); },
    };
    for (const who of ['user', 'agent', 'app'] as const) {
      const t = setup();
      const lease = attach(t.bridge);
      let attempts = 0;
      const operation = t.controller.track<string>(({ signal }) => new Promise((resolve, reject) => {
        if (++attempts === 1) reject(new Error('First attempt fails'));
        else signal.addEventListener('abort', () => reject(signal.reason));
        void resolve;
      }), tracked('job'));
      const handle = t.controller.getHandle('job')!;
      await flush();
      retry[who](t, lease, handle, operation);
      cancel[who](t, lease, handle, operation);
      await flush();
      expect(t.sources('operation-started')).toEqual(['app', who]);
      expect(t.sources('cancellation-requested')).toEqual([who]);
      expect(t.events.filter((event) => event.type === 'operation-settled').map((event) => [event.status, event.source]))
        .toEqual([['rejected', 'system'], ['cancelled', 'system']]);
    }
  });

  it('restart() by the app cancels the previous attempt as the app', async () => {
    const t = setup();
    const operation = t.controller.track<string>(() => new Promise(() => {}), tracked('job'));
    operation.restart();
    await flush();
    expect(t.sources('operation-started')).toEqual(['app', 'app']);
    expect(t.sources('cancellation-requested')).toEqual(['app']);
  });

  it('acknowledging the overflow names who acknowledged', () => {
    const acknowledgeBy: Record<'user' | 'agent' | 'app', (t: ReturnType<typeof setup>, lease: ReturnType<typeof attach>) => void> = {
      user: (t, lease) => { t.bridge.acknowledgeOverflow(lease); },
      agent: (t) => { t.port.acknowledge(); },
      app: (t) => { t.controller.acknowledgeOverflow(); },
    };
    for (const who of ['user', 'agent', 'app'] as const) {
      const t = setup();
      const lease = attach(t.bridge);
      for (let index = 0; index < 101; index += 1) t.controller.show(quiet(`n-${index}`));
      acknowledgeBy[who](t, lease);
      expect(t.sources('overflow-acknowledged')).toEqual([who]);
    }
    // The Island's Clear all button acknowledges too: the person.
    const t = setup();
    const lease = attach(t.bridge);
    for (let index = 0; index < 101; index += 1) t.controller.show(quiet(`n-${index}`));
    t.bridge.openIsland(lease, 'user');
    t.bridge.clearAll(lease);
    expect(t.sources('overflow-acknowledged')).toEqual(['user']);
  });

  it('every event has a source', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    const handle = admit(t.controller, quiet('a', { action: { kind: 'command', label: 'Do', run: () => Promise.reject(new Error('No')) } }));
    acknowledge(t.bridge, lease, handle);
    t.bridge.invokeAction(lease, handle);
    await flush();
    t.controller.track(Promise.resolve('value'), tracked('job'));
    await flush();
    t.controller.dispose();
    expect(t.events.length).toBeGreaterThan(8);
    for (const event of t.events) expect(['user', 'agent', 'app', 'system']).toContain(event.source);
  });
});

describe('who opened the Island', () => {
  it('is null exactly while the Island is closed', () => {
    const t = setup();
    const lease = attach(t.bridge);
    admit(t.controller, quiet('a'));
    expect(t.controller.getSnapshot().island).toEqual({ open: false, reason: null, current: null, source: null });
    t.bridge.openIsland(lease, 'user');
    expect(t.island()).toBe('user');
    t.bridge.collapseIsland(lease);
    expect(t.controller.getSnapshot().island).toEqual({ open: false, reason: null, current: null, source: null });
    t.port.open();
    t.port.close();
    expect(t.island()).toBeNull();
    t.controller.dispose();
    expect(t.island()).toBeNull();
  });

  it('a hand is the user, auto-open for attention the system, the agent steps open and show the agent', () => {
    const t = setup();
    const lease = attach(t.bridge);
    const a = admit(t.controller, quiet('a'));
    const b = admit(t.controller, quiet('b'));
    t.port.open();
    expect(t.controller.getSnapshot().island).toMatchObject({ reason: 'attention', current: b, source: 'agent' });
    t.bridge.navigate(lease, a);
    expect(t.controller.getSnapshot().island).toMatchObject({ reason: 'attention', current: a, source: 'user' });
    t.port.show(b);
    expect(t.controller.getSnapshot().island).toMatchObject({ current: b, source: 'agent' });
    t.bridge.openIsland(lease, 'user', a);
    expect(t.controller.getSnapshot().island).toMatchObject({ current: a, source: 'user' });
    // Attention moves an open Island as well: the last to change the slide is the system.
    const loud = admit(t.controller, quiet('loud', { attention: 'open' }));
    t.clock.advanceBy(10_000);
    expect(t.controller.getSnapshot().island).toMatchObject({ current: loud, source: 'system' });
  });

  it('auto-open of a closed Island is the system', () => {
    const t = setup();
    attach(t.bridge);
    const loud = admit(t.controller, quiet('loud', { attention: 'open' }));
    t.clock.advanceBy(10_000);
    expect(t.controller.getSnapshot().island).toEqual({ open: true, reason: 'attention', current: loud, source: 'system' });
  });

  it('an agent\'s request for a person is the agent, at once or after the person stops interacting', () => {
    const t = setup();
    const lease = attach(t.bridge);
    const a = admit(t.controller, quiet('a'));
    const b = admit(t.controller, quiet('b'));
    expect(t.port.summon(a)).toEqual({ status: 'shown' });
    expect(t.controller.getSnapshot().island).toMatchObject({ reason: 'attention', current: a, source: 'agent' });

    t.bridge.navigate(lease, b);
    t.bridge.setPause(lease, { scope: 'host', reason: 'hover', active: true });
    expect(t.port.summon(a)).toEqual({ status: 'waiting' });
    expect(t.controller.getSnapshot().island).toMatchObject({ current: b, source: 'user' });
    t.bridge.setPause(lease, { scope: 'host', reason: 'hover', active: false });
    t.clock.advanceBy(10_000);
    expect(t.controller.getSnapshot().island).toMatchObject({ current: a, source: 'agent' });
  });

  it('an Island that moved on because its notification closed names who closed it', () => {
    const closers: [ChangeSource, (t: ReturnType<typeof setup>, lease: ReturnType<typeof attach>, handle: NotificationHandle) => void][] = [
      ['user', (t, lease, handle) => { t.bridge.dismiss(lease, handle, 'close-button'); }],
      ['app', (t, _lease, handle) => { t.controller.dismiss(handle); }],
      ['agent', (t, _lease, handle) => { t.port.dismiss(handle); }],
      ['system', (t) => { t.clock.advanceBy(1_000); }],
    ];
    for (const [source, close] of closers) {
      const t = setup();
      const lease = attach(t.bridge);
      const older = admit(t.controller, quiet('older'));
      // Opened for attention, so the slide keeps spending its time.
      const top = admit(t.controller, { id: 'top', title: 'Top', duration: 1_000, attention: 'stack' });
      t.port.open();
      acknowledge(t.bridge, lease, top);
      close(t, lease, top);
      expect(t.controller.getSnapshot().island).toMatchObject({ open: true, current: older, source });
      t.controller.dismiss(older);
      expect(t.island()).toBeNull();
    }
  });
});
