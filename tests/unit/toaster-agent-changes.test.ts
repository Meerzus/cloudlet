import { describe, expect, it, vi } from 'vitest';
import { createAgent, type AgentChange, type AgentOptions } from '@cloudlet/agent';
import type { CommandAction, FormAction } from '../../packages/toast/src/contracts/notifications.js';
import type { TrackOptions } from '../../packages/toast/src/contracts/operations.js';
import { toasterAgent, type NotificationEntry } from '../../packages/toast/src/agent.js';
import { acknowledge, admit, attach, harness } from '../support/controller-harness.js';
import { createDeferred } from '../support/deferred.js';

const quiet = (id: string, extra: object = {}) => ({ id, title: id, duration: null, attention: 'stack' as const, ...extra });
const command = (label: string, extra: Partial<CommandAction> = {}): CommandAction => ({ kind: 'command', label, agent: 'allow', run: vi.fn(), ...extra });
const form = (extra: Partial<FormAction> = {}): FormAction => ({
  kind: 'form', label: 'Send', agent: 'allow', run: vi.fn(),
  fields: [{ name: 'reply', kind: 'text', label: 'Reply' }, { name: 'note', kind: 'text', label: 'Note', defaultValue: 'Draft' }],
  ...extra,
});
const tracked = (id: string): TrackOptions<string, unknown> => ({ id, pending: { title: 'Working' }, success: { title: 'Saved' }, error: { title: 'Failed' } });
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(options: AgentOptions = {}) {
  const { controller, bridge, clock } = harness();
  const lease = attach(bridge);
  const agent = createAgent(options);
  const component = toasterAgent(controller);
  const disconnect = agent.connect(component);
  /** One array per notification of the bridge, as the listener received it. */
  const batches: (readonly AgentChange[])[] = [];
  const stop = agent.subscribe((changes) => { batches.push(changes); });
  const changes = () => batches.flat();
  /** `ref key previous>value source` for compact assertions; `reason` in brackets. */
  const lines = () => changes().map((change) =>
    `${change.ref} ${change.key} ${JSON.stringify(change.previous)}>${JSON.stringify(change.value)}${change.reason ? ` [${change.reason}]` : ''} ${change.source}`);
  const forget = () => { batches.length = 0; };
  const ref = (label: string) => {
    const found = agent.snapshot().find((item) => item.label === label) as NotificationEntry | undefined;
    if (!found) throw new Error(`Missing entry ${label}`);
    return found.ref;
  };
  const act = (target: string, action: string, args?: unknown[]) => agent.act({ steps: [{ ref: target, action, ...(args ? { args } : {}) }] });
  return { controller, bridge, clock, lease, agent, component, disconnect, stop, batches, changes, lines, forget, ref, act };
}

describe('Toaster change records', () => {
  it('a notification that appears and closes is `present`, with the title, the close reason and the same ref as the snapshot', () => {
    const t = setup();
    const handle = admit(t.controller, quiet('saved', { title: 'File saved' }));
    const ref = t.ref('File saved');
    expect(t.changes()).toEqual([
      { ref, component: 'notification', label: 'File saved', key: 'present', value: true, previous: false, source: 'app' },
    ]);
    t.forget();
    t.controller.dismiss(handle);
    // The record is gone from the snapshot, so the change carries its title.
    expect(t.changes()).toEqual([
      { ref, component: 'notification', label: 'File saved', key: 'present', value: false, previous: true, reason: 'programmatic', source: 'app' },
    ]);
    expect(t.changes().every((change) => Object.isFrozen(change))).toBe(true);
  });

  it('the same close by the agent, the person, the app and the timer names four sources', async () => {
    const t = setup();
    const handles = ['agent', 'user', 'app'].map((id) => admit(t.controller, quiet(id)));
    const timed = admit(t.controller, { id: 'system', title: 'system', duration: 1_000, attention: 'stack' });
    const refs = ['agent', 'user', 'app', 'system'].map(t.ref);
    t.forget();
    expect(await t.act(refs[0]!, 'dismiss')).toMatchObject({ ok: true });
    t.bridge.dismiss(t.lease, handles[1]!, 'close-button');
    t.controller.dismiss(handles[2]!);
    acknowledge(t.bridge, t.lease, timed);
    t.clock.advanceBy(1_000);
    expect(t.lines()).toEqual([
      `${refs[0]} present true>false [programmatic] agent`,
      `${refs[1]} present true>false [close-button] user`,
      `${refs[2]} present true>false [programmatic] app`,
      `${refs[3]} present true>false [timeout] system`,
    ]);
  });

  it('a notification shown and closed between two reads of the snapshot keeps its number and both records', () => {
    const t = setup();
    admit(t.controller, quiet('before'));
    const before = t.ref('before');
    t.forget();
    const handle = admit(t.controller, quiet('brief'));
    t.controller.dismiss(handle);
    const after = admit(t.controller, quiet('after'));
    void after;
    const [appeared, closed, next] = t.changes();
    expect(appeared).toMatchObject({ key: 'present', value: true, label: 'brief' });
    expect(closed).toMatchObject({ ref: appeared!.ref, key: 'present', value: false, label: 'brief', reason: 'programmatic' });
    expect(new Set([before, appeared!.ref, next!.ref]).size).toBe(3);
    // Read only now: the brief one never was in a snapshot, and the next keeps the number it was given.
    expect(t.ref('after')).toBe(next!.ref);
  });

  it('numbers what was already there as the snapshot does, top first', () => {
    const { controller } = harness();
    admit(controller, quiet('older'));
    admit(controller, quiet('newer'));
    const agent = createAgent();
    agent.connect(toasterAgent(controller));
    const seen: AgentChange[] = [];
    agent.subscribe((changes) => { seen.push(...changes); });
    controller.clear();
    expect(seen.map((change) => `${change.label} ${change.ref}`)).toEqual(['older toaster:2', 'newer toaster:1']);
  });

  it('an update by the app is `content` and carries the new title', () => {
    const t = setup();
    const handle = admit(t.controller, quiet('draft'));
    const ref = t.ref('draft');
    t.forget();
    t.controller.update(handle, { title: 'Draft saved' });
    expect(t.changes()).toEqual([{ ref, component: 'notification', label: 'Draft saved', key: 'content', value: null, previous: null, source: 'app' }]);
  });

  it('a press by the agent is `action` pending and the closing, both by the agent, however long the command runs', async () => {
    const t = setup();
    const work = createDeferred<void>();
    admit(t.controller, quiet('save', { action: command('Save', { run: () => work.promise }) }));
    const other = admit(t.controller, quiet('other'));
    const ref = t.ref('save');
    t.forget();
    const pressed = t.act(ref, 'press');
    await flush();
    // The app acts while the command runs.
    t.controller.dismiss(other);
    work.resolve();
    expect(await pressed).toMatchObject({ ok: true });
    expect(t.lines().filter((line) => line.startsWith(ref))).toEqual([
      `${ref} action "idle">"pending" agent`,
      `${ref} present true>false [action-success] agent`,
    ]);
  });

  it('a failed action is `failed` by whoever pressed, and goes back to `idle` when the app replaces it', async () => {
    const t = setup();
    const handle = admit(t.controller, quiet('save', { action: command('Save', { run: () => Promise.reject(new Error('No')) }) }));
    const ref = t.ref('save');
    t.forget();
    t.bridge.invokeAction(t.lease, handle);
    await flush();
    t.controller.update(handle, { action: command('Try again') });
    expect(t.lines()).toEqual([
      `${ref} action "idle">"pending" user`,
      `${ref} action "pending">"failed" user`,
      `${ref} content null>null app`,
      `${ref} action "failed">"idle" app`,
    ]);
  });

  it('an operation reports each phase: who retried and who cancelled, and the outcome by the system', async () => {
    const t = setup();
    let attempts = 0;
    t.controller.track<string>(({ signal }) => new Promise((_resolve, reject) => {
      if (++attempts === 1) reject(new Error('First attempt fails'));
      else signal.addEventListener('abort', () => reject(signal.reason));
    }), tracked('job'));
    await flush();
    const ref = t.ref('Failed');
    expect(await t.act(ref, 'retry')).toMatchObject({ ok: true });
    t.bridge.cancelOperation(t.lease, t.controller.getHandle('job')!, t.controller.getSnapshot().notifications[0]!.operation!.token);
    await flush();
    expect(t.lines()).toEqual([
      `${ref} present false>true app`,
      `${ref} operation null>"pending" app`,
      `${ref} operation "pending">"rejected" system`,
      `${ref} operation "rejected">"pending" agent`,
      `${ref} operation "pending">"cancel-requested" user`,
      `${ref} operation "cancel-requested">"cancelled" system`,
    ]);
    expect(t.changes().map((change) => change.label)).toEqual(['Working', 'Working', 'Failed', 'Working', 'Cancellation requested', 'Cancelled']);
  });

  it('an attempt that restart() replaced does not speak for the notification', async () => {
    const t = setup();
    const operation = t.controller.track<string>(({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    }), tracked('job'));
    const ref = t.ref('Working');
    t.forget();
    operation.restart();
    await flush();
    expect(t.lines()).toEqual([`${ref} operation "pending">"pending" app`]);
  });

  it('a form field reports who wrote it, once per change of author and never its text', async () => {
    const t = setup();
    const handle = admit(t.controller, quiet('anna', { action: form() }));
    const ref = t.ref('anna');
    // Defaults are not a change: the notification appeared with them.
    expect(t.lines()).toEqual([`${ref} present false>true app`]);
    t.forget();
    for (const text of ['S', 'Se', 'Secret reply']) t.bridge.setFormValue(t.lease, handle, 'reply', text);
    expect(t.lines()).toEqual([`${ref} field:reply null>"user" user`]);
    // Every keystroke still notifies: the snapshot changed, with nothing to say about who.
    expect(t.batches.map((batch) => batch.length)).toEqual([1, 0, 0]);
    t.forget();
    expect(await t.act(ref, 'fill', ['note', 'Agent note'])).toMatchObject({ ok: true });
    expect(await t.act(ref, 'fill', ['note', 'Another agent note'])).toMatchObject({ ok: true });
    expect(t.lines()).toEqual([`${ref} field:note "app">"agent" agent`]);
    t.forget();
    t.bridge.setFormValue(t.lease, handle, 'note', 'Typed over');
    expect(t.lines()).toEqual([`${ref} field:note "agent">"user" user`]);
    t.forget();
    // The app replaces the form: every field starts over from its default.
    t.controller.update(handle, { action: form() });
    expect(t.lines()).toEqual([
      `${ref} content null>null app`,
      `${ref} field:reply "user">null app`,
      `${ref} field:note "user">"app" app`,
    ]);
  });

  it('no record holds a form value, typed, filled or submitted', async () => {
    const t = setup();
    const seen: unknown[] = [];
    t.agent.subscribe((changes) => { seen.push(changes); });
    const handle = admit(t.controller, quiet('anna', { action: form({
      run: () => Promise.reject(new Error('Server said SECRET-ERROR')),
      errorMessage: () => 'Could not send SECRET-PERSON',
    }) }));
    const ref = t.ref('anna');
    t.bridge.setFormValue(t.lease, handle, 'reply', 'SECRET-PERSON');
    await t.act(ref, 'fill', ['note', 'SECRET-AGENT']);
    await t.act(ref, 'submit');
    await flush();
    t.controller.dismiss(handle);
    expect(t.lines()).toContain(`${ref} action "pending">"failed" agent`);
    expect(JSON.stringify([t.batches, seen])).not.toMatch(/SECRET|Draft/);
  });

  it('the Island is a change of the Toaster record: who opened it, moved it and closed it', async () => {
    const t = setup();
    const a = admit(t.controller, quiet('a'));
    admit(t.controller, quiet('b'));
    const [refA, refB] = [t.ref('a'), t.ref('b')];
    t.forget();
    await t.act('toaster', 'open');
    t.bridge.navigate(t.lease, a);
    await t.act(refB, 'show');
    await t.act('toaster', 'close');
    t.bridge.openIsland(t.lease, 'user');
    t.bridge.collapseIsland(t.lease);
    expect(t.changes().every((change) => change.component === 'toaster' && change.label === undefined)).toBe(true);
    expect(t.lines()).toEqual([
      `toaster island null>"${refB}" agent`,
      `toaster island "${refB}">"${refA}" user`,
      `toaster island "${refA}">"${refB}" agent`,
      `toaster island "${refB}">null agent`,
      `toaster island null>"${refB}" user`,
      `toaster island "${refB}">null user`,
    ]);
    expect(t.agent.snapshot()[0]).toMatchObject({ ref: 'toaster', component: 'toaster', island: { open: false } });
  });

  it('an Island that opened for attention is the system, and one whose last notification closed names who closed it', () => {
    const t = setup();
    const loud = admit(t.controller, quiet('loud', { attention: 'open' }));
    const ref = t.ref('loud');
    t.forget();
    t.clock.advanceBy(10_000);
    t.controller.dismiss(loud);
    expect(t.lines()).toEqual([
      `toaster island null>"${ref}" system`,
      `${ref} present true>false [programmatic] app`,
      'toaster island "' + ref + '">null app',
    ]);
  });

  it('a press that needs a person opens the Island as the agent, at once or after the person stops', async () => {
    const t = setup();
    admit(t.controller, quiet('pay', { action: command('Pay', { agent: 'confirm' }) }));
    const other = admit(t.controller, quiet('other'));
    const ref = t.ref('pay');
    t.forget();
    expect(await t.act(ref, 'press')).toMatchObject({ ok: false });
    expect(t.lines()).toEqual([`toaster island null>"${ref}" agent`]);

    t.bridge.navigate(t.lease, other);
    t.bridge.setPause(t.lease, { scope: 'host', reason: 'hover', active: true });
    t.forget();
    expect(await t.act(ref, 'press')).toMatchObject({ ok: false });
    expect(t.changes()).toEqual([]);
    t.bridge.setPause(t.lease, { scope: 'host', reason: 'hover', active: false });
    t.clock.advanceBy(10_000);
    expect(t.lines()).toEqual([`toaster island "${t.ref('other')}">"${ref}" agent`]);
  });

  it('acknowledging the overflow is a change of the Toaster record with the missed count', async () => {
    const t = setup();
    for (let index = 0; index < 102; index += 1) t.controller.show(quiet(`n-${index}`));
    t.forget();
    expect(await t.act('toaster', 'acknowledge')).toMatchObject({ ok: true });
    expect(t.changes()).toEqual([{ ref: 'toaster', component: 'toaster', key: 'overflow', value: 0, previous: 2, source: 'agent' }]);
  });

  it('a change with no author notifies with an empty array', () => {
    const t = setup();
    admit(t.controller, quiet('a'));
    t.forget();
    t.bridge.setPause(t.lease, { scope: 'host', reason: 'hover', active: true });
    expect(t.batches).toEqual([[]]);
  });

  it('the records arrive with the notification, when the snapshot already shows the change', () => {
    const t = setup();
    const seen: string[] = [];
    t.agent.subscribe((changes) => {
      const refs = t.agent.snapshot().map((item) => item.ref);
      for (const change of changes) if (change.key === 'present') seen.push(`${change.value} ${refs.includes(change.ref)}`);
    });
    const handle = admit(t.controller, quiet('a'));
    t.controller.dismiss(handle);
    expect(seen).toEqual(['true true', 'false false']);
  });

  describe('when a listener of the app commits again before the adapter hears the first commit', () => {
    /** The app listens first, so its nested commit is already published when the adapter is told. */
    function early(react: (t: ReturnType<typeof harness>) => void) {
      const t = harness();
      const lease = attach(t.bridge);
      t.controller.subscribe(() => { react(t); });
      const agent = createAgent();
      agent.connect(toasterAgent(t.controller));
      const batches: (readonly AgentChange[])[] = [];
      agent.subscribe((changes) => { batches.push(changes); });
      const lines = () => batches.map((batch) => batch.map((change) =>
        `${change.label ?? '-'} ${change.key} ${JSON.stringify(change.previous)}>${JSON.stringify(change.value)} ${change.source}`));
      return { ...t, lease, lines };
    }

    it('an action the app replaces as soon as it fails goes back to idle as the app, in the app\'s commit', async () => {
      const t = early(({ controller }) => {
        const item = controller.getSnapshot().notifications[0];
        if (item?.action.status === 'failed') controller.update(item.handle, { action: command('Try again') });
      });
      const handle = admit(t.controller, quiet('save', { action: command('Save', { run: () => Promise.reject(new Error('No')) }) }));
      t.bridge.invokeAction(t.lease, handle);
      await flush();
      expect(t.lines()).toEqual([
        ['save present false>true app'],
        ['save action "idle">"pending" user'],
        ['save action "pending">"failed" user'],
        ['save content null>null app', 'save action "failed">"idle" app'],
      ]);
    });

    it('an Island the person opened on a notification the app then closes is opened by the person first', () => {
      let closing = false;
      const t = early(({ controller }) => {
        const { island } = controller.getSnapshot();
        if (island.current?.id === 'b' && !closing) { closing = true; controller.dismiss(island.current); }
      });
      admit(t.controller, quiet('a'));
      const b = admit(t.controller, quiet('b'));
      t.bridge.openIsland(t.lease, 'user', b);
      expect(t.lines().slice(2)).toEqual([
        ['- island null>"toaster:2" user'],
        ['b present true>false app', '- island "toaster:2">"toaster:1" app'],
      ]);
    });

    it('a notification the app closes the moment it appears keeps its title in both records', () => {
      const t = early(({ controller }) => {
        const handle = controller.getHandle('spam');
        if (handle) controller.dismiss(handle);
      });
      t.controller.show(quiet('spam', { title: 'Spam' }));
      expect(t.lines()).toEqual([['Spam present false>true app'], ['Spam present true>false app']]);
    });

    it('an adapter connected while a commit is still queued does not repeat what it read on connecting', () => {
      const { controller } = harness();
      const agent = createAgent();
      const seen: string[] = [];
      let connected = false;
      controller.onEvent((event) => {
        if (event.type !== 'admitted' || connected) return;
        connected = true;
        controller.show(quiet('second'));
        agent.connect(toasterAgent(controller));
        agent.subscribe((changes) => { seen.push(...changes.map((change) => `${change.label} ${change.key}`)); });
      });
      controller.show(quiet('first'));
      expect(agent.snapshot().map((item) => item.label)).toEqual([undefined, 'second', 'first']);
      controller.show(quiet('third'));
      expect(seen).toEqual(['third present']);
    });
  });

  it('a listener that throws does not keep the records from the others', () => {
    const diagnostics: string[] = [];
    const { controller } = harness({ onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic.code); } });
    const component = toasterAgent(controller);
    const after = vi.fn();
    component.subscribe(() => { throw new Error('listener failed'); });
    component.subscribe(after);
    admit(controller, quiet('a'));
    admit(controller, quiet('b'));
    expect(after.mock.calls.map(([changes]) => (changes as readonly AgentChange[]).map((change) => change.label))).toEqual([['a'], ['b']]);
    expect(diagnostics).toEqual(['listener-error', 'listener-error']);
  });

  it('dispose closes everything as the system, and nothing arrives afterwards', () => {
    const t = setup();
    admit(t.controller, quiet('a'));
    t.bridge.openIsland(t.lease, 'user');
    const ref = t.ref('a');
    t.forget();
    t.controller.dispose();
    expect(t.lines()).toEqual([`${ref} present true>false [dispose] system`, `toaster island "${ref}">null system`]);
    t.forget();
    t.controller.show({ title: 'late' });
    expect(t.batches).toEqual([]);
    expect(t.agent.snapshot()).toEqual([]);
  });

  it('stops listening to the controller with its last subscriber and counts from one in a new adapter', () => {
    const { controller, bridge } = harness();
    const component = toasterAgent(controller);
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = component.subscribe(first);
    const stopSecond = component.subscribe(second);
    admit(controller, quiet('a'));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0]![0]).toBe(first.mock.calls[0]![0]);
    stopFirst();
    stopFirst();
    admit(controller, quiet('b'));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    stopSecond();
    admit(controller, quiet('c'));
    expect(second).toHaveBeenCalledTimes(2);
    void bridge;

    const fresh = toasterAgent(controller);
    const seen: string[] = [];
    fresh.subscribe((changes) => { for (const change of changes ?? []) seen.push(change.ref); });
    admit(controller, quiet('d'));
    // Three were there already and took the first numbers, top first.
    expect(seen).toEqual(['toaster:4']);
    expect(fresh.snapshot().map((item) => item.ref)).toEqual(['toaster', 'toaster:4', 'toaster:1', 'toaster:2', 'toaster:3']);
  });
});
