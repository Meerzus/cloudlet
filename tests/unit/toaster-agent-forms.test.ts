import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgent, type ActResult, type AgentOptions, type Allow } from '@cloudlet/agent';
import type { SemanticEvent } from '../../packages/toast/src/contracts/events.js';
import type { NotificationHandle } from '../../packages/toast/src/contracts/identity.js';
import type { FormAction, FormContext } from '../../packages/toast/src/contracts/notifications.js';
import { toasterAgent, type NotificationEntry } from '../../packages/toast/src/agent.js';
import { admit, attach, harness } from '../support/controller-harness.js';
import { createDeferred } from '../support/deferred.js';

// An agent fills a form's fields and submits it under the form's marker. Cloudlet remembers who
// wrote each field: the agent never overwrites what the person typed, and reads only who wrote a
// field, never what.

const TITLE = 'Anna: are you coming?';
const form = (extra: Partial<FormAction> = {}): FormAction => ({
  kind: 'form', label: 'Send', run: vi.fn(),
  fields: [
    { name: 'reply', kind: 'text', label: 'Reply', required: true, maxLength: 20, placeholder: 'Type a reply', inputMode: 'text' },
    { name: 'note', kind: 'textarea', label: 'Note', defaultValue: 'Default note' },
  ],
  ...extra,
});
const quiet = (id: string, extra: object = {}) => ({ id, title: id, duration: null, attention: 'stack' as const, ...extra });

function setup(options: AgentOptions = {}, app: Parameters<typeof harness>[0] = {}) {
  const { controller, bridge, clock } = harness(app);
  const lease = attach(bridge);
  const agent = createAgent(options);
  agent.connect(toasterAgent(controller));
  const events: SemanticEvent[] = [];
  controller.onEvent((event) => { events.push(event); });
  const focusRequests: unknown[] = [];
  bridge.subscribe(() => { const request = bridge.getSnapshot().focusRequest; if (request) focusRequests.push(request); });
  const entry = (label = TITLE) => {
    const found = agent.snapshot().find((item) => item.label === label) as NotificationEntry | undefined;
    if (!found) throw new Error(`Missing entry ${label}`);
    return found;
  };
  const fields = (label = TITLE) => entry(label).action!.fields!;
  const act = (...steps: [action: string, args?: unknown[]][]) => {
    const ref = entry().ref;
    return agent.act({ steps: steps.map(([action, args]) => ({ ref, action, ...(args ? { args } : {}) })) });
  };
  /** The values the renderer holds; only tests and the renderer may read them. */
  const values = (handle: NotificationHandle) => bridge.getSnapshot().forms.find((item) => item.handle === handle)?.values;
  /** The person types into a field. */
  const type = (handle: NotificationHandle, name: string, value: string) => bridge.setFormValue(lease, handle, name, value);
  return { controller, bridge, clock, lease, agent, events, focusRequests, entry, fields, act, values, type };
}

const error = (result: ActResult) => {
  if (result.ok) throw new Error(`Expected an error, received ${JSON.stringify(result)}`);
  return result.error.message;
};
const closedReasons = (events: readonly SemanticEvent[]) => events.flatMap((event) => event.type === 'closed' ? [event.reason] : []);
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

afterEach(() => { vi.useRealTimers(); });

describe('fill', () => {
  it('writes a field as the agent; the snapshot says who wrote it, never the value', async () => {
    const t = setup();
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form() }));
    expect(t.fields().map((field) => field.filledBy)).toEqual([null, 'app']);

    const result = await t.act(['fill', ['reply', 'Agent reply 51c2']]);
    expect(result).toEqual({ ok: true, steps: [{ step: 0, ref: t.entry().ref }] });
    expect(t.values(handle)).toEqual({ reply: 'Agent reply 51c2', note: 'Default note' });
    expect(t.fields()).toEqual([
      { name: 'reply', label: 'Reply', kind: 'text', required: true, maxLength: 20, inputMode: 'text', filled: true, filledBy: 'agent', error: null },
      { name: 'note', label: 'Note', kind: 'textarea', required: false, maxLength: null, inputMode: null, filled: true, filledBy: 'app', error: null },
    ]);
    const json = JSON.stringify(t.agent.snapshot());
    for (const hidden of ['Agent reply 51c2', 'Default note', 'Type a reply', 'defaultValue', 'placeholder', '"value"']) {
      expect(json).not.toContain(hidden);
    }
    expect(t.focusRequests).toEqual([]);
  });

  it('overwrites a default and its own value, and is a step of class allow whatever the marker', async () => {
    for (const agent of [undefined, 'allow', 'confirm', 'deny'] as const) {
      const allow = vi.fn<Allow>(() => true);
      const t = setup({ allow });
      const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form(agent ? { agent } : {}) }));
      expect((await t.act(['fill', ['note', 'Agent note']], ['fill', ['reply', 'First']], ['fill', ['reply', 'Second']])).ok).toBe(true);
      expect(t.values(handle)).toEqual({ reply: 'Second', note: 'Agent note' });
      expect(t.fields().map((field) => field.filledBy)).toEqual(['agent', 'agent']);
      expect(allow.mock.calls.map(([step]) => step.needsPerson)).toEqual([false, false, false]);
    }
    // Without allow, a fill runs at once.
    const t = setup();
    admit(t.controller, quiet('anna', { title: TITLE, action: form({ agent: 'deny' }) }));
    expect((await t.act(['fill', ['reply', 'Yes']])).ok).toBe(true);
  });

  it('asks allow and stops when it says no', async () => {
    const allow = vi.fn<Allow>(() => false);
    const t = setup({ allow });
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form({ agent: 'deny' }) }));
    expect(error(await t.act(['fill', ['reply', 'Yes']]))).toBe(`The app said no to "fill" on "${t.entry().ref}".`);
    expect(allow).toHaveBeenCalledWith({ ref: t.entry().ref, action: 'fill', args: ['reply', 'Yes'], needsPerson: false }, expect.anything());
    expect(t.values(handle)).toEqual({ reply: '', note: 'Default note' });
  });

  it('refuses a call it cannot place, naming fields but no value, and changes nothing', async () => {
    const t = setup();
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form() }));
    const ref = t.entry().ref;
    for (const args of [[], ['reply'], [1, 'Yes'], ['reply', 'Yes', 'extra']]) {
      expect(error(await t.act(['fill', args]))).toBe(`"fill" on "${ref}" takes a field name and a value.`);
    }
    expect(error(await t.act(['fill', ['other', 'Yes']]))).toBe(`No field "other" on "${ref}". Fields: "reply", "note".`);
    expect(error(await t.act(['fill', ['reply', 42]]))).toBe('The value for "Reply" must be a string.');
    expect(error(await t.act(['fill', ['reply', 'x'.repeat(21)]]))).toBe('"Reply" takes at most 20 characters.');
    expect((await t.act(['fill', ['reply', 'x'.repeat(20)]])).ok).toBe(true);
    expect(t.values(handle)).toEqual({ reply: 'x'.repeat(20), note: 'Default note' });

    const command = admit(t.controller, quiet('undo', { title: 'Undo', action: { kind: 'command', label: 'Undo', run: vi.fn() } }));
    const undo = t.entry('Undo').ref;
    expect(error(await t.agent.act({ steps: [{ ref: undo, action: 'fill', args: ['reply', 'Yes'] }] })))
      .toBe(`"fill" is not available on "${undo}" now. Available: dismiss, show, press.`);
    expect(t.values(command)).toBeUndefined();
  });

  it('refuses while the form is being sent', async () => {
    const t = setup();
    const sending = createDeferred<void>();
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form({ run: () => sending.promise }) }));
    t.type(handle, 'reply', 'Yes');
    expect(t.bridge.invokeAction(t.lease, handle)).toEqual({ status: 'started' });
    expect(t.entry().actions).toEqual(['dismiss', 'show']);
    expect(error(await t.act(['fill', ['note', 'Agent note']]))).toBe('"Send" is already running.');
    expect(t.values(handle)).toEqual({ reply: 'Yes', note: 'Default note' });
    sending.resolve();
  });

  it('never overwrites what the person typed, not even after they cleared it', async () => {
    const t = setup();
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form() }));
    expect((await t.act(['fill', ['reply', 'Agent reply']])).ok).toBe(true);

    expect(t.type(handle, 'reply', 'Person reply')).toEqual({ status: 'applied' });
    expect(t.fields()[0]).toMatchObject({ filled: true, filledBy: 'user' });
    const refused = 'The person typed in "Reply". An agent can\'t overwrite it.';
    expect(error(await t.act(['fill', ['reply', 'Agent again']]))).toBe(refused);
    expect(t.values(handle)?.reply).toBe('Person reply');

    expect(t.type(handle, 'reply', '')).toEqual({ status: 'applied' });
    expect(t.fields()[0]).toMatchObject({ filled: false, filledBy: 'user' });
    expect(error(await t.act(['fill', ['reply', 'Agent again']]))).toBe(refused);
    expect(t.values(handle)?.reply).toBe('');
    // A field the person did not touch stays the agent's.
    expect((await t.act(['fill', ['note', 'Agent note']])).ok).toBe(true);
  });

  it('does not write over a person who typed while the step waited for allow', async () => {
    const answer = createDeferred<boolean>();
    const t = setup({ allow: () => answer.promise });
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form() }));
    const pending = t.act(['fill', ['reply', 'Agent reply']]);
    await Promise.resolve();
    t.type(handle, 'reply', 'Person reply');
    answer.resolve(true);
    expect(error(await pending)).toBe('The person typed in "Reply". An agent can\'t overwrite it.');
    expect(t.values(handle)?.reply).toBe('Person reply');
    expect(t.fields()[0]!.filledBy).toBe('user');
  });

  it('starts again from the defaults when the app replaces the form', async () => {
    const t = setup();
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form() }));
    t.type(handle, 'reply', 'Person reply');
    expect(t.controller.update(handle, { action: form() }).status).toBe('applied');
    expect(t.fields().map((field) => field.filledBy)).toEqual([null, 'app']);
    expect((await t.act(['fill', ['reply', 'Agent reply']])).ok).toBe(true);
  });

  it('makes a draft as typing does, with the draft pause, and an equal default is no draft', async () => {
    const t = setup();
    admit(t.controller, quiet('anna', { title: TITLE, action: form() }));
    expect(t.entry()).toMatchObject({ draft: false });
    expect((await t.act(['fill', ['reply', 'Agent reply']])).ok).toBe(true);
    expect(t.entry().draft).toBe(true);
    expect(t.entry().pauseReasons).toContain('draft');
    expect(t.controller.getSnapshot().notifications[0]!.draft).toBe(true);
    expect((await t.act(['fill', ['reply', '']], ['fill', ['note', 'Default note']])).ok).toBe(true);
    expect(t.entry().draft).toBe(false);
    expect(t.entry().pauseReasons).not.toContain('draft');
  });

  it('fills and reads fields named like Object members as plain own keys', async () => {
    const t = setup();
    const run = vi.fn<(context: FormContext) => void>();
    const handle = admit(t.controller, quiet('odd', { title: TITLE, action: form({ run, agent: 'allow', fields: [
      { name: 'constructor', kind: 'text', label: 'Constructor' },
      { name: 'toString', kind: 'text', label: 'To string', required: true },
      { name: '__proto__', kind: 'text', label: 'Proto' },
    ] }) }));
    expect(t.fields().map((field) => field.filledBy)).toEqual([null, null, null]);
    expect((await t.act(['fill', ['constructor', 'class']], ['fill', ['toString', 'text']])).ok).toBe(true);
    t.type(handle, '__proto__', 'person');
    expect(t.fields().map((field) => field.filledBy)).toEqual(['agent', 'agent', 'user']);
    expect(error(await t.act(['fill', ['__proto__', 'agent']]))).toBe('The person typed in "Proto". An agent can\'t overwrite it.');
    expect(() => structuredClone(t.agent.snapshot())).not.toThrow();

    expect(await t.act(['submit'])).toMatchObject({ ok: true });
    const values = run.mock.calls[0]![0].values;
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
    expect(Object.entries(values)).toEqual([['constructor', 'class'], ['toString', 'text'], ['__proto__', 'person']]);
  });
});

describe('submit', () => {
  it('sends what the agent filled when the person submits', async () => {
    const t = setup();
    const run = vi.fn<(context: FormContext) => void>();
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form({ run }) }));
    expect((await t.act(['fill', ['reply', 'Agent reply']])).ok).toBe(true);
    expect(t.bridge.invokeAction(t.lease, handle)).toEqual({ status: 'started' });
    await flush();
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]![0].values).toEqual({ reply: 'Agent reply', note: 'Default note' });
    expect(closedReasons(t.events)).toEqual(['action-success']);
  });

  it('follows the marker: allow and confirm with a yes send, deny never runs whatever allow says', async () => {
    for (const marker of ['allow', 'confirm', 'deny'] as const) {
      for (const answer of [undefined, true, false]) {
        // Every fill is approved; the answer is about the submit.
        const allow = answer === undefined ? undefined : vi.fn<Allow>((step) => step.action === 'fill' || answer);
        const t = setup(allow ? { allow } : {});
        const run = vi.fn<(context: FormContext) => void>();
        admit(t.controller, quiet('anna', { title: TITLE, action: form({ run, agent: marker }) }));
        expect((await t.act(['fill', ['reply', 'Yes']])).ok).toBe(true);
        const ref = t.entry().ref;
        const result = await t.act(['submit']);
        const sent = marker === 'allow' ? answer !== false : marker === 'confirm' && answer === true;
        if (sent) {
          expect(result).toEqual({ ok: true, steps: [{ step: 0, ref, gone: true }] });
          expect(run).toHaveBeenCalledOnce();
          expect(closedReasons(t.events)).toEqual(['action-success']);
          continue;
        }
        expect(run).not.toHaveBeenCalled();
        const message = error(result);
        if (marker === 'deny') {
          expect(message).toBe(`Not allowed: the app does not let an agent submit "Send" on "${TITLE}". Look for no other way.`);
          expect(allow?.mock.calls.filter(([step]) => step.action === 'submit') ?? []).toEqual([]);
        } else if (marker === 'allow') {
          expect(message).toBe(`The app said no to "submit" on "${ref}".`);
        } else {
          expect(message).toBe(`Needs a person: "Send" on "${TITLE}". The Island is open on it. Ask them to submit "Send" themselves.`);
          if (allow) expect(allow.mock.calls.at(-1)?.[0]).toMatchObject({ action: 'submit', needsPerson: true });
        }
        expect(t.controller.getSnapshot().notifications).toHaveLength(1);
      }
    }
  });

  it('a marker made stricter while the step waited stops it', async () => {
    const answer = createDeferred<boolean>();
    const t = setup({ allow: () => answer.promise });
    const run = vi.fn();
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form({ run, agent: 'confirm', fields: [{ name: 'reply', kind: 'text', label: 'Reply' }] }) }));
    const ref = t.entry().ref;
    const pending = t.act(['submit']);
    await Promise.resolve();
    expect(t.controller.update(handle, { action: form({ run, agent: 'deny' }) }).status).toBe('applied');
    answer.resolve(true);
    expect(error(await pending)).toBe(`"submit" on "${ref}" changed while it waited, so it did not run. Read the snapshot and try again.`);
    expect(run).not.toHaveBeenCalled();
  });

  it('a form that fails its checks is not sent; the person and the agent get the messages', async () => {
    const t = setup({ allow: () => true });
    const run = vi.fn();
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form({ run }) }));
    expect(error(await t.act(['submit']))).toBe('"Send" was not sent. "Reply": This field is required.');
    expect(run).not.toHaveBeenCalled();
    expect(t.bridge.getSnapshot().forms[0]!.errors).toEqual({ form: null, fields: { reply: 'This field is required' } });
    expect(t.fields()[0]!.error).toBe('This field is required');
    // An agent's value clears the field's message, as typing does.
    expect((await t.act(['fill', ['reply', 'Yes']])).ok).toBe(true);
    expect(t.fields()[0]!.error).toBeNull();
    expect(t.values(handle)?.reply).toBe('Yes');
  });

  it("names the fields the form's own validate did not accept, without its text", async () => {
    const t = setup({ allow: () => true });
    let verdict: true | string | Record<string, string> = 'Try again later';
    admit(t.controller, quiet('anna', { title: TITLE, action: form({ validate: () => verdict }) }));
    expect((await t.act(['fill', ['reply', 'Yes']])).ok).toBe(true);
    expect(error(await t.act(['submit']))).toBe('"Send" was not sent. The form\'s own check did not accept it.');
    expect(t.entry().action).toMatchObject({ error: "Not accepted by the form's own check" });
    verdict = { note: 'Too vague!', reply: 'Say more' };
    expect(error(await t.act(['submit']))).toBe('"Send" was not sent. The form\'s own check did not accept "Reply", "Note".');
    expect(t.fields().map((field) => field.error)).toEqual(["Not accepted by the form's own check", "Not accepted by the form's own check"]);
    expect(t.entry().action).toMatchObject({ error: null });
  });

  it("keeps the other field's message from validate out of the snapshot after the person edits one", async () => {
    const t = setup({ allow: () => true });
    const TYPED = 'PERSON-TYPED-9K';
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form({
      validate: (values) => ({ reply: 'Say more', note: `"${values.note}" is too vague` }),
    }) }));
    t.type(handle, 'reply', 'Yes');
    t.type(handle, 'note', TYPED);
    expect((await t.act(['submit'])).ok).toBe(false);
    t.type(handle, 'reply', 'Yes, at five');
    expect(t.fields().map((field) => field.error)).toEqual([null, "Not accepted by the form's own check"]);
    expect(JSON.stringify(t.agent.snapshot())).not.toContain(TYPED);
  });

  it('keeps a built-in message as it is after the person edits another field', async () => {
    const t = setup({ allow: () => true });
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form({
      fields: [{ name: 'reply', kind: 'text', label: 'Reply', required: true }, { name: 'note', kind: 'text', label: 'Note', required: true }],
    }) }));
    expect((await t.act(['submit'])).ok).toBe(false);
    t.type(handle, 'reply', 'Yes');
    expect(t.fields().map((field) => field.error)).toEqual([null, 'This field is required']);
  });

  it('keeps what the person typed out of the result and the snapshot when the app quotes it', async () => {
    const t = setup({ allow: () => true });
    const TYPED = 'PERSON-TYPED-7Q';
    let fails = false;
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form({
      validate: (values) => fails ? true : { reply: `"${values.reply}" is not a time` },
      run: (context) => Promise.reject(new Error(context.values.reply)),
      errorMessage: (reason) => `Could not send ${(reason as Error).message}`,
    }) }));
    t.bridge.openIsland(t.lease, 'user', handle);
    t.type(handle, 'reply', TYPED);
    const seen: unknown[] = [await t.act(['submit']), t.agent.snapshot()];
    expect(t.bridge.getSnapshot().forms.find((item) => item.handle === handle)?.errors.fields.reply).toBe(`"${TYPED}" is not a time`);
    fails = true;
    seen.push(await t.act(['submit']), t.agent.snapshot());
    expect(error(seen[2] as never)).toBe('"Send" failed: Action failed');
    expect(t.entry().action).toMatchObject({ status: 'failed', message: 'Action failed' });
    expect(t.controller.getSnapshot().notifications.find((item) => item.handle === handle)?.action).toMatchObject({ message: `Could not send ${TYPED}` });
    expect(JSON.stringify(seen)).not.toContain(TYPED);
  });

  it("a failed run says so without the app's own message", async () => {
    const t = setup({ allow: () => true });
    admit(t.controller, quiet('anna', { title: TITLE, action: form({
      run: () => Promise.reject(new Error('raw failure')), errorMessage: () => 'Server said no',
    }) }));
    expect((await t.act(['fill', ['reply', 'Yes']])).ok).toBe(true);
    expect(error(await t.act(['submit']))).toBe('"Send" failed: Action failed');
    expect(t.entry().action).toMatchObject({ status: 'failed', message: 'Action failed' });
    expect(t.entry().actions).toContain('submit');
  });

  it("says Action failed, not the app's configured message, when validate breaks", async () => {
    const t = setup({ allow: () => true }, { messages: { actionError: 'Nicht gesendet' } });
    let verdict: unknown = false;
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form({ validate: () => { if (verdict === 'throw') throw new Error('boom'); return verdict as never; } }) }));
    expect((await t.act(['fill', ['reply', 'Yes']])).ok).toBe(true);
    for (const next of [false, 'throw']) {
      verdict = next;
      expect(error(await t.act(['submit']))).toBe('"Send" was not sent. Action failed.');
      expect(t.entry().action).toMatchObject({ error: 'Action failed' });
      expect(t.bridge.getSnapshot().forms.find((item) => item.handle === handle)?.errors.form).toBe('Nicht gesendet');
      expect(JSON.stringify(t.agent.snapshot())).not.toContain('Nicht gesendet');
    }
  });

  it('a submit already running is refused', async () => {
    const t = setup({ allow: () => true });
    const sending = createDeferred<void>();
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form({ run: () => sending.promise }) }));
    t.type(handle, 'reply', 'Yes');
    t.bridge.invokeAction(t.lease, handle);
    expect(error(await t.act(['submit']))).toBe('"Send" is already running.');
    sending.resolve();
  });

  it('a submit approved for one form does not send the form the app put in its place meanwhile', async () => {
    const answer = createDeferred<boolean>();
    const t = setup({ allow: (step) => step.action !== 'submit' || answer.promise });
    const approved = form();
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: approved }));
    const pending = t.act(['submit']);
    await Promise.resolve();
    const replacement = form({ label: 'Delete account', agent: 'allow', fields: [{ name: 'reply', kind: 'text', label: 'Reply' }] });
    expect(t.controller.update(handle, { action: replacement }).status).toBe('applied');
    answer.resolve(true);
    expect(error(await pending)).toMatch(/changed while it waited, so it did not run/);
    expect(approved.run).not.toHaveBeenCalled();
    expect(replacement.run).not.toHaveBeenCalled();
  });

  it('a submit runs neither form when the form\'s own validate replaces the action', async () => {
    const t = setup({ allow: () => true });
    const replacement = form({ label: 'Delete account', agent: 'allow' });
    let handle!: NotificationHandle;
    const approved = form({ validate: () => { t.controller.update(handle, { action: replacement }); return true; } });
    handle = admit(t.controller, quiet('anna', { title: TITLE, action: approved }));
    t.type(handle, 'reply', 'Yes');
    expect(error(await t.act(['submit']))).toMatch(/changed while it waited, so it did not run/);
    expect(approved.run).not.toHaveBeenCalled();
    expect(replacement.run).not.toHaveBeenCalled();
    expect(t.entry().action).toMatchObject({ label: 'Delete account', status: 'idle' });
  });

  it('a person\'s submit runs neither form in the same case', () => {
    const t = setup();
    const replacement = form({ label: 'Delete account' });
    let handle!: NotificationHandle;
    const pressed = form({ validate: () => { t.controller.update(handle, { action: replacement }); return true; } });
    handle = admit(t.controller, quiet('anna', { title: TITLE, action: pressed }));
    t.type(handle, 'reply', 'Yes');
    expect(t.bridge.invokeAction(t.lease, handle)).toEqual({ status: 'rejected', reason: 'action-replaced' });
    expect(pressed.run).not.toHaveBeenCalled();
    expect(replacement.run).not.toHaveBeenCalled();
  });

  it('a successful submit closes the notification and its draft with it', async () => {
    const t = setup({ allow: () => true });
    const run = vi.fn<(context: FormContext) => void>();
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form({ run }) }));
    t.bridge.openIsland(t.lease, 'user', handle);
    const result = await t.act(['fill', ['reply', 'Agent reply']], ['submit']);
    expect(result).toEqual({ ok: true, steps: [{ step: 0, ref: expect.any(String) }, { step: 1, ref: expect.any(String), gone: true }] });
    expect(run.mock.calls[0]![0].values).toEqual({ reply: 'Agent reply', note: 'Default note' });
    expect(t.controller.getSnapshot().notifications).toEqual([]);
    expect(t.bridge.getSnapshot().forms).toEqual([]);
    expect(t.controller.getSnapshot().island.open).toBe(false);
    expect(t.focusRequests).toEqual([]);
  });

  it('a long run leaves the step pending at the timeout', async () => {
    vi.useFakeTimers();
    const t = setup({ allow: () => true, timeout: 1_000 });
    const sending = createDeferred<void>();
    admit(t.controller, quiet('anna', { title: TITLE, action: form({ run: () => sending.promise }) }));
    const ref = t.entry().ref;
    const result = t.act(['fill', ['reply', 'Yes']], ['submit']);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toEqual({ ok: true, steps: [{ step: 0, ref }, { step: 1, ref, result: 'pending' }] });
    expect(t.entry().action).toMatchObject({ status: 'pending' });
    sending.resolve();
  });
});

describe('the agent draft in the open Island', () => {
  // The agent's value makes a draft like the person's: it holds the open Island as a person's
  // draft does, so steps that would move the Island wait for the person or are refused.
  it('fill, fill and submit in one call run in the open Island', async () => {
    const t = setup();
    const run = vi.fn<(context: FormContext) => void>();
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form({ run, agent: 'allow' }) }));
    t.bridge.openIsland(t.lease, 'user', handle);
    const result = await t.act(['fill', ['reply', 'Agent reply']], ['fill', ['note', 'Agent note']], ['submit']);
    expect(result).toMatchObject({ ok: true, steps: [{ step: 0 }, { step: 1 }, { step: 2, gone: true }] });
    expect(run.mock.calls[0]![0].values).toEqual({ reply: 'Agent reply', note: 'Agent note' });
  });

  it('a submit that needs a person after the agent filled the open form says the Island is open on it', async () => {
    const t = setup({ allow: (step) => step.action === 'fill' });
    const run = vi.fn();
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form({ run }) }));
    t.bridge.openIsland(t.lease, 'user', handle);
    const result = await t.act(['fill', ['reply', 'Agent reply']], ['submit']);
    expect(error(result)).toBe(`Needs a person: "Send" on "${TITLE}". The Island is open on it. Ask them to submit "Send" themselves. Step 0 stayed done.`);
    expect(result.steps).toEqual([{ step: 0, ref: t.entry().ref }]);
    expect(run).not.toHaveBeenCalled();
    expect(t.controller.getSnapshot().island).toEqual({ open: true, reason: 'user', current: handle, source: 'user' });
    expect(t.values(handle)?.reply).toBe('Agent reply');
    expect(t.focusRequests).toEqual([]);
  });

  it('a submit that needs a person opens a closed Island on the form the agent filled', async () => {
    const t = setup();
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form() }));
    const result = await t.act(['fill', ['reply', 'Agent reply']], ['submit']);
    expect(error(result)).toBe(`Needs a person: "Send" on "${TITLE}". The Island is open on it. Ask them to submit "Send" themselves. Step 0 stayed done.`);
    expect(t.controller.getSnapshot().island).toEqual({ open: true, reason: 'attention', current: handle, source: 'agent' });
    expect(t.focusRequests).toEqual([]);
  });

  it('counts as the person using the Island for the steps that would move it', async () => {
    const t = setup();
    admit(t.controller, quiet('other', { title: 'Other', action: { kind: 'command', label: 'Undo', run: vi.fn() } }));
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form() }));
    t.bridge.openIsland(t.lease, 'user', handle);
    expect((await t.act(['fill', ['reply', 'Agent reply']])).ok).toBe(true);
    const busy = 'The person is using the Island. Try again later.';
    expect(error(await t.agent.act({ steps: [{ ref: t.entry('Other').ref, action: 'show' }] }))).toBe(busy);
    expect(error(await t.agent.act({ steps: [{ ref: 'toaster', action: 'close' }] }))).toBe(busy);
    expect(error(await t.agent.act({ steps: [{ ref: t.entry('Other').ref, action: 'press' }] })))
      .toBe('Needs a person: "Undo" on "Other". The Island will open on it once they stop using it. Ask them to press "Undo" themselves.');
    expect(t.controller.getSnapshot().island.current).toBe(handle);
  });
});

describe("the person's values stay inside Cloudlet", () => {
  const SECRET = 'SECRET-person-9d41';

  it('never appear in a snapshot, a result or an error', async () => {
    const outputs: unknown[] = [];
    const seen = (value: unknown) => { outputs.push(value); return value; };
    const run = vi.fn<(context: FormContext) => unknown>(() => Promise.reject(new Error(SECRET)));
    let verdict: true | Record<string, string> = { note: 'Pick another note' };
    const allow = vi.fn<Allow>(() => true);
    const t = setup({ allow });
    const handle = admit(t.controller, quiet('anna', { title: TITLE, action: form({ run, validate: () => verdict }) }));
    const plain = admit(t.controller, quiet('plain', { title: 'Plain', action: form({ agent: 'confirm' }) }));
    t.bridge.openIsland(t.lease, 'user', handle);
    t.type(handle, 'reply', SECRET);
    t.type(plain, 'reply', SECRET);
    t.type(plain, 'note', '');
    seen(t.agent.snapshot());

    // A fill over the person's field, one too long for it, an unknown field, a fill that fits.
    seen(await t.act(['fill', ['reply', 'Agent']]));
    seen(await t.act(['fill', ['reply', 'x'.repeat(200)]]));
    seen(await t.act(['fill', ['nope', 'Agent']]));
    seen(await t.act(['fill', ['note', 'Agent note']]));
    // A form that fails validate, then one that fails to run.
    seen(await t.act(['submit']));
    seen(t.agent.snapshot());
    verdict = true;
    seen(await t.act(['submit']));
    seen(t.agent.snapshot());
    // A submit that needs a person while the person holds the Island, and a fill over their field.
    const otherRef = t.entry('Plain').ref;
    allow.mockReturnValue(false);
    seen(await t.agent.act({ steps: [{ ref: otherRef, action: 'submit' }] }));
    seen(await t.agent.act({ steps: [{ ref: otherRef, action: 'fill', args: ['reply', 'Agent'] }] }));
    seen(t.agent.snapshot());

    expect(run).toHaveBeenCalled();
    expect(run.mock.calls[0]![0].values.reply).toBe(SECRET);
    expect(outputs.length).toBeGreaterThan(8);
    for (const output of outputs) expect(JSON.stringify(output)).not.toContain(SECRET);
    expect(JSON.stringify(outputs)).toContain('was not sent');
    expect(JSON.stringify(outputs)).toContain('failed: Action failed');
    expect(JSON.stringify(outputs)).toContain('The person typed in');
  });
});
