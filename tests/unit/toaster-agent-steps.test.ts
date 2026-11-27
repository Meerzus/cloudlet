import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgent, type ActResult, type AgentOptions, type Allow } from '@cloudlet/agent';
import type { SemanticEvent } from '../../packages/toast/src/contracts/events.js';
import type { CommandAction } from '../../packages/toast/src/contracts/notifications.js';
import { toasterAgent, type NotificationEntry, type ToasterEntry } from '../../packages/toast/src/agent.js';
import { admit, attach, harness, type Core } from '../support/controller-harness.js';
import { createDeferred } from '../support/deferred.js';

const quiet = (id: string, extra: object = {}) => ({ id, title: id, duration: null, attention: 'stack' as const, ...extra });
const command = (label: string, extra: Partial<CommandAction> = {}): CommandAction => ({ kind: 'command', label, run: vi.fn(), ...extra });

function setup(options: AgentOptions = {}) {
  const { controller, bridge, clock } = harness();
  const agent = createAgent(options);
  const component = toasterAgent(controller);
  agent.connect(component);
  const events: SemanticEvent[] = [];
  controller.onEvent((event) => { events.push(event); });
  const entries = () => agent.snapshot();
  const toaster = () => entries().find((entry) => entry.ref === 'toaster') as ToasterEntry;
  const entry = (label: string) => {
    const found = entries().find((item) => item.label === label) as NotificationEntry | undefined;
    if (!found) throw new Error(`Missing entry ${label}`);
    return found;
  };
  const act = (ref: string, action: string, args?: unknown[]) => agent.act({ steps: [{ ref, action, ...(args ? { args } : {}) }] });
  return { controller, bridge, clock, agent, component, events, toaster, entry, act };
}

const done = (result: ActResult) => {
  expect(result).toMatchObject({ ok: true });
  return result.steps[0]!;
};
const error = (result: ActResult) => {
  if (result.ok) throw new Error(`Expected an error, received ${JSON.stringify(result)}`);
  return result.error.message;
};
const closedReasons = (events: readonly SemanticEvent[]) => events.flatMap((event) => event.type === 'closed' ? [event.reason] : []);

afterEach(() => { vi.useRealTimers(); });

describe('Toaster steps', () => {
  it('open shows the top notification in the Island for attention, and needs a Toaster on screen', async () => {
    const t = setup();
    admit(t.controller, quiet('a'));
    const b = admit(t.controller, quiet('b'));
    expect(error(await t.act('toaster', 'open'))).toBe('No Toaster is on screen: "open" needs one.');
    expect(t.controller.getSnapshot().island.open).toBe(false);

    attach(t.bridge);
    expect(t.toaster().actions).toContain('open');
    expect(done(await t.act('toaster', 'open'))).toEqual({ step: 0, ref: 'toaster' });
    expect(t.controller.getSnapshot().island).toEqual({ open: true, reason: 'attention', current: b, source: 'agent' });
    expect(t.toaster().island.current).toBe(t.entry('b').ref);
    expect(error(await t.act('toaster', 'open'))).toBe('"open" is not available on "toaster" now. Available: close, clear.');
  });

  it('open on an empty Toaster is not available', async () => {
    const t = setup();
    attach(t.bridge);
    expect(error(await t.act('toaster', 'open'))).toBe('"open" is not available on "toaster" now. Available: none.');
  });

  it('close collapses the Island, with or without a Toaster on screen', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    const a = admit(t.controller, quiet('a'));
    t.bridge.openIsland(lease, 'user', a);
    t.bridge.detach(lease);
    expect(done(await t.act('toaster', 'close'))).toEqual({ step: 0, ref: 'toaster' });
    expect(t.controller.getSnapshot().island.open).toBe(false);
    expect(error(await t.act('toaster', 'close'))).toBe('"close" is not available on "toaster" now. Available: clear.');
  });

  it('clear closes every notification for the reason clear, with the Island closed', async () => {
    const t = setup();
    admit(t.controller, quiet('a'));
    admit(t.controller, quiet('b'));
    expect(done(await t.act('toaster', 'clear'))).toEqual({ step: 0, ref: 'toaster' });
    expect(t.controller.getSnapshot().notifications).toEqual([]);
    expect(closedReasons(t.events)).toEqual(['clear', 'clear']);
    expect(error(await t.act('toaster', 'clear'))).toBe('"clear" is not available on "toaster" now. Available: none.');
  });

  it('acknowledge forgets the missed count', async () => {
    const t = setup();
    for (let index = 0; index < 100; index++) admit(t.controller, quiet(`n-${index}`));
    expect(t.controller.show(quiet('extra')).status).toBe('rejected');
    expect(done(await t.act('toaster', 'acknowledge'))).toEqual({ step: 0, ref: 'toaster' });
    expect(t.controller.getSnapshot().overflow).toEqual({ count: 0, pending: false });
    expect(error(await t.act('toaster', 'acknowledge'))).toBe('"acknowledge" is not available on "toaster" now. Available: clear.');
  });

  it('refuses a verb of another record, a verb it does not know and any argument', async () => {
    const t = setup();
    attach(t.bridge);
    admit(t.controller, quiet('a'));
    const ref = t.entry('a').ref;
    expect(error(await t.act('toaster', 'press'))).toBe('"press" is not available on "toaster" now. Available: open, clear.');
    expect(error(await t.act(ref, 'open'))).toBe(`"open" is not available on "${ref}" now. Available: dismiss, show.`);
    expect(error(await t.act(ref, 'explode'))).toBe(`"explode" is not available on "${ref}" now. Available: dismiss, show.`);
    expect(error(await t.act('toaster', 'clear', [true]))).toBe('"clear" on "toaster" takes no arguments.');
    expect(error(await t.act(ref, 'dismiss', ['now']))).toBe(`"dismiss" on "${ref}" takes no arguments.`);
    expect(t.controller.getSnapshot().notifications).toHaveLength(1);
  });
});

describe('notification steps', () => {
  it('show opens the Island on the notification for attention and moves an open one, keeping its reason', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    const a = admit(t.controller, quiet('a'));
    const b = admit(t.controller, quiet('b'));
    expect(done(await t.act(t.entry('a').ref, 'show'))).toEqual({ step: 0, ref: t.entry('a').ref });
    expect(t.controller.getSnapshot().island).toEqual({ open: true, reason: 'attention', current: a, source: 'agent' });
    expect(error(await t.act(t.entry('a').ref, 'show'))).toMatch(/^"show" is not available on "toaster:\d+" now\. Available: dismiss\.$/);

    t.bridge.collapseIsland(lease);
    t.bridge.openIsland(lease, 'user', a);
    done(await t.act(t.entry('b').ref, 'show'));
    expect(t.controller.getSnapshot().island).toEqual({ open: true, reason: 'user', current: b, source: 'agent' });
  });

  it('show needs a Toaster on screen and is not listed without one', async () => {
    const t = setup();
    admit(t.controller, quiet('a'));
    const ref = t.entry('a').ref;
    expect(t.entry('a').actions).toEqual(['dismiss']);
    expect(error(await t.act(ref, 'show'))).toBe('No Toaster is on screen: "show" needs one.');
    expect(t.controller.getSnapshot().island.open).toBe(false);
  });

  it('show is navigation: it fulfils a pending auto-open of its notification and delays another one', async () => {
    const t = setup();
    attach(t.bridge);
    const initiator = admit(t.controller, quiet('initiator', { attention: 'open' }));
    done(await t.act(t.entry('initiator').ref, 'show'));
    t.clock.advanceBy(10_000);
    expect(t.controller.getSnapshot().island).toEqual({ open: true, reason: 'attention', current: initiator, source: 'agent' });

    const other = admit(t.controller, quiet('other'));
    const late = admit(t.controller, quiet('late', { attention: 'open' }));
    t.clock.advanceBy(300);
    done(await t.act(t.entry('other').ref, 'show'));
    t.clock.advanceBy(300);
    expect(t.controller.getSnapshot().island.current).toBe(other);
    t.clock.advanceBy(300);
    expect(t.controller.getSnapshot().island.current).toBe(late);
  });

  it('dismiss closes the notification for the reason programmatic and its ref goes stale', async () => {
    const t = setup();
    admit(t.controller, quiet('a'));
    const ref = t.entry('a').ref;
    expect(done(await t.act(ref, 'dismiss'))).toEqual({ step: 0, ref, gone: true });
    expect(t.controller.getSnapshot().notifications).toEqual([]);
    expect(closedReasons(t.events)).toEqual(['programmatic']);
    expect(error(await t.act(ref, 'dismiss'))).toBe(`No entry "${ref}". Current refs: toaster.`);
  });
});

describe('operation steps', () => {
  it('cancel requests cancellation of the current attempt once and refuses after it settles', async () => {
    const t = setup();
    const source = createDeferred<string>();
    let signal: AbortSignal | undefined;
    const operation = t.controller.track((context) => { signal = context.signal; return source.promise; }, {
      pending: { title: 'Uploading' }, success: { title: 'Uploaded' }, error: { title: 'Upload failed' },
    });
    const ref = t.entry('Uploading').ref;
    expect(done(await t.act(ref, 'cancel'))).toEqual({ step: 0, ref, result: 'requested' });
    expect(signal?.aborted).toBe(true);
    expect(operation.getSnapshot()).toMatchObject({ status: 'pending', cancelRequested: true });
    expect(error(await t.act(ref, 'cancel'))).toBe('Cancelling this operation was already requested.');
    source.resolve('late');
    await operation.result;
    expect(error(await t.act(t.entry('Uploaded').ref, 'cancel'))).toBe('This operation has already finished.');
  });

  it('cancel refuses an operation that cannot be cancelled', async () => {
    const t = setup();
    const source = createDeferred<string>();
    t.controller.track(source.promise, { pending: { title: 'Saving' }, success: { title: 'Saved' }, error: { title: 'Failed' } });
    expect(error(await t.act(t.entry('Saving').ref, 'cancel'))).toBe("This operation can't be cancelled.");
    source.resolve('ok');
  });

  it('retry starts a new attempt after a failure and refuses while one runs', async () => {
    const t = setup();
    let attempts = 0;
    const sources = [createDeferred<string>(), createDeferred<string>()];
    const operation = t.controller.track(() => sources[attempts++]!.promise, {
      pending: { title: 'Uploading' }, success: { title: 'Uploaded' }, error: { title: 'Upload failed' },
    });
    expect(error(await t.act(t.entry('Uploading').ref, 'retry'))).toBe("This operation is still running, so it can't be retried yet.");
    sources[0]!.reject(new Error('Offline'));
    await expect(operation.result).rejects.toThrow('Offline');
    const ref = t.entry('Upload failed').ref;
    expect(done(await t.act(ref, 'retry'))).toEqual({ step: 0, ref, result: 'started' });
    expect(attempts).toBe(2);
    expect(operation.getSnapshot()).toMatchObject({ status: 'pending', attempt: 2 });
    expect(JSON.stringify(await t.act(ref, 'retry'))).not.toContain(operation.getSnapshot().token);
    sources[1]!.resolve('ok');
  });

  it('retry refuses an operation without a factory', async () => {
    const t = setup();
    const source = createDeferred<string>();
    const operation = t.controller.track(source.promise, { pending: { title: 'Saving' }, success: { title: 'Saved' }, error: { title: 'Failed' } });
    source.reject(new Error('Nope'));
    await expect(operation.result).rejects.toThrow('Nope');
    expect(error(await t.act(t.entry('Failed').ref, 'retry'))).toBe("This operation can't be retried.");
  });

  it('cancel and retry are not available on a notification without an operation', async () => {
    const t = setup();
    admit(t.controller, quiet('plain'));
    const ref = t.entry('plain').ref;
    expect(error(await t.act(ref, 'cancel'))).toBe(`"cancel" is not available on "${ref}" now. Available: dismiss.`);
    expect(error(await t.act(ref, 'retry'))).toBe(`"retry" is not available on "${ref}" now. Available: dismiss.`);
  });
});

describe('press and the agent marker', () => {
  const answers: [string, Allow | undefined][] = [
    ['allow → true', () => true],
    ['allow → false', () => false],
    ['no allow', undefined],
  ];

  for (const [name, allow] of answers) {
    it(`deny never runs the command (${name}) and never asks allow`, async () => {
      const spy = allow && vi.fn(allow);
      const t = setup(spy ? { allow: spy } : {});
      const action = command('Delete', { agent: 'deny' });
      admit(t.controller, quiet('file', { title: 'File', action }));
      expect(error(await t.act(t.entry('File').ref, 'press'))).toBe('Not allowed: the app does not let an agent press "Delete" on "File". Look for no other way.');
      expect(action.run).not.toHaveBeenCalled();
      if (spy) expect(spy).not.toHaveBeenCalled();
    });
  }

  it('confirm without allow needs a person and does not run', async () => {
    const t = setup();
    const action = command('Undo');
    admit(t.controller, quiet('file', { title: 'File deleted', action }));
    expect(error(await t.act(t.entry('File deleted').ref, 'press')))
      .toBe('Needs a person: "Undo" on "File deleted". No Toaster is on screen, so tell them what it does.');
    attach(t.bridge);
    expect(error(await t.act(t.entry('File deleted').ref, 'press')))
      .toBe('Needs a person: "Undo" on "File deleted". The Island is open on it. Ask them to press "Undo" themselves.');
    await Promise.resolve();
    expect(action.run).not.toHaveBeenCalled();
    expect(t.controller.getSnapshot().notifications).toHaveLength(1);
  });

  it('confirm with allow → false needs a person; with allow → true runs exactly once', async () => {
    let answer = false;
    const allow = vi.fn<Allow>(() => answer);
    const t = setup({ allow });
    const action = command('Undo', { agent: 'confirm' });
    admit(t.controller, quiet('file', { title: 'File deleted', action }));
    const ref = t.entry('File deleted').ref;
    expect(error(await t.act(ref, 'press'))).toMatch(/^Needs a person: "Undo" on "File deleted"\./);
    expect(allow).toHaveBeenLastCalledWith({ ref, action: 'press', args: [], needsPerson: true }, expect.anything());
    expect(action.run).not.toHaveBeenCalled();
    answer = true;
    expect(done(await t.act(ref, 'press'))).toEqual({ step: 0, ref, gone: true });
    expect(action.run).toHaveBeenCalledOnce();
    expect(closedReasons(t.events)).toEqual(['action-success']);
  });

  it('allow runs without a callback and with allow → true, and stops on allow → false', async () => {
    for (const [allow, runs] of [[undefined, true], [() => true, true], [() => false, false]] as const) {
      const t = setup(allow ? { allow } : {});
      const action = command('Archive', { agent: 'allow' });
      admit(t.controller, quiet('mail', { title: 'Mail', action }));
      const ref = t.entry('Mail').ref;
      const result = await t.act(ref, 'press');
      if (runs) expect(done(result)).toEqual({ step: 0, ref, gone: true });
      else expect(error(result)).toBe(`The app said no to "press" on "${ref}".`);
      expect(action.run).toHaveBeenCalledTimes(runs ? 1 : 0);
    }
  });

  it('asks allow with needsPerson false for every other step', async () => {
    const allow = vi.fn<Allow>(() => true);
    const t = setup({ allow });
    admit(t.controller, quiet('a'));
    const ref = t.entry('a').ref;
    done(await t.act(ref, 'dismiss'));
    expect(allow).toHaveBeenCalledWith({ ref, action: 'dismiss', args: [], needsPerson: false }, expect.anything());
  });

  it('does not run when the app makes the marker stricter while the step waits for allow', async () => {
    for (const [from, to] of [['confirm', 'deny'], ['allow', 'confirm'], ['allow', 'deny']] as const) {
      const answer = createDeferred<boolean>();
      const t = setup({ allow: () => answer.promise });
      const action = command('Pay', { agent: from });
      const handle = admit(t.controller, quiet('bill', { title: 'Bill', action }));
      const ref = t.entry('Bill').ref;
      const pending = t.act(ref, 'press');
      await Promise.resolve();
      const stricter = command('Pay', { agent: to });
      expect(t.controller.update(handle, { action: stricter }).status).toBe('applied');
      answer.resolve(true);
      expect(error(await pending)).toBe(`"press" on "${ref}" changed while it waited, so it did not run. Read the snapshot and try again.`);
      expect(action.run).not.toHaveBeenCalled();
      expect(stricter.run).not.toHaveBeenCalled();
    }
  });

  it('does not run an action the app put in place while the step waited, even under a looser marker', async () => {
    for (const marker of ['confirm', 'allow'] as const) {
      const answer = createDeferred<boolean>();
      const t = setup({ allow: () => answer.promise });
      const approved = command('Undo');
      const handle = admit(t.controller, quiet('file', { title: 'File deleted', action: approved }));
      const ref = t.entry('File deleted').ref;
      const pending = t.act(ref, 'press');
      await Promise.resolve();
      const replacement = command('Delete everything', { agent: marker });
      expect(t.controller.update(handle, { action: replacement }).status).toBe('applied');
      answer.resolve(true);
      expect(error(await pending)).toBe(`"press" on "${ref}" changed while it waited, so it did not run. Read the snapshot and try again.`);
      expect(approved.run).not.toHaveBeenCalled();
      expect(replacement.run).not.toHaveBeenCalled();
    }
  });

  it('runs the approved action when the app changes something else while the step waits', async () => {
    const answer = createDeferred<boolean>();
    const t = setup({ allow: () => answer.promise });
    const action = command('Undo');
    const handle = admit(t.controller, quiet('file', { title: 'File deleted', action }));
    const pending = t.act(t.entry('File deleted').ref, 'press');
    await Promise.resolve();
    expect(t.controller.update(handle, { title: 'File deleted · 2' }).status).toBe('applied');
    answer.resolve(true);
    done(await pending);
    expect(action.run).toHaveBeenCalledOnce();
  });

  it('run itself refuses a press approved under a looser class than the marker now asks', async () => {
    const t = setup();
    const action = command('Undo');
    admit(t.controller, quiet('file', { title: 'File', action }));
    const ref = t.entry('File').ref;
    const signal = new AbortController().signal;
    expect(t.component.check({ ref, action: 'press', args: [] })).toEqual({ available: true, permission: 'confirm', names: { target: 'Undo', within: 'File' } });
    expect(await t.component.run({ ref, action: 'press', args: [] }, { signal, approved: 'allow' })).toEqual({ status: 'stale' });
    expect(action.run).not.toHaveBeenCalled();
  });
});

describe('press and the command', () => {
  it('waits for a failing command and returns the message the person sees, not the raw error', async () => {
    const t = setup();
    const action = command('Undo', { agent: 'allow', run: () => Promise.reject(new Error('ECONNRESET 10.0.0.7')), errorMessage: () => 'Could not undo' });
    admit(t.controller, quiet('file', { title: 'File deleted', action }));
    const message = error(await t.act(t.entry('File deleted').ref, 'press'));
    expect(message).toBe('"Undo" failed: Could not undo');
    expect(t.entry('File deleted').action).toMatchObject({ status: 'failed', message: 'Could not undo' });
  });

  it('falls back to the action error message without errorMessage', async () => {
    const t = setup();
    admit(t.controller, quiet('file', { title: 'File deleted', action: command('Undo', { agent: 'allow', run: () => { throw new Error('secret detail'); } }) }));
    expect(error(await t.act(t.entry('File deleted').ref, 'press'))).toBe('"Undo" failed: Action failed');
  });

  it('a long command stays running and the step returns pending at the timeout', async () => {
    vi.useFakeTimers();
    const t = setup({ timeout: 1_000 });
    const run = createDeferred<void>();
    const action = command('Sync', { agent: 'allow', run: () => run.promise });
    admit(t.controller, quiet('sync', { title: 'Sync', action }));
    const ref = t.entry('Sync').ref;
    const pending = t.act(ref, 'press');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(done(await pending)).toEqual({ step: 0, ref, result: 'pending' });
    expect(t.entry('Sync').action).toMatchObject({ status: 'pending' });
    expect(error(await t.act(ref, 'press'))).toBe('"Sync" is already running.');
    run.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.controller.getSnapshot().notifications).toEqual([]);
  });

  it('refuses a command the person already started', async () => {
    const t = setup();
    const lease = attach(t.bridge);
    const run = createDeferred<void>();
    const handle = admit(t.controller, quiet('sync', { title: 'Sync', action: command('Sync', { agent: 'allow', run: () => run.promise }) }));
    t.bridge.invokeAction(lease, handle);
    expect(error(await t.act(t.entry('Sync').ref, 'press'))).toBe('"Sync" is already running.');
    run.resolve();
  });

  it('stops waiting when the notification closes while the command runs', async () => {
    const t = setup();
    const run = createDeferred<void>();
    const handle = admit(t.controller, quiet('sync', { title: 'Sync', action: command('Sync', { agent: 'allow', run: () => run.promise }) }));
    const ref = t.entry('Sync').ref;
    const pending = t.act(ref, 'press');
    await Promise.resolve();
    await Promise.resolve();
    t.controller.dismiss(handle);
    expect(done(await pending)).toEqual({ step: 0, ref, result: 'pending', gone: true });
    run.resolve();
  });

  it('stops waiting when a command closes its own notification synchronously', async () => {
    const t = setup();
    let controller: Core | undefined;
    const handle = admit(t.controller, quiet('sync', { title: 'Sync', action: command('Sync', { agent: 'allow',
      run: () => { controller!.dismiss(handle); return new Promise(() => {}); } }) }));
    controller = t.controller;
    const ref = t.entry('Sync').ref;
    expect(done(await t.act(ref, 'press'))).toEqual({ step: 0, ref, result: 'pending', gone: true });
  });

  it('stops waiting when an operation replaces the action while the command runs', async () => {
    const t = setup();
    const run = createDeferred<void>();
    const source = createDeferred<string>();
    t.controller.track(source.promise, {
      pending: { title: 'Upload', action: command('Pause', { agent: 'allow', run: () => run.promise }) },
      success: { title: 'Uploaded' }, error: { title: 'Failed' },
    });
    const ref = t.entry('Upload').ref;
    const pending = t.act(ref, 'press');
    await Promise.resolve();
    source.resolve('done');
    expect(done(await pending)).toEqual({ step: 0, ref, result: 'pending' });
    run.resolve();
  });

  it('a controller disposed while the command runs ends the wait with the notification gone', async () => {
    const t = setup();
    const run = createDeferred<void>();
    admit(t.controller, quiet('sync', { title: 'Sync', action: command('Sync', { agent: 'allow', run: () => run.promise }) }));
    const ref = t.entry('Sync').ref;
    const pending = t.act(ref, 'press');
    await Promise.resolve();
    t.controller.dispose();
    expect(done(await pending)).toEqual({ step: 0, ref, result: 'pending', gone: true });
    run.resolve();
  });

  it('a controller disposed while a step waits for allow runs nothing and reports the ref gone', async () => {
    const answer = createDeferred<boolean>();
    const t = setup({ allow: () => answer.promise });
    const action = command('Undo', { agent: 'allow' });
    admit(t.controller, quiet('file', { title: 'File', action }));
    const ref = t.entry('File').ref;
    const pending = t.act(ref, 'press');
    await Promise.resolve();
    t.controller.dispose();
    answer.resolve(true);
    expect(error(await pending)).toBe(`No entry "${ref}". Current refs: none.`);
    expect(action.run).not.toHaveBeenCalled();
  });

  it('stops waiting on the caller signal; the command keeps running', async () => {
    const t = setup();
    const run = createDeferred<void>();
    admit(t.controller, quiet('sync', { title: 'Sync', action: command('Sync', { agent: 'allow', run: () => run.promise }) }));
    const ref = t.entry('Sync').ref;
    const cancel = new AbortController();
    const pending = t.agent.act({ steps: [{ ref, action: 'press' }] }, { signal: cancel.signal });
    await Promise.resolve();
    await Promise.resolve();
    cancel.abort();
    expect(error(await pending)).toBe(`Cancelled while "press" on "${ref}" was running. It may still finish.`);
    expect(t.entry('Sync').action).toMatchObject({ status: 'pending' });
    run.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(t.controller.getSnapshot().notifications).toEqual([]);
  });
});

describe('across steps and controllers', () => {
  it('runs a call over two controllers in one agent, each under its own name', async () => {
    const main = harness().controller;
    const secondary = harness().controller;
    const agent = createAgent();
    agent.connect(toasterAgent(main));
    agent.connect(toasterAgent(secondary, { name: 'secondary' }));
    admit(main, quiet('main'));
    admit(secondary, quiet('side'));
    const result = await agent.act({ steps: [
      { ref: 'secondary:1', action: 'dismiss' },
      { ref: 'toaster', action: 'clear' },
    ] });
    expect(result).toEqual({ ok: true, steps: [{ step: 0, ref: 'secondary:1', gone: true }, { step: 1, ref: 'toaster' }] });
    expect(main.getSnapshot().notifications).toEqual([]);
    expect(secondary.getSnapshot().notifications).toEqual([]);
  });

  it('keeps earlier steps done when a later one fails', async () => {
    const t = setup();
    attach(t.bridge);
    admit(t.controller, quiet('a'));
    admit(t.controller, quiet('b'));
    const result = await t.agent.act({ steps: [
      { ref: t.entry('b').ref, action: 'show' },
      { ref: t.entry('a').ref, action: 'dismiss' },
      { ref: 'toaster', action: 'acknowledge' },
    ] });
    expect(result.ok ? null : result.error).toEqual({ step: 2, message: '"acknowledge" is not available on "toaster" now. Available: close, clear. Steps 0–1 stayed done.' });
    expect(t.controller.getSnapshot().notifications.map((item) => item.content.title)).toEqual(['b']);
  });

  it('no step asks for focus', async () => {
    const t = setup({ allow: () => true });
    attach(t.bridge);
    const source = createDeferred<string>();
    const operation = t.controller.track(() => source.promise, { pending: { title: 'Op' }, success: { title: 'Op done' }, error: { title: 'Op failed' } });
    admit(t.controller, quiet('cmd', { title: 'Cmd', action: command('Go') }));
    admit(t.controller, quiet('a'));
    for (const [ref, action] of [
      ['toaster', 'open'], [t.entry('Cmd').ref, 'show'], ['toaster', 'close'], [t.entry('Op').ref, 'show'],
      [t.entry('Op').ref, 'cancel'], [t.entry('a').ref, 'dismiss'], [t.entry('Cmd').ref, 'press'],
    ] as const) {
      done(await t.act(ref, action));
      expect(t.bridge.getSnapshot().focusRequest).toBeNull();
    }
    source.reject(new Error('stop'));
    await operation.result.catch(() => {});
    done(await t.act(t.entry('Op failed').ref, 'retry'));
    done(await t.act('toaster', 'clear'));
    expect(t.bridge.getSnapshot().focusRequest).toBeNull();
  });

  it('check has no side effects', () => {
    const t = setup();
    const source = createDeferred<string>();
    const operation = t.controller.track(() => source.promise, { pending: { title: 'Op' }, success: { title: 'Done' }, error: { title: 'Failed' } });
    const action = command('Go', { agent: 'allow' });
    admit(t.controller, quiet('cmd', { title: 'Cmd', action }));
    const before = t.controller.getSnapshot();
    for (const [ref, verb] of [[t.entry('Op').ref, 'cancel'], [t.entry('Cmd').ref, 'press'], [t.entry('Cmd').ref, 'dismiss'], ['toaster', 'clear']] as const) {
      expect(t.component.check({ ref, action: verb, args: [] })).toMatchObject({ available: true });
    }
    expect(t.controller.getSnapshot()).toBe(before);
    expect(operation.getSnapshot().cancelRequested).toBe(false);
    expect(action.run).not.toHaveBeenCalled();
  });
});
