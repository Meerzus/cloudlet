import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgent, type ActResult, type AgentOptions } from '@cloudlet/agent';
import type { NotificationHandle } from '../../packages/toast/src/contracts/identity.js';
import type { HostLease } from '../../packages/toast/src/contracts/internal.js';
import type { CommandAction, FormAction } from '../../packages/toast/src/contracts/notifications.js';
import { toasterAgent, type NotificationEntry, type ToasterEntry } from '../../packages/toast/src/agent.js';
import { admit, attach, harness, record, type Bridge } from '../support/controller-harness.js';

// A step only a person may take opens the Island on its notification through the attention queue,
// and an agent never interrupts a person who is using the Toaster.

const quiet = (id: string, extra: object = {}) => ({ id, title: id, duration: null, attention: 'stack' as const, ...extra });
const command = (label: string, extra: Partial<CommandAction> = {}): CommandAction => ({ kind: 'command', label, run: vi.fn(), ...extra });
const form = (): FormAction => ({ kind: 'form', label: 'Send', fields: [{ name: 'reply', kind: 'text', label: 'Reply' }], run: vi.fn() });
const CLOSED = { open: false, reason: null, current: null, source: null };

const OPEN = (title: string) => `Needs a person: "Undo" on "${title}". The Island is open on it. Ask them to press "Undo" themselves.`;
const LATER = (title: string) => `Needs a person: "Undo" on "${title}". The Island will open on it once they stop using it. Ask them to press "Undo" themselves.`;
const NO_TOASTER = (title: string) => `Needs a person: "Undo" on "${title}". No Toaster is on screen, so tell them what it does.`;
const BUSY = 'The person is using the Island. Try again later.';

function setup(options: AgentOptions = {}) {
  const { controller, bridge, clock } = harness();
  const agent = createAgent(options);
  agent.connect(toasterAgent(controller));
  const focusRequests: unknown[] = [];
  bridge.subscribe(() => { const request = bridge.getSnapshot().focusRequest; if (request) focusRequests.push(request); });
  const entry = (label: string) => {
    const found = agent.snapshot().find((item) => item.label === label) as NotificationEntry | undefined;
    if (!found) throw new Error(`Missing entry ${label}`);
    return found;
  };
  const toaster = () => agent.snapshot().find((item) => item.ref === 'toaster') as ToasterEntry;
  const act = (ref: string, action: string) => agent.act({ steps: [{ ref, action }] });
  const press = (title: string) => act(entry(title).ref, 'press');
  const island = () => controller.getSnapshot().island;
  return { controller, bridge, clock, agent, entry, toaster, act, press, island, focusRequests };
}

const error = (result: ActResult) => {
  if (result.ok) throw new Error(`Expected an error, received ${JSON.stringify(result)}`);
  return result.error.message;
};
const done = (result: ActResult) => { expect(result).toMatchObject({ ok: true }); };

afterEach(() => { vi.useRealTimers(); });

type Busy = { readonly name: string; readonly start: (bridge: Bridge, lease: HostLease, top: NotificationHandle) => () => void };
// Each way a person holds the Toaster, with the step that lets go of it. The draft opens the Island
// on a form of its own; the other three leave it closed.
const ways: readonly Busy[] = [
  ...(['hover', 'focus'] as const).map((reason): Busy => ({
    name: reason,
    start(bridge, lease) {
      bridge.setPause(lease, { scope: 'host', reason, active: true });
      return () => { bridge.setPause(lease, { scope: 'host', reason, active: false }); };
    },
  })),
  {
    name: 'gesture',
    start(bridge, lease, top) {
      bridge.setPause(lease, { scope: 'notification', handle: top, reason: 'gesture', active: true });
      return () => { bridge.setPause(lease, { scope: 'notification', handle: top, reason: 'gesture', active: false }); };
    },
  },
];

describe('needs a person: the Island opens on the notification', () => {
  it('opens a closed Island on it at once, for attention, without the attention delay or focus', async () => {
    const t = setup();
    attach(t.bridge);
    const file = admit(t.controller, quiet('file', { title: 'File deleted', action: command('Undo') }));
    admit(t.controller, quiet('newer'));
    expect(error(await t.press('File deleted'))).toBe(OPEN('File deleted'));
    expect(t.island()).toEqual({ open: true, reason: 'attention', current: file, source: 'agent' });
    expect(t.toaster().island).toEqual({ open: true, current: t.entry('File deleted').ref });
    expect(t.clock.now()).toBe(0);
    expect(t.focusRequests).toEqual([]);
  });

  it('moves an Island open on another notification to it and keeps the reason', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    const file = admit(t.controller, quiet('file', { title: 'File deleted', action: command('Undo') }));
    const other = admit(t.controller, quiet('other'));
    t.bridge.openIsland(lease, 'user', other);
    expect(error(await t.press('File deleted'))).toBe(OPEN('File deleted'));
    expect(t.island()).toEqual({ open: true, reason: 'user', current: file, source: 'agent' });
    expect(t.focusRequests).toEqual([]);
  });

  it('changes nothing when the Island is already on it', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    const file = admit(t.controller, quiet('file', { title: 'File deleted', action: command('Undo') }));
    t.bridge.openIsland(lease, 'user', file);
    const revision = t.controller.getSnapshot().revision;
    expect(error(await t.press('File deleted'))).toBe(OPEN('File deleted'));
    expect(t.controller.getSnapshot().revision).toBe(revision);
    expect(t.island()).toEqual({ open: true, reason: 'user', current: file, source: 'user' });
  });

  it('opens nothing without a Toaster on screen and tells the agent to explain', async () => {
    const t = setup();
    admit(t.controller, quiet('file', { title: 'File deleted', action: command('Undo') }));
    expect(error(await t.press('File deleted'))).toBe(NO_TOASTER('File deleted'));
    expect(t.island()).toEqual(CLOSED);
    t.clock.advanceBy(10_000);
    attach(t.bridge);
    t.clock.advanceBy(10_000);
    expect(t.island()).toEqual(CLOSED);
  });

  it('opens on a notification that asks for no auto-open, when allow says false', async () => {
    const t = setup({ allow: () => false });
    attach(t.bridge);
    const file = admit(t.controller, quiet('file', { title: 'File deleted', attention: 'stack', action: command('Undo') }));
    expect(error(await t.press('File deleted'))).toBe(OPEN('File deleted'));
    expect(t.island().current).toBe(file);
  });

  it('opens it when allow does not answer in time, as when it says no', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup({ allow: () => new Promise<boolean>(() => {}), timeout: 1_000 });
    attach(t.bridge);
    const file = admit(t.controller, quiet('file', { title: 'File deleted', action: command('Undo') }));
    const pending = t.press('File deleted');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(error(await pending)).toBe(OPEN('File deleted'));
    expect(t.island()).toEqual({ open: true, reason: 'attention', current: file, source: 'agent' });
  });

  it('keeps the time of a notification with an action, as any Island opened for attention does', async () => {
    const t = setup();
    attach(t.bridge);
    const file = admit(t.controller, quiet('file', { title: 'File deleted', duration: 5_000, action: command('Undo') }));
    error(await t.press('File deleted'));
    expect(record(t.controller, file).pauseReasons).toContain('island');
    t.clock.advanceBy(20_000);
    expect(record(t.controller, file).remainingMs).toBe(5_000);
  });
});

describe('needs a person: a busy person is not interrupted', () => {
  for (const way of ways) {
    it(`waits for ${way.name} to end, then opens after the attention delay`, async () => {
      const t = setup();
      const lease = attach(t.bridge);
      const file = admit(t.controller, quiet('file', { title: 'File deleted', action: command('Undo') }));
      const top = admit(t.controller, quiet('top'));
      const release = way.start(t.bridge, lease, top);
      expect(error(await t.press('File deleted'))).toBe(LATER('File deleted'));
      t.clock.advanceBy(10_000);
      expect(t.island()).toEqual(CLOSED);
      release();
      t.clock.advanceBy(599);
      expect(t.island()).toEqual(CLOSED);
      t.clock.advanceBy(1);
      expect(t.island()).toEqual({ open: true, reason: 'attention', current: file, source: 'agent' });
      expect(t.focusRequests).toEqual([]);
      expect(t.clock.pendingCount).toBe(0);
    });
  }

  it('waits while the open Island holds a draft, then moves to it', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    const file = admit(t.controller, quiet('file', { title: 'File deleted', action: command('Undo') }));
    const reply = admit(t.controller, quiet('reply', { action: form() }));
    t.bridge.openIsland(lease, 'user', reply);
    t.bridge.setFormValue(lease, reply, 'reply', 'Almost done');
    expect(error(await t.press('File deleted'))).toBe(LATER('File deleted'));
    t.clock.advanceBy(10_000);
    expect(t.island()).toEqual({ open: true, reason: 'user', current: reply, source: 'user' });
    t.bridge.setFormValue(lease, reply, 'reply', '');
    t.clock.advanceBy(600);
    expect(t.island()).toEqual({ open: true, reason: 'user', current: file, source: 'agent' });
    expect(t.focusRequests).toEqual([]);
  });

  it('waits again when the person comes back during the delay', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    const file = admit(t.controller, quiet('file', { title: 'File deleted', action: command('Undo') }));
    const hover = (active: boolean) => t.bridge.setPause(lease, { scope: 'host', reason: 'hover', active });
    hover(true);
    error(await t.press('File deleted'));
    hover(false);
    t.clock.advanceBy(300);
    hover(true);
    t.clock.advanceBy(10_000);
    expect(t.island()).toEqual(CLOSED);
    hover(false);
    t.clock.advanceBy(600);
    expect(t.island().current).toBe(file);
  });

  it('opens a notification that asks for no auto-open after the wait too', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    const file = admit(t.controller, quiet('file', { title: 'File deleted', attention: 'stack', action: command('Undo') }));
    t.bridge.setPause(lease, { scope: 'host', reason: 'focus', active: true });
    error(await t.press('File deleted'));
    t.bridge.setPause(lease, { scope: 'host', reason: 'focus', active: false });
    t.clock.advanceBy(600);
    expect(t.island().current).toBe(file);
  });

  it('drops the request when the notification closes before its turn', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    const file = admit(t.controller, quiet('file', { title: 'File deleted', action: command('Undo') }));
    t.bridge.setPause(lease, { scope: 'host', reason: 'hover', active: true });
    error(await t.press('File deleted'));
    t.controller.dismiss(file);
    t.bridge.setPause(lease, { scope: 'host', reason: 'hover', active: false });
    t.clock.advanceBy(10_000);
    expect(t.island()).toEqual(CLOSED);
    expect(t.clock.pendingCount).toBe(0);
  });

  it('drops the request when the Toaster leaves the screen', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    admit(t.controller, quiet('file', { title: 'File deleted', action: command('Undo') }));
    t.bridge.setPause(lease, { scope: 'host', reason: 'hover', active: true });
    error(await t.press('File deleted'));
    t.bridge.detach(lease);
    attach(t.bridge);
    t.clock.advanceBy(10_000);
    expect(t.island()).toEqual(CLOSED);
  });

  it('keeps only the newest request', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    admit(t.controller, quiet('first', { title: 'First', action: command('Undo') }));
    const second = admit(t.controller, quiet('second', { title: 'Second', action: command('Undo') }));
    t.bridge.setPause(lease, { scope: 'host', reason: 'hover', active: true });
    expect(error(await t.press('First'))).toBe(LATER('First'));
    expect(error(await t.press('Second'))).toBe(LATER('Second'));
    t.bridge.setPause(lease, { scope: 'host', reason: 'hover', active: false });
    t.clock.advanceBy(600);
    expect(t.island()).toEqual({ open: true, reason: 'attention', current: second, source: 'agent' });
    t.clock.advanceBy(10_000);
    expect(t.island().current).toBe(second);
  });
});

describe('needs a person and the app\'s own auto-open', () => {
  it('a pending auto-open of another notification restarts its delay and still opens', async () => {
    const t = setup();
    attach(t.bridge);
    const file = admit(t.controller, quiet('file', { title: 'File deleted', action: command('Undo') }));
    t.clock.advanceBy(100);
    const alert = admit(t.controller, { id: 'alert', title: 'Alert', duration: null, action: command('Open') });
    t.clock.advanceBy(100);
    error(await t.press('File deleted'));
    expect(t.island().current).toBe(file);
    t.clock.advanceBy(599);
    expect(t.island().current).toBe(file);
    t.clock.advanceBy(1);
    expect(t.island().current).toBe(alert);
  });

  it('a pending auto-open of the same notification is fulfilled by it', async () => {
    const t = setup();
    attach(t.bridge);
    const file = admit(t.controller, { id: 'file', title: 'File deleted', duration: null, action: command('Undo') });
    error(await t.press('File deleted'));
    expect(t.island().current).toBe(file);
    expect(t.clock.pendingCount).toBe(0);
  });

  it('an auto-open that arrives while the request waits opens after it, and neither is lost', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    const file = admit(t.controller, quiet('file', { title: 'File deleted', action: command('Undo') }));
    t.bridge.setPause(lease, { scope: 'host', reason: 'hover', active: true });
    error(await t.press('File deleted'));
    const alert = admit(t.controller, { id: 'alert', title: 'Alert', duration: null, action: command('Open') });
    t.clock.advanceBy(10_000);
    expect(t.island()).toEqual(CLOSED);
    t.bridge.setPause(lease, { scope: 'host', reason: 'hover', active: false });
    t.clock.advanceBy(600);
    expect(t.island()).toEqual({ open: true, reason: 'attention', current: file, source: 'agent' });
    t.clock.advanceBy(600);
    expect(t.island()).toEqual({ open: true, reason: 'attention', current: alert, source: 'system' });
    expect(t.clock.pendingCount).toBe(0);
  });

  it('a waiting request goes first, even when an auto-open falls due during its delay', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    const file = admit(t.controller, quiet('file', { title: 'File deleted', action: command('Undo') }));
    t.bridge.setPause(lease, { scope: 'host', reason: 'hover', active: true });
    error(await t.press('File deleted'));
    const alert = admit(t.controller, { id: 'alert', title: 'Alert', duration: null, action: command('Open') });
    t.clock.advanceBy(400);
    t.bridge.setPause(lease, { scope: 'host', reason: 'hover', active: false });
    t.clock.advanceBy(200);
    expect(t.island()).toEqual(CLOSED);
    t.clock.advanceBy(400);
    expect(t.island().current).toBe(file);
    t.clock.advanceBy(599);
    expect(t.island().current).toBe(file);
    t.clock.advanceBy(1);
    expect(t.island().current).toBe(alert);
  });

  it('auto-open works as before once the request was served', async () => {
    const t = setup();
    attach(t.bridge);
    const file = admit(t.controller, quiet('file', { title: 'File deleted', action: command('Undo') }));
    error(await t.press('File deleted'));
    expect(t.island().current).toBe(file);
    const alert = admit(t.controller, { id: 'alert', title: 'Alert', duration: null, action: command('Open') });
    t.clock.advanceBy(599);
    expect(t.island().current).toBe(file);
    t.clock.advanceBy(1);
    expect(t.island()).toEqual({ open: true, reason: 'attention', current: alert, source: 'system' });
  });

  it('a request still waits and opens after an auto-open already shown', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    const file = admit(t.controller, quiet('file', { title: 'File deleted', action: command('Undo') }));
    const alert = admit(t.controller, { id: 'alert', title: 'Alert', duration: null, action: command('Open') });
    t.clock.advanceBy(600);
    expect(t.island().current).toBe(alert);
    t.bridge.setPause(lease, { scope: 'host', reason: 'focus', active: true });
    expect(error(await t.press('File deleted'))).toBe(LATER('File deleted'));
    t.bridge.setPause(lease, { scope: 'host', reason: 'focus', active: false });
    t.clock.advanceBy(600);
    expect(t.island()).toEqual({ open: true, reason: 'attention', current: file, source: 'agent' });
  });
});

describe('open, show and close while the person is busy', () => {
  for (const way of ways) {
    it(`open and show refuse during ${way.name} and change nothing`, async () => {
      const t = setup();
      const lease = attach(t.bridge);
      admit(t.controller, quiet('a'));
      const top = admit(t.controller, quiet('b'));
      const release = way.start(t.bridge, lease, top);
      const revision = t.controller.getSnapshot().revision;
      expect(error(await t.act('toaster', 'open'))).toBe(BUSY);
      expect(error(await t.act(t.entry('a').ref, 'show'))).toBe(BUSY);
      expect(t.controller.getSnapshot().revision).toBe(revision);
      expect(t.island()).toEqual(CLOSED);
      release();
      done(await t.act(t.entry('a').ref, 'show'));
      expect(t.island().current).not.toBeNull();
      expect(t.focusRequests).toEqual([]);
    });
  }

  it('close works during hover, focus and a gesture', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    const a = admit(t.controller, quiet('a'));
    t.bridge.openIsland(lease, 'user', a);
    t.bridge.setPause(lease, { scope: 'host', reason: 'hover', active: true });
    t.bridge.setPause(lease, { scope: 'host', reason: 'focus', active: true });
    t.bridge.setPause(lease, { scope: 'notification', handle: a, reason: 'gesture', active: true });
    done(await t.act('toaster', 'close'));
    expect(t.island()).toEqual(CLOSED);
  });

  it('a draft in the open Island refuses open, show and close', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    admit(t.controller, quiet('other'));
    const reply = admit(t.controller, quiet('reply', { action: form() }));
    t.bridge.openIsland(lease, 'user', reply);
    t.bridge.setFormValue(lease, reply, 'reply', 'Almost done');
    expect(error(await t.act('toaster', 'close'))).toBe(BUSY);
    expect(error(await t.act(t.entry('other').ref, 'show'))).toBe(BUSY);
    expect(t.island()).toEqual({ open: true, reason: 'user', current: reply, source: 'user' });
    t.bridge.setFormValue(lease, reply, 'reply', '');
    done(await t.act('toaster', 'close'));
    expect(t.island()).toEqual(CLOSED);
  });

  it('a draft in a notification the Island does not show stops nothing', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    const reply = admit(t.controller, quiet('reply', { action: form() }));
    const other = admit(t.controller, quiet('other'));
    t.bridge.openIsland(lease, 'user', reply);
    t.bridge.setFormValue(lease, reply, 'reply', 'Kept');
    t.bridge.navigate(lease, other);
    done(await t.act('toaster', 'close'));
    done(await t.act('toaster', 'open'));
    expect(t.island()).toEqual({ open: true, reason: 'attention', current: other, source: 'agent' });
  });

  it('a step that started before the person got busy is refused when it runs', async () => {
    let approve!: (value: boolean) => void;
    const t = setup({ allow: () => new Promise<boolean>((resolve) => { approve = resolve; }) });
    const lease = attach(t.bridge);
    admit(t.controller, quiet('a'));
    const pending = t.act('toaster', 'open');
    await Promise.resolve();
    t.bridge.setPause(lease, { scope: 'host', reason: 'hover', active: true });
    approve(true);
    expect(error(await pending)).toBe(BUSY);
    expect(t.island()).toEqual(CLOSED);
  });
});
