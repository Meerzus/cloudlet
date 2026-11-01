import type { Diagnostic } from '../contracts/events.js';
import type { ActionAttemptToken, NotificationHandle, OperationAttemptToken } from '../contracts/identity.js';
import type {
  AnnouncementAcknowledgement, BridgeRejection, BridgeResult, FocusRequestToken, FormErrors, HostLease, HostOptions, PauseChange,
  PresentationToken, RendererBridge,
} from '../contracts/internal.js';
import type { CancellationSignal } from '../contracts/operations.js';
import type { CloudletController } from '../contracts/controller.js';
import type { IslandReason, PauseReason } from '../contracts/snapshots.js';
import {
  APPLIED, ATTENTION_DELAY, NO_FORM_ERRORS, RENDERER_SERVER, UNCHANGED, getControllerKernel, reject,
  type ControllerKernel, type FormState, type OperationBinding, type RecordState,
} from './controller.js';
import { validDelay } from './validation.js';

// The renderer's side of a controller. It is imported only by react/renderer.tsx, so it travels
// in the lazily loaded renderer chunk; the controller keeps a kernel of the state it touches.
const freeze = Object.freeze;
const bridges = new WeakMap<object, RendererBridge<unknown>>();

export function getRendererBridge<Slot, Signal extends CancellationSignal>(controller: CloudletController<Slot, Signal>): RendererBridge<Slot> {
  let bridge = bridges.get(controller);
  if (!bridge) {
    bridge = createRendererBridge(getControllerKernel<Slot>(controller)) as RendererBridge<unknown>;
    bridges.set(controller, bridge);
  }
  return bridge as RendererBridge<Slot>;
}

function createRendererBridge<Slot>(k: ControllerKernel<Slot>): RendererBridge<Slot> {
  const leaseError = (value: HostLease): 'disposed' | 'stale-lease' | undefined =>
    k.disposed ? 'disposed' : k.lease === null || value !== k.lease ? 'stale-lease' : undefined;
  const currentError = (handle: NotificationHandle): BridgeRejection | undefined =>
    k.handleError(handle) ?? (k.records.get(handle.id) !== k.presented ? 'not-current' : undefined);
  function withCurrent<Args extends unknown[], Result>(action: (record: RecordState<Slot>, ...args: Args) => Result) {
    return k.withRecord((record, ...args: Args) => record !== k.presented ? reject('not-current') : action(record, ...args));
  }
  function withOperation<Args extends unknown[], Result>(action: (operation: OperationBinding, ...args: Args) => Result) {
    return k.withRecord((record, expected: OperationAttemptToken, ...args: Args) => {
      const operation = record.operation;
      return !operation ? reject('no-operation') : operation.getSnapshot().token !== expected
        ? reject('stale-operation-token') : action(operation, ...args);
    });
  }
  function validHostOptions(value: HostOptions | undefined): boolean {
    if (value === undefined) return true;
    return value !== null && typeof value === 'object' && Object.keys(value).every((key) => key === 'attentionDelay')
      && (value.attentionDelay === undefined || validDelay(value.attentionDelay));
  }
  // Preserve the bridge's lease-first validation order in one entry guard.
  function withLease<Args extends unknown[], Result>(action: (...args: Args) => Result) {
    return (value: HostLease, ...args: Args) => {
      const error = leaseError(value);
      return error ? reject(error) : action(...args);
    };
  }
  /** `required` and `maxLength` first, then the form's own `validate`; null lets the submit run. */
  function checkForm(form: FormState, handle: NotificationHandle): FormErrors | null {
    const messages = k.options.messages;
    const fields: Record<string, string> = {};
    for (const field of form.action.fields) {
      const value = form.values[field.name] ?? '';
      if (field.required && !value.trim()) fields[field.name] = messages?.fieldRequired ?? 'This field is required';
      else if (field.maxLength !== undefined && value.length > field.maxLength) fields[field.name] = messages?.fieldTooLong ?? 'This text is too long';
    }
    if (Object.keys(fields).length) return freeze({ form: null, fields: freeze(fields) });
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
  const bridge = freeze<RendererBridge<Slot>>({
    renderError: k.options.messages?.renderError ?? 'Content unavailable',
    reportInvalidContainer(message, error) {
      if (!k.disposed) k.diagnostic({ code: 'invalid-container', source: 'Toaster.container', message, ...(error === undefined ? {} : { error }) });
    },
    attach(hostOptions) {
      if (k.disposed) return reject('disposed');
      if (k.lease !== null) {
        k.diagnostic({ code: 'second-host', source: 'attach', message: 'A renderer is already attached' });
        return reject('host-exists');
      }
      if (!validHostOptions(hostOptions)) return reject('invalid-input');
      const nextLease = k.token() as HostLease;
      k.mutate(() => {
        k.lease = k.lastLease = nextLease;
        k.hostDelay = hostOptions?.attentionDelay;
        if (k.presented) k.assign(k.presented);
      });
      return { status: 'attached', lease: nextLease };
    },
    detach(value) {
      if (k.disposed) return reject('disposed');
      if (k.lease === null && k.lastLease !== null && value === k.lastLease) return UNCHANGED;
      const error = leaseError(value);
      if (error) return reject(error);
      return k.mutate(() => {
        k.lease = null;
        k.hostDelay = undefined;
        k.setHostAutoDismiss(undefined);
        k.focusRequest = null;
        k.focused = null;
        k.globalPauses.clear();
        for (const record of k.records.values()) { record.pauses.clear(); record.readable = false; record.presentation = null; }
      });
    },
    getSnapshot: () => k.rendererSnapshot,
    getServerSnapshot: () => RENDERER_SERVER,
    subscribe: k.subscribe,
    onEvent: k.onEvent,
    openIsland: withLease((reason: IslandReason, handle?: NotificationHandle) => {
      if (reason !== 'user' && reason !== 'attention') return reject('invalid-input');
      let record: RecordState<Slot> | null;
      if (handle === undefined) record = k.newest();
      else {
        const error = k.handleError(handle);
        if (error) return reject(error);
        record = k.records.get(handle.id)!;
      }
      if (!record) return reject('empty');
      const target = record;
      if (k.island?.current === target) return UNCHANGED;
      // An open Island only moves its slider; the opening reason is kept.
      return k.mutate(() => {
        if (k.island) k.island.current = target;
        else k.island = { reason, current: target };
      });
    }),
    collapseIsland: withLease(() => k.island ? k.mutate(() => { k.island = null; }) : UNCHANGED),
    setAutoDismiss: withLease((value?: boolean) => {
      if (value !== undefined && typeof value !== 'boolean') return reject('invalid-input');
      if (k.autoDismissing(value) === k.autoDismissing(k.hostAutoDismiss)) { k.hostAutoDismiss = value; return UNCHANGED; }
      return k.mutate(() => k.setHostAutoDismiss(value));
    }),
    navigate: withLease(k.withRecord((record) => {
      if (!k.island) return reject('island-closed');
      if (k.island.current === record) return UNCHANGED;
      return k.mutate(() => {
        k.island!.current = record;
        // Navigation is interaction: a pending auto-open restarts its delay,
        // and reaching the initiator by hand fulfils it.
        if (k.attention?.record === record) k.attention = null;
        else if (k.attention) { k.attention.waiting = false; k.attention.due = k.clock.now() + (k.hostDelay ?? k.options.attentionDelay ?? ATTENTION_DELAY); }
      });
    })),
    setPause: withLease((change: PauseChange) => {
      if (!change || typeof change.active !== 'boolean') return reject('invalid-input');
      let set: Set<PauseReason>;
      if (change.scope === 'host') {
        if (!['hover', 'focus', 'document-hidden', 'window-blur'].includes(change.reason)) return reject('invalid-input');
        set = k.globalPauses;
      } else if (change.scope === 'notification') {
        const error = currentError(change.handle);
        if (error) return reject(error);
        if (!['gesture', 'content-transition'].includes(change.reason)) return reject('invalid-input');
        set = k.records.get(change.handle.id)!.pauses;
      } else return reject('invalid-input');
      if (set.has(change.reason) === change.active) return UNCHANGED;
      return k.mutate(() => {
        if (change.active) set.add(change.reason); else set.delete(change.reason);
      });
    }),
    // Informational since the stack has no slots to protect; it has no observable effect.
    setFocused: withLease((handle: NotificationHandle | null) => {
      const error = (handle === null ? undefined : currentError(handle));
      if (error) return reject(error);
      if (k.focused === handle) return UNCHANGED;
      k.focused = handle;
      return APPLIED;
    }),
    beginPresentation: withLease(withCurrent((record, previous: PresentationToken) => {
      if (record.presentation !== previous) return reject('stale-presentation');
      const presentation = k.token() as PresentationToken;
      k.mutate(() => { record.presentation = presentation; record.readable = false; });
      return { status: 'started' as const, token: presentation };
    })),
    acknowledgePresentation: withLease(withCurrent((record, presentation: PresentationToken) => {
      if (record.presentation !== presentation) return reject('stale-presentation');
      if (record.readable) return UNCHANGED;
      return k.mutate((deliveries) => {
        deliveries.push({ type: 'presented', handle: record.handle, firstPresentation: !record.everPresented });
        record.readable = record.everPresented = true;
      });
    })),
    acknowledgeFocus: withLease((focusToken: FocusRequestToken, outcome: 'focused' | 'unavailable') => {
      if (k.focusRequest?.token !== focusToken) return reject('stale-focus-request');
      if (outcome !== 'focused' && outcome !== 'unavailable') return reject('invalid-input');
      return k.mutate(() => { k.focusRequest = null; });
    }),
    acknowledgeOverflow: withLease(() => {
      return k.acknowledgeOverflow();
    }),
    acknowledgeAnnouncements: withLease((acknowledgements: readonly AnnouncementAcknowledgement[]) => {
      return acknowledgeAnnouncements(acknowledgements);
    }),
    dismiss: withLease((handle: NotificationHandle, reason: 'close-button' | 'swipe' | 'navigation') => {
      const error = k.handleError(handle);
      if (error) return reject(error);
      // Renderer close reasons are a closed protocol, never an exit callback.
      if (!['close-button', 'swipe', 'navigation'].includes(reason)) return reject('invalid-input');
      return k.dismiss(handle, reason);
    }),
    // The button lives only in the open Island.
    clearAll: withLease(() => k.island ? k.clear('clear-button') : reject('island-closed')),
    invokeAction: withLease(k.withRecord((record) => {
      const handle = record.handle;
      const action = record.content.action;
      if (!action || action.kind === 'link') return reject('no-command');
      if (record.action.status === 'pending') return reject('already-pending');
      const form = k.formOf(record);
      if (form) {
        const errors = checkForm(form, handle);
        if (errors) {
          k.mutate(() => { form.errors = errors; });
          return { status: 'invalid' as const, errors };
        }
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
      return { status: 'started' as const };
    })),
    setFormValue: withLease(k.withRecord((record, name: string, value: string) => {
      const form = k.formOf(record);
      if (!form) return reject('no-form');
      if (typeof value !== 'string' || !form.action.fields.some((field) => field.name === name)) return reject('invalid-input');
      if (record.action.status === 'pending') return reject('already-pending');
      if (form.values[name] === value) return UNCHANGED;
      return k.mutate(() => {
        form.values = freeze({ ...form.values, [name]: value });
        // Editing a field clears its own message; the rest wait for the next submit.
        if (form.errors.fields[name] !== undefined) {
          const { [name]: _, ...fields } = form.errors.fields;
          form.errors = freeze({ form: form.errors.form, fields: freeze(fields) });
        }
      });
    })),
    retryOperation: withLease(withOperation((operation) => {
      const result = operation.retry();
      return result.status === 'started' ? { status: 'started' as const, token: result.attempt.token } : result;
    })),
    cancelOperation: withLease(withOperation((operation, reason?: unknown) => operation.cancel(reason))),
    reportDiagnostic: withLease((report: Diagnostic) => {
      if (!report || typeof report.source !== 'string' || typeof report.message !== 'string'
        || !['invalid-input', 'second-host', 'stale-host', 'mapper-error', 'callback-error', 'listener-error', 'cancellation-error', 'slot-error', 'formatter-error', 'invalid-container'].includes(report.code)) return reject('invalid-input');
      k.diagnostic(report);
      return APPLIED;
    }),
  });

  function acknowledgeAnnouncements(acks: readonly AnnouncementAcknowledgement[]): BridgeResult {
    if (!Array.isArray(acks)) return reject('invalid-input');
    // Stage only effective changes; no ledger mutation occurs until every
    // acknowledgement has passed validation. Repeated counts remain monotonic.
    const changes: (() => void)[] = [];
    const validCount = (count: number, maximum: number) => Number.isSafeInteger(count) && count >= 0 && count <= maximum;
    for (const ack of acks) {
      if (!ack || typeof ack !== 'object') return reject('invalid-input');
      if (ack.kind === 'overflow') {
        if (!validCount(ack.count, k.overflow)) return reject('invalid-input');
        if (ack.count > k.overflowAnnounced) changes.push(() => { k.overflowAnnounced = Math.max(k.overflowAnnounced, ack.count); });
        continue;
      }
      const error = k.handleError(ack.handle);
      if (error) return reject(error);
      const record = k.records.get(ack.handle.id)!;
      if (ack.kind === 'operation') {
        const operation = record.operation?.getSnapshot();
        if (!operation || operation.token !== ack.token) return reject('stale-operation-token');
        if (!['started', 'fulfilled', 'rejected', 'cancelled', 'cancel-requested'].includes(ack.phase)) return reject('invalid-input');
        if (ack.phase === 'cancel-requested' ? !operation.cancelRequested
          : ack.phase !== 'started' && ack.phase !== operation.status) return reject('invalid-input');
        if (!record.operationAnnounced.has(ack.phase)) changes.push(() => { record.operationAnnounced.add(ack.phase); });
      } else if (ack.kind === 'action') {
        if (record.action.status === 'idle' || record.action.token !== ack.token || record.action.status !== ack.status) return reject('invalid-input');
        if (record.actionAnnounced?.token !== ack.token || record.actionAnnounced?.status !== ack.status) {
          changes.push(() => { record.actionAnnounced = freeze({ token: ack.token, status: ack.status }); });
        }
      } else if (ack.kind === 'occurrences') {
        if (!validCount(ack.count, record.occurrences)) return reject('invalid-input');
        if (ack.count > record.occurrencesAnnounced) changes.push(() => { record.occurrencesAnnounced = Math.max(record.occurrencesAnnounced, ack.count); });
      } else if (ack.kind === 'queued' || ack.kind === 'first-presentation') {
        const key = ack.kind === 'queued' ? 'queuedAnnounced' : 'firstAnnounced';
        if (!record[key]) changes.push(() => { record[key] = true; });
      } else return reject('invalid-input');
    }
    if (!changes.length) return UNCHANGED;
    return k.mutate(() => { for (const apply of changes) apply(); });
  }

  return bridge;
}
