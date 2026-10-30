import { describe, expect, it, vi } from 'vitest';
import type { Diagnostic } from '../../packages/toast/src/contracts/events.js';
import type { FormAction, FormContext, NotificationSpec } from '../../packages/toast/src/contracts/notifications.js';
import { admit, attach, harness, record } from '../support/controller-harness.js';
import { createDeferred } from '../support/deferred.js';

async function flushActions(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

const reply = (extra: Partial<FormAction> = {}): FormAction => ({
  kind: 'form', label: 'Send', run: vi.fn(),
  fields: [{ name: 'reply', kind: 'text', label: 'Reply', required: true, maxLength: 20 }],
  ...extra,
});
const spec = (extra: Partial<NotificationSpec<unknown>> = {}): NotificationSpec<unknown> =>
  ({ id: 'anna', title: 'Anna: are you coming?', action: reply(), ...extra });
const draftOf = (bridge: ReturnType<typeof harness>['bridge'], id: string) =>
  bridge.getSnapshot().forms.find((form) => form.handle.id === id);

describe('form action validation', () => {
  it('accepts one to three text and textarea fields with the optional field settings', () => {
    const { controller } = harness();
    const result = controller.show({ title: 'Feedback', action: {
      kind: 'form', label: 'Send', run: () => undefined, errorMessage: () => 'Not sent', validate: () => true,
      fields: [
        { name: 'name', kind: 'text', label: 'Name', placeholder: 'Your name', defaultValue: 'Ann', maxLength: 40, autoComplete: 'name', inputMode: 'text' },
        { name: 'email', kind: 'text', label: 'Email', required: true, inputMode: 'email' },
        { name: 'note', kind: 'textarea', label: 'Note' },
      ],
    } });
    expect(result.status).toBe('created');
  });

  it.each<[string, unknown, string]>([
    ['no fields', { fields: [] }, 'action.fields'],
    ['four fields', { fields: ['a', 'b', 'c', 'd'].map((name) => ({ name, kind: 'text', label: name })) }, 'action.fields'],
    ['duplicate names', { fields: [{ name: 'a', kind: 'text', label: 'A' }, { name: 'a', kind: 'textarea', label: 'B' }] }, 'action.fields.1.name'],
    ['an unknown field kind', { fields: [{ name: 'a', kind: 'select', label: 'A' }] }, 'action.fields.0.kind'],
    ['an empty label', { fields: [{ name: 'a', kind: 'text', label: ' ' }] }, 'action.fields.0.label'],
    ['a fractional maxLength', { fields: [{ name: 'a', kind: 'text', label: 'A', maxLength: 2.5 }] }, 'action.fields.0.maxLength'],
    ['a default longer than maxLength', { fields: [{ name: 'a', kind: 'text', label: 'A', maxLength: 2, defaultValue: 'abc' }] }, 'action.fields.0.defaultValue'],
    ['an unknown input mode', { fields: [{ name: 'a', kind: 'text', label: 'A', inputMode: 'none' }] }, 'action.fields.0.inputMode'],
    ['an unknown field setting', { fields: [{ name: 'a', kind: 'text', label: 'A', rows: 3 }] }, 'action.fields.0.rows'],
    ['a missing button label', { label: '' }, 'action.label'],
    ['an href on the form', { href: '/reply' }, 'action.href'],
    ['a non-function validate', { validate: true }, 'action.validate'],
  ])('rejects %s', (_label, change, path) => {
    const { controller } = harness();
    const result = controller.show({ title: 'Form', action: { ...reply(), ...change as object } as FormAction });
    expect(result.status).toBe('rejected');
    expect(result.status === 'rejected' && result.issues?.map((issue) => issue.path)).toContain(path);
  });

  it('rejects form fields on a command action', () => {
    const { controller } = harness();
    const result = controller.show({ title: 'Undo', action: { kind: 'command', label: 'Undo', run: vi.fn(), fields: [] } as never });
    expect(result.status === 'rejected' && result.issues?.map((issue) => issue.path)).toContain('action.fields');
  });
});

describe('form drafts', () => {
  it('starts from the defaults, reports draft only when a value differs, and pauses the timer meanwhile', () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const handle = admit(controller, spec({ duration: 1_000, action: reply({ fields: [
      { name: 'reply', kind: 'text', label: 'Reply', defaultValue: 'Yes' },
    ] }) }));
    expect(record(controller, handle).draft).toBe(false);
    expect(draftOf(bridge, 'anna')?.values).toEqual({ reply: 'Yes' });

    expect(bridge.setFormValue(lease, handle, 'reply', 'Yes, at eight')).toEqual({ status: 'applied' });
    expect(record(controller, handle)).toMatchObject({ draft: true });
    expect(record(controller, handle).pauseReasons).toContain('draft');
    expect(draftOf(bridge, 'anna')?.values).toEqual({ reply: 'Yes, at eight' });
    clock.advanceBy(5_000);
    expect(controller.getHandle('anna')).toBe(handle);

    expect(bridge.setFormValue(lease, handle, 'reply', 'Yes')).toEqual({ status: 'applied' });
    expect(record(controller, handle).draft).toBe(false);
    expect(record(controller, handle).pauseReasons).not.toContain('draft');
  });

  it('keeps the draft across content patches and starts over when the action changes', () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const handle = admit(controller, spec());
    bridge.setFormValue(lease, handle, 'reply', 'Late');
    expect(controller.update(handle, { title: 'Anna (2)' }).status).toBe('applied');
    expect(draftOf(bridge, 'anna')?.values).toEqual({ reply: 'Late' });
    expect(controller.update(handle, { action: reply() }).status).toBe('applied');
    expect(draftOf(bridge, 'anna')?.values).toEqual({ reply: '' });
    expect(controller.update(handle, { action: null }).status).toBe('applied');
    expect(draftOf(bridge, 'anna')).toBeUndefined();
    expect(record(controller, handle).draft).toBe(false);
  });

  it('rejects values for records without a form, unknown fields, non-strings and pending submits', async () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const plain = admit(controller, { id: 'plain', title: 'Plain' });
    const pending = createDeferred<void>();
    const handle = admit(controller, spec({ action: reply({ run: () => pending.promise }) }));
    expect(bridge.setFormValue(lease, plain, 'reply', 'x')).toEqual({ status: 'rejected', reason: 'no-form' });
    expect(bridge.setFormValue(lease, handle, 'other', 'x')).toEqual({ status: 'rejected', reason: 'invalid-input' });
    expect(bridge.setFormValue(lease, handle, 'reply', 1 as never)).toEqual({ status: 'rejected', reason: 'invalid-input' });
    expect(bridge.setFormValue(lease, handle, 'reply', '')).toEqual({ status: 'unchanged' });
    bridge.setFormValue(lease, handle, 'reply', 'Yes');
    expect(bridge.invokeAction(lease, handle)).toEqual({ status: 'started' });
    expect(bridge.setFormValue(lease, handle, 'reply', 'No')).toEqual({ status: 'rejected', reason: 'already-pending' });
    expect(controller.update(handle, { action: null })).toEqual({ status: 'rejected', reason: 'action-pending' });
    pending.resolve();
    await flushActions();
  });

  it('keeps an open Island with a draft from being switched by attention, then lets the candidate in', () => {
    const { controller, bridge, clock } = harness();
    const lease = attach(bridge);
    const form = admit(controller, spec({ attention: 'stack' }));
    bridge.openIsland(lease, 'user', form);
    bridge.setFormValue(lease, form, 'reply', 'Typing');
    const urgent = admit(controller, { id: 'urgent', title: 'Server down', attention: 'open' });
    clock.advanceBy(5_000);
    expect(controller.getSnapshot().island.current).toBe(form);
    bridge.setFormValue(lease, form, 'reply', '');
    clock.advanceBy(600);
    expect(controller.getSnapshot().island.current).toBe(urgent);
  });
});

describe('form submits', () => {
  it('checks required and maxLength before running, and editing a field clears its message', () => {
    const run = vi.fn();
    const { controller, bridge } = harness({ messages: { fieldRequired: 'Write a reply', fieldTooLong: 'Shorter, please' } });
    const lease = attach(bridge);
    const handle = admit(controller, spec({ action: reply({ run }) }));
    const empty = bridge.invokeAction(lease, handle);
    expect(empty).toEqual({ status: 'invalid', errors: { form: null, fields: { reply: 'Write a reply' } } });
    expect(draftOf(bridge, 'anna')?.errors).toEqual({ form: null, fields: { reply: 'Write a reply' } });
    bridge.setFormValue(lease, handle, 'reply', '   ');
    expect(draftOf(bridge, 'anna')?.errors.fields).toEqual({});
    expect(bridge.invokeAction(lease, handle)).toMatchObject({ status: 'invalid', errors: { fields: { reply: 'Write a reply' } } });
    bridge.setFormValue(lease, handle, 'reply', 'x'.repeat(21));
    expect(bridge.invokeAction(lease, handle)).toMatchObject({ status: 'invalid', errors: { fields: { reply: 'Shorter, please' } } });
    expect(run).not.toHaveBeenCalled();
    expect(record(controller, handle).action).toEqual({ status: 'idle' });
  });

  it.each<[string, unknown, { form: string | null; fields: Record<string, string> } | null]>([
    ['true', true, null],
    ['an empty object', {}, null],
    ['a message', 'Pick a time first', { form: 'Pick a time first', fields: {} }],
    ['field messages', { reply: 'Say more' }, { form: null, fields: { reply: 'Say more' } }],
  ])('treats validate returning %s', (_label, returned, errors) => {
    const run = vi.fn();
    const validate = vi.fn(() => returned as never);
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const handle = admit(controller, spec({ action: reply({ run, validate }) }));
    bridge.setFormValue(lease, handle, 'reply', 'Yes');
    const result = bridge.invokeAction(lease, handle);
    expect(validate).toHaveBeenCalledWith({ reply: 'Yes' });
    if (errors) {
      expect(result).toEqual({ status: 'invalid', errors });
      expect(run).not.toHaveBeenCalled();
    } else {
      expect(result).toEqual({ status: 'started' });
      expect(run).toHaveBeenCalledTimes(1);
    }
  });

  it.each<[string, () => unknown]>([
    ['throws', () => { throw new Error('boom'); }],
    ['returns an unknown field', () => ({ other: 'No' })],
    ['returns false', () => false],
  ])('blocks the submit and reports a diagnostic when validate %s', (_label, validate) => {
    const diagnostics: Diagnostic[] = [];
    const run = vi.fn();
    const { controller, bridge } = harness({ onDiagnostic: (diagnostic) => diagnostics.push(diagnostic), messages: { actionError: 'Not sent' } });
    const lease = attach(bridge);
    const handle = admit(controller, spec({ action: reply({ run, validate: validate as never }) }));
    bridge.setFormValue(lease, handle, 'reply', 'Yes');
    expect(bridge.invokeAction(lease, handle)).toEqual({ status: 'invalid', errors: { form: 'Not sent', fields: {} } });
    expect(run).not.toHaveBeenCalled();
    return Promise.resolve().then(() => {
      expect(diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.source])).toEqual([['callback-error', 'action.validate']]);
    });
  });

  it('runs with the values, closes on success and keeps the values after a failure', async () => {
    const attempts = [createDeferred<void>(), createDeferred<void>()];
    const contexts: FormContext[] = [];
    const run = vi.fn((context: FormContext) => attempts[contexts.push(context) - 1]!.promise);
    const closed = vi.fn();
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const handle = admit(controller, spec({ onClose: closed, action: reply({ run, errorMessage: () => 'Could not send' }) }));
    bridge.setFormValue(lease, handle, 'reply', 'On my way');
    expect(bridge.invokeAction(lease, handle)).toEqual({ status: 'started' });
    expect(contexts[0]).toMatchObject({ handle, values: { reply: 'On my way' } });
    expect(Object.isFrozen(contexts[0]!.values)).toBe(true);
    expect(record(controller, handle).pauseReasons).toContain('action-pending');

    attempts[0]!.reject(new Error('offline'));
    await flushActions();
    expect(record(controller, handle).action).toMatchObject({ status: 'failed', message: 'Could not send' });
    expect(draftOf(bridge, 'anna')?.values).toEqual({ reply: 'On my way' });
    expect(record(controller, handle).draft).toBe(true);

    expect(bridge.invokeAction(lease, handle)).toEqual({ status: 'started' });
    attempts[1]!.resolve();
    await flushActions();
    expect(controller.getHandle('anna')).toBeUndefined();
    expect(closed).toHaveBeenCalledWith({ handle, reason: 'action-success' });
    expect(bridge.getSnapshot().forms).toEqual([]);
  });

  it('clears the previous messages when a valid submit starts', () => {
    const { controller, bridge } = harness();
    const lease = attach(bridge);
    const handle = admit(controller, spec({ action: reply({ run: () => new Promise(() => undefined), validate: (values) => values.reply === 'ok' || 'Type ok' }) }));
    bridge.setFormValue(lease, handle, 'reply', 'no');
    expect(bridge.invokeAction(lease, handle)).toMatchObject({ status: 'invalid', errors: { form: 'Type ok' } });
    bridge.setFormValue(lease, handle, 'reply', 'ok');
    expect(draftOf(bridge, 'anna')?.errors.form).toBe('Type ok');
    expect(bridge.invokeAction(lease, handle)).toEqual({ status: 'started' });
    expect(draftOf(bridge, 'anna')?.errors).toEqual({ form: null, fields: {} });
  });
});
