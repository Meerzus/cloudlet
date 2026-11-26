import { describe, expect, it, vi } from 'vitest';
import { createAgent } from '@cloudlet/agent';
import type { FormAction } from '../../packages/toast/src/contracts/notifications.js';
import { toasterAgent, type NotificationEntry, type ToasterEntry } from '../../packages/toast/src/agent.js';
import { admit, attach, harness } from '../support/controller-harness.js';
import { createDeferred } from '../support/deferred.js';

const quiet = (id: string, extra: object = {}) => ({ id, title: id, duration: null, attention: 'stack' as const, ...extra });
const toasterOf = (entries: readonly unknown[]) => entries[0] as ToasterEntry;
const notificationsOf = (entries: readonly unknown[]) => entries.slice(1) as NotificationEntry[];
const byLabel = (entries: readonly unknown[], label: string) => {
  const entry = notificationsOf(entries).find((item) => item.label === label);
  if (!entry) throw new Error(`Missing entry ${label}`);
  return entry;
};

const form = (extra: Partial<FormAction> = {}): FormAction => ({
  kind: 'form', label: 'Send', run: vi.fn(),
  fields: [
    { name: 'reply', kind: 'text', label: 'Reply', required: true, placeholder: 'Type a reply', maxLength: 40 },
    { name: 'note', kind: 'textarea', label: 'Note', defaultValue: 'Default note text' },
  ],
  ...extra,
});

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('toasterAgent component', () => {
  it('speaks protocol 1 under the default or given name and is frozen', () => {
    const { controller } = harness();
    const component = toasterAgent(controller);
    expect(component).toMatchObject({ protocol: 1, name: 'toaster' });
    expect(Object.isFrozen(component)).toBe(true);
    expect(toasterAgent(controller, { name: 'secondary' }).name).toBe('secondary');
  });

  it('rejects a controller this package did not create', () => {
    expect(() => toasterAgent({} as never)).toThrow(TypeError);
  });

  it('starts with the Toaster record alone and touches no host', () => {
    const { controller, bridge } = harness();
    const entries = toasterAgent(controller).snapshot();
    expect(entries).toEqual([{
      ref: 'toaster', component: 'toaster', actions: [],
      island: { open: false, current: null }, count: 0, overflow: { count: 0, pending: false }, mounted: false,
    }]);
    // Reading leaves the host free for a Toaster.
    expect(bridge.attach().status).toBe('attached');
  });
});

describe('notification records', () => {
  it('describes text, rich and icon notifications without their content objects', () => {
    const { controller } = harness();
    const node = { type: 'strong', props: { children: 'Rich node' } };
    admit(controller, quiet('text', { title: 'Saved', kind: 'success', description: { kind: 'text', text: 'All changes saved' } }));
    admit(controller, quiet('rich', { title: 'Shared', description: { kind: 'rich', content: node, announcement: 'Shared with Anna' } }));
    admit(controller, quiet('icon', { title: 'Synced', icon: { type: 'svg' }, progress: { kind: 'determinate', value: 0.5, label: 'Half' } }));
    const entries = toasterAgent(controller).snapshot();

    expect(byLabel(entries, 'Saved')).toEqual({
      ref: expect.stringMatching(/^toaster:\d+$/), component: 'notification', actions: ['dismiss', 'show'],
      label: 'Saved', text: 'All changes saved', kind: 'success', priority: 'normal', occurrences: 1,
      location: 'stack', remainingMs: null, pauseReasons: expect.any(Array), progress: null, draft: false,
      operation: null, action: null,
    });
    expect(byLabel(entries, 'Shared').text).toBe('Shared with Anna');
    expect(byLabel(entries, 'Synced')).toMatchObject({ text: null, progress: { kind: 'determinate', value: 0.5, label: 'Half' } });
    const json = JSON.stringify(entries);
    expect(json).not.toContain('Rich node');
    expect(json).not.toContain('svg');
    expect(json).not.toContain('"icon"');
    expect(() => structuredClone(entries)).not.toThrow();
  });

  it('lists notifications in presentation order after the Toaster record, newest first', () => {
    const { controller } = harness();
    admit(controller, quiet('a'));
    admit(controller, quiet('b'));
    admit(controller, quiet('c'));
    const entries = toasterAgent(controller).snapshot();
    expect(entries.map((entry) => entry.component)).toEqual(['toaster', 'notification', 'notification', 'notification']);
    expect(notificationsOf(entries).map((entry) => entry.label)).toEqual(['c', 'b', 'a']);
    expect(toasterOf(entries).count).toBe(3);
  });

  it('describes a command and a link with the link href', async () => {
    const { controller } = harness();
    const run = createDeferred<void>();
    admit(controller, quiet('undo', { title: 'Deleted', action: { kind: 'command', label: 'Undo', run: () => run.promise } }));
    admit(controller, quiet('open', { title: 'Report ready', action: { kind: 'link', label: 'Open', href: '/reports/7' } }));
    const component = toasterAgent(controller);
    expect(byLabel(component.snapshot(), 'Deleted')).toMatchObject({
      actions: ['dismiss', 'show', 'press'], action: { kind: 'command', label: 'Undo', status: 'idle', message: null },
    });
    expect(byLabel(component.snapshot(), 'Report ready')).toMatchObject({
      actions: ['dismiss', 'show'], action: { kind: 'link', label: 'Open', href: '/reports/7', status: 'idle', message: null },
    });
    expect(byLabel(component.snapshot(), 'Deleted').action).not.toHaveProperty('href');
    expect(byLabel(component.snapshot(), 'Report ready').action).not.toHaveProperty('agent');
  });

  it('reads the agent marker of a command, confirm by default, and drops press under deny', () => {
    const { controller } = harness();
    const command = (agent?: 'allow' | 'confirm' | 'deny') => ({
      kind: 'command' as const, label: 'Run', run: vi.fn(), ...(agent ? { agent } : {}),
    });
    admit(controller, quiet('none', { title: 'None', action: command() }));
    admit(controller, quiet('allow', { title: 'Allow', action: command('allow') }));
    admit(controller, quiet('confirm', { title: 'Confirm', action: command('confirm') }));
    admit(controller, quiet('deny', { title: 'Deny', action: command('deny') }));
    const entries = toasterAgent(controller).snapshot();
    expect(byLabel(entries, 'None')).toMatchObject({ actions: ['dismiss', 'show', 'press'], action: { agent: 'confirm' } });
    expect(byLabel(entries, 'Allow')).toMatchObject({ actions: ['dismiss', 'show', 'press'], action: { agent: 'allow' } });
    expect(byLabel(entries, 'Confirm')).toMatchObject({ actions: ['dismiss', 'show', 'press'], action: { agent: 'confirm' } });
    expect(byLabel(entries, 'Deny')).toMatchObject({ actions: ['dismiss', 'show'], action: { agent: 'deny' } });
  });

  it('keeps the person able to press a command the agent may not', async () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const run = vi.fn();
    const handle = admit(controller, quiet('deny', { title: 'Delete', action: { kind: 'command', label: 'Delete', run, agent: 'deny' } }));
    bridge.openIsland(lease, 'user', handle);
    expect(bridge.invokeAction(lease, handle)).toEqual({ status: 'started' });
    await flush();
    expect(run).toHaveBeenCalledOnce();
  });

  it('describes a pending and a failed command without its attempt token', async () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const run = createDeferred<void>();
    const handle = admit(controller, quiet('undo', { title: 'Deleted', action: {
      kind: 'command', label: 'Undo', run: () => run.promise, errorMessage: () => 'Could not undo',
    } }));
    bridge.openIsland(lease, 'user', handle);
    expect(bridge.invokeAction(lease, handle)).toEqual({ status: 'started' });
    const component = toasterAgent(controller);
    const pending = byLabel(component.snapshot(), 'Deleted');
    expect(pending.action).toMatchObject({ status: 'pending', message: null });
    expect(pending.actions).not.toContain('press');
    run.reject(new Error('Network'));
    await flush();
    const failed = byLabel(component.snapshot(), 'Deleted');
    expect(failed.action).toEqual({ kind: 'command', label: 'Undo', status: 'failed', message: 'Could not undo', agent: 'confirm' });
    expect(failed.actions).toContain('press');
    expect(JSON.stringify(component.snapshot())).not.toContain('token');
  });
});

describe('form records', () => {
  it('shows fields, filled and errors but never a value, default or placeholder', () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const handle = admit(controller, quiet('anna', { title: 'Anna: are you coming?', action: form() }));
    bridge.openIsland(lease, 'user', handle);
    const component = toasterAgent(controller);

    const before = byLabel(component.snapshot(), 'Anna: are you coming?');
    expect(before.actions).toEqual(['dismiss', 'fill', 'submit']);
    expect(before.action).toEqual({
      kind: 'form', label: 'Send', status: 'idle', message: null, error: null, agent: 'confirm',
      fields: [
        { name: 'reply', label: 'Reply', required: true, filled: false, error: null },
        { name: 'note', label: 'Note', required: false, filled: true, error: null },
      ],
    });

    // A submit with an empty required field fails validation.
    expect(bridge.invokeAction(lease, handle)).toMatchObject({ status: 'invalid' });
    expect(byLabel(component.snapshot(), 'Anna: are you coming?').action?.fields?.[0]).toMatchObject({ filled: false, error: 'This field is required' });

    const secret = 'Secret reply 7f3a';
    expect(bridge.setFormValue(lease, handle, 'reply', secret)).toEqual({ status: 'applied' });
    expect(bridge.setFormValue(lease, handle, 'note', '   ')).toEqual({ status: 'applied' });
    const after = component.snapshot();
    const entry = byLabel(after, 'Anna: are you coming?');
    expect(entry.draft).toBe(true);
    expect(entry.action?.fields?.map((field) => field.filled)).toEqual([true, false]);

    const json = JSON.stringify(after);
    for (const hidden of [secret, 'Default note text', 'Type a reply', '"value"', 'defaultValue', 'placeholder']) {
      expect(json).not.toContain(hidden);
    }
    expect(structuredClone(after)).toEqual(after);
  });

  it('reads the agent marker of a form and keeps fill but not submit under deny', () => {
    const { controller } = harness();
    admit(controller, quiet('none', { title: 'None', action: form() }));
    admit(controller, quiet('allow', { title: 'Allow', action: form({ agent: 'allow' }) }));
    admit(controller, quiet('deny', { title: 'Deny', action: form({ agent: 'deny' }) }));
    const entries = toasterAgent(controller).snapshot();
    expect(byLabel(entries, 'None')).toMatchObject({ actions: ['dismiss', 'show', 'fill', 'submit'], action: { agent: 'confirm' } });
    expect(byLabel(entries, 'Allow')).toMatchObject({ actions: ['dismiss', 'show', 'fill', 'submit'], action: { agent: 'allow' } });
    expect(byLabel(entries, 'Deny')).toMatchObject({ actions: ['dismiss', 'show', 'fill'], action: { agent: 'deny' } });
  });

  it('keeps the person able to submit a form the agent may not', async () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const run = vi.fn();
    const handle = admit(controller, quiet('deny', { title: 'Reply', action: form({ run, agent: 'deny' }) }));
    bridge.openIsland(lease, 'user', handle);
    expect(bridge.setFormValue(lease, handle, 'reply', 'Yes')).toEqual({ status: 'applied' });
    expect(bridge.invokeAction(lease, handle)).toEqual({ status: 'started' });
    await flush();
    expect(run).toHaveBeenCalledOnce();
  });

  it('reads only own error keys, so a field named like an Object method stays a plain record', () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const handle = admit(controller, quiet('odd', { title: 'Odd names', action: form({ fields: [
      { name: 'constructor', kind: 'text', label: 'Constructor' },
      { name: 'toString', kind: 'text', label: 'To string', required: true },
    ] }) }));
    bridge.openIsland(lease, 'user', handle);
    const fields = () => byLabel(toasterAgent(controller).snapshot(), 'Odd names').action?.fields;
    expect(fields()?.map((field) => field.error)).toEqual([null, null]);
    expect(bridge.invokeAction(lease, handle)).toMatchObject({ status: 'invalid' });
    expect(fields()?.map((field) => field.error)).toEqual([null, 'This field is required']);
    expect(() => structuredClone(toasterAgent(controller).snapshot())).not.toThrow();
  });

  it('carries a form-wide message from validate', () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const handle = admit(controller, quiet('anna', { title: 'Reply', action: form({ validate: () => 'Try again later' }) }));
    bridge.openIsland(lease, 'user', handle);
    bridge.setFormValue(lease, handle, 'reply', 'Yes');
    expect(bridge.invokeAction(lease, handle)).toMatchObject({ status: 'invalid' });
    expect(byLabel(toasterAgent(controller).snapshot(), 'Reply').action).toMatchObject({ error: 'Try again later' });
  });
});

describe('operation records', () => {
  it('lists cancel while pending and retry after a failure, without the attempt token', async () => {
    const { controller } = harness();
    const source = createDeferred<string>();
    let attempts = 0;
    const operation = controller.track(() => { attempts += 1; return source.promise; }, {
      pending: { title: 'Uploading' }, success: { title: 'Uploaded' }, error: { title: 'Upload failed' },
    });
    const component = toasterAgent(controller);
    const pending = byLabel(component.snapshot(), 'Uploading');
    expect(pending.operation).toEqual({ status: 'pending', attempt: 1, canCancel: true, canRetry: false, cancelRequested: false });
    expect(pending.actions).toContain('cancel');
    expect(pending.actions).not.toContain('retry');

    source.reject(new Error('Offline'));
    await expect(operation.result).rejects.toThrow('Offline');
    const failed = byLabel(component.snapshot(), 'Upload failed');
    expect(failed.operation).toMatchObject({ status: 'rejected', canCancel: false, canRetry: true });
    expect(failed.actions).toContain('retry');
    expect(failed.actions).not.toContain('cancel');
    expect(JSON.stringify(component.snapshot())).not.toContain(operation.token);
    expect(attempts).toBe(1);
  });
});

describe('the Toaster record', () => {
  it('follows the host lease, the Island and its current notification', () => {
    const { controller, bridge } = harness();
    const component = toasterAgent(controller);
    const a = admit(controller, quiet('a'));
    admit(controller, quiet('b'));
    expect(toasterOf(component.snapshot())).toMatchObject({ mounted: false, actions: ['clear'] });

    const lease = attach(bridge);
    expect(toasterOf(component.snapshot())).toMatchObject({ mounted: true, actions: ['open', 'clear'], island: { open: false, current: null } });

    bridge.openIsland(lease, 'user', a);
    const open = component.snapshot();
    const aRef = byLabel(open, 'a').ref;
    expect(toasterOf(open)).toMatchObject({ island: { open: true, current: aRef }, actions: ['close', 'clear'] });
    expect(byLabel(open, 'a').actions).not.toContain('show');
    expect(byLabel(open, 'b').actions).toContain('show');

    bridge.collapseIsland(lease);
    expect(toasterOf(component.snapshot()).island).toEqual({ open: false, current: null });
    bridge.detach(lease);
    expect(toasterOf(component.snapshot()).mounted).toBe(false);
  });

  it('reports overflow and offers acknowledge while it is pending', () => {
    const { controller } = harness();
    for (let index = 0; index < 100; index++) admit(controller, quiet(`n-${index}`));
    expect(controller.show(quiet('rejected')).status).toBe('rejected');
    const component = toasterAgent(controller);
    const toaster = toasterOf(component.snapshot());
    expect(toaster).toMatchObject({ count: 100, overflow: { count: 1, pending: true } });
    expect(toaster.actions).toContain('acknowledge');
    expect(component.snapshot()).toHaveLength(101);
    controller.acknowledgeOverflow();
    expect(toasterOf(component.snapshot()).actions).not.toContain('acknowledge');
  });
});

describe('refs and stability', () => {
  it('keeps refs across snapshots, never reuses them and issues a new one for a reshown id', () => {
    const { controller } = harness();
    const component = toasterAgent(controller);
    const a = admit(controller, quiet('a'));
    const first = byLabel(component.snapshot(), 'a').ref;
    admit(controller, quiet('b'));
    expect(byLabel(component.snapshot(), 'a').ref).toBe(first);
    const b = byLabel(component.snapshot(), 'b').ref;
    expect(b).not.toBe(first);
    expect(controller.update(a, { title: 'a' }).status).toBe('unchanged');
    controller.dismiss(a);
    admit(controller, quiet('a'));
    const again = byLabel(component.snapshot(), 'a').ref;
    expect([first, b]).not.toContain(again);
    expect(JSON.stringify(component.snapshot())).not.toContain('"id"');
  });

  it('returns the same frozen array until the controller changes and notifies through subscribe', () => {
    const { controller } = harness();
    const component = toasterAgent(controller);
    const listener = vi.fn();
    const unsubscribe = component.subscribe(listener);
    const first = component.snapshot();
    expect(component.snapshot()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.every((entry) => Object.isFrozen(entry))).toBe(true);

    admit(controller, quiet('a'));
    expect(listener).toHaveBeenCalledTimes(1);
    const second = component.snapshot();
    expect(second).not.toBe(first);
    expect(Object.isFrozen(byLabel(second, 'a').actions)).toBe(true);
    expect(component.snapshot()).toBe(second);
    unsubscribe();
    admit(controller, quiet('b'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is empty after dispose', () => {
    const { controller } = harness();
    const component = toasterAgent(controller);
    admit(controller, quiet('a'));
    controller.dispose();
    expect(component.snapshot()).toEqual([]);
    expect(Object.isFrozen(component.snapshot())).toBe(true);
  });
});

describe('with the agent bridge', () => {
  it('reads two controllers under their own names and drops one on dispose', () => {
    const main = harness().controller;
    const secondary = harness().controller;
    const agent = createAgent();
    agent.connect(toasterAgent(main));
    agent.connect(toasterAgent(secondary, { name: 'secondary' }));
    admit(main, quiet('main'));
    admit(secondary, quiet('side'));
    const refs = agent.snapshot().map((entry) => entry.ref);
    expect(refs).toEqual(['toaster', 'toaster:1', 'secondary', 'secondary:1']);
    expect(() => agent.connect(toasterAgent(main))).toThrow(TypeError);

    const listener = vi.fn();
    agent.subscribe(listener);
    secondary.dispose();
    expect(listener).toHaveBeenCalled();
    expect(agent.snapshot().map((entry) => entry.ref)).toEqual(['toaster', 'toaster:1']);
  });
});
