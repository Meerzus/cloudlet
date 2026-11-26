import type { ActionAttemptToken, NotificationHandle } from '../contracts/identity.js';
import type { FormErrors } from '../contracts/internal.js';
import { NO_FORM_ERRORS, UNCHANGED, reject, type ControllerKernel, type FieldAuthor, type FormState, type RecordState } from './controller.js';

// Running a notification's action and editing its form, shared by every caller that may act on a
// record. Callers check their own capability (a host lease, say) and resolve the record first;
// these functions own the order of the remaining checks, the rejections, events and diagnostics.
// The controller never imports this module, so it stays out of the start bundle.
const freeze = Object.freeze;

/** `required` and `maxLength` first, then the form's own `validate`; null lets the submit run. */
export function checkForm<Slot>(k: ControllerKernel<Slot>, form: FormState, handle: NotificationHandle): FormErrors | null {
  const messages = k.options.messages;
  // Own keys only, read and written: a field named `constructor` must not meet `Object.prototype`,
  // and one named `__proto__` must keep its message (an assignment would set the prototype).
  const entries: [string, string][] = [];
  for (const field of form.action.fields) {
    const value = Object.hasOwn(form.values, field.name) ? form.values[field.name]! : '';
    if (field.required && !value.trim()) entries.push([field.name, messages?.fieldRequired ?? 'This field is required']);
    else if (field.maxLength !== undefined && value.length > field.maxLength) entries.push([field.name, messages?.fieldTooLong ?? 'This text is too long']);
  }
  if (entries.length) return freeze({ form: null, fields: freeze(Object.fromEntries(entries)) });
  if (!form.action.validate) return null;
  let result: unknown;
  try {
    result = form.action.validate(form.values);
  } catch (error) {
    k.failure('callback-error', 'action.validate', error, handle);
    return freeze({ form: messages?.actionError ?? 'Action failed', fields: freeze({}) });
  }
  if (result === true) return null;
  if (typeof result === 'string' && result.trim()) return freeze({ form: result, fields: freeze({}) });
  const names = form.action.fields.map((field) => field.name);
  if (result !== null && typeof result === 'object' && Object.getPrototypeOf(result) === Object.prototype &&
      Object.entries(result).every(([name, message]) => names.includes(name) && typeof message === 'string' && message.trim())) {
    return Object.keys(result).length ? freeze({ form: null, fields: freeze({ ...result as Record<string, string> }) }) : null;
  }
  k.diagnostic({ code: 'callback-error', source: 'action.validate', handle,
    message: 'validate must return true, a message, or messages keyed by field name' });
  return freeze({ form: messages?.actionError ?? 'Action failed', fields: freeze({}) });
}

/** Starts a command action or submits a form; an invalid form records its errors and does not run. */
export function invokeAction<Slot>(k: ControllerKernel<Slot>, record: RecordState<Slot>) {
  const handle = record.handle;
  const action = record.content.action;
  if (!action || action.kind === 'link') return reject('no-command');
  if (record.action.status === 'pending') return reject('already-pending');
  const form = k.formOf(record);
  if (form) {
    const errors = checkForm(k, form, handle);
    if (errors) {
      k.mutate(() => { form.errors = errors; });
      return { status: 'invalid' as const, errors };
    }
    // `validate` is the app's code and may have replaced the action it was checking: the press was
    // for the one that is gone, so neither runs.
    if (k.records.get(handle.id) !== record || record.content.action !== action) return reject('action-replaced');
  }
  const actionToken = k.token() as ActionAttemptToken;
  const live = () => !k.disposed && k.records.get(handle.id) === record &&
    record.action.status === 'pending' && record.action.token === actionToken;
  const now = k.settle();
  record.action = freeze({ status: 'pending', token: actionToken });
  if (form) form.errors = NO_FORM_ERRORS;
  k.commit([{ type: 'action-started', handle, token: actionToken }], now);
  function failed(reason: unknown): void {
    if (!live()) return;
    let message = k.options.messages?.actionError ?? 'Action failed';
    if (action && action.kind !== 'link' && action.errorMessage) {
      try {
        const mapped = action.errorMessage(reason);
        if (typeof mapped !== 'string' || !mapped.trim()) throw new TypeError('Invalid action error message');
        message = mapped;
      } catch (error) {
        if (!k.disposed) k.failure('mapper-error', 'action.errorMessage', error, handle);
      }
    }
    if (!live()) return;
    const now = k.settle();
    record.action = freeze({ status: 'failed', token: actionToken, message });
    k.commit([{ type: 'action-failed', handle, token: actionToken, message }], now);
  }
  let result: Promise<unknown>;
  try {
    result = Promise.resolve(form ? form.action.run(freeze({ handle, token: actionToken, values: form.values }))
      : action.kind === 'command' ? action.run(freeze({ handle, token: actionToken })) : undefined);
  }
  catch (error) { result = Promise.reject(error); }
  void result.then(() => {
    if (live()) k.dismiss(handle, 'action-success');
  }, failed).catch((error: unknown) => {
    if (!k.disposed) k.failure('callback-error', 'action-settlement', error, handle);
  });
  return { status: 'started' as const, token: actionToken };
}

/** Writes one field of the record's form as the person; editing a field clears its own message. */
export function setFormValue<Slot>(k: ControllerKernel<Slot>, record: RecordState<Slot>, name: string, value: string) {
  const target = fieldOf(k, record, name, value);
  return 'status' in target ? target : write(k, target.form, name, value, 'user');
}

/**
 * Writes one field as an agent. Its value must fit `maxLength`, and it never replaces what the
 * person typed, not even text they have since deleted.
 */
export function fillFormValue<Slot>(k: ControllerKernel<Slot>, record: RecordState<Slot>, name: string, value: string) {
  const target = fieldOf(k, record, name, value);
  if ('status' in target) return target;
  const { form, field } = target;
  if (field.maxLength !== undefined && value.length > field.maxLength) return reject('too-long');
  // Own keys only: a field named `constructor` must not read `Object.prototype`.
  if (Object.hasOwn(form.authors, name) && form.authors[name] === 'user') return reject('person-typed');
  return write(k, form, name, value, 'agent');
}

function fieldOf<Slot>(k: ControllerKernel<Slot>, record: RecordState<Slot>, name: string, value: string) {
  const form = k.formOf(record);
  if (!form) return reject('no-form');
  const field = form.action.fields.find((item) => item.name === name);
  if (typeof value !== 'string' || !field) return reject('invalid-input');
  if (record.action.status === 'pending') return reject('already-pending');
  return { form, field };
}

function write<Slot>(k: ControllerKernel<Slot>, form: FormState, name: string, value: string, author: FieldAuthor) {
  // The same text again changes nothing, its author included.
  if (Object.hasOwn(form.values, name) && form.values[name] === value) return UNCHANGED;
  return k.mutate(() => {
    // Spreads and computed keys define own properties, so `__proto__` stays a field here too.
    form.authors = freeze({ ...form.authors, [name]: author });
    form.values = freeze({ ...form.values, [name]: value });
    // Editing a field clears its own message; the rest wait for the next submit.
    if (Object.hasOwn(form.errors.fields, name)) {
      const { [name]: _, ...fields } = form.errors.fields;
      form.errors = freeze({ form: form.errors.form, fields: freeze(fields) });
    }
  });
}
