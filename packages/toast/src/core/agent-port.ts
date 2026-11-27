import type { NotificationHandle } from '../contracts/identity.js';
import type { FormErrors, RendererSnapshot } from '../contracts/internal.js';
import type { CancellationSignal, CancelResult } from '../contracts/operations.js';
import type { ControllerSnapshot } from '../contracts/snapshots.js';
import { fillFormValue, invokeAction } from './actions.js';
import { UNCHANGED, getControllerKernel, reject, type ControllerKernel, type FieldAuthor, type RecordState } from './controller.js';

// The agent adapter's way into a controller. Only the `agent` entry imports it, so the root entry
// and the renderer chunk never carry it. It hands out no lease: a step that needs a screen only
// checks that a `Toaster` holds one, and no step asks for focus. Form values reach the adapter only
// as "holds text" and who wrote them: `forms` is reduced here, and `controller` is typed as the
// public snapshot, although at runtime it is the renderer's object with its form drafts.

const freeze = Object.freeze;

/** What a reader may know about a form: which fields hold text, who wrote them, the last submit's messages. */
export interface FormReading {
  /** Names of the fields whose value has non-blank text, the same test `required` uses. */
  readonly filled: ReadonlySet<string>;
  /** Who wrote each field last; a field nobody wrote and without a default is missing. */
  readonly authors: ReadonlyMap<string, FieldAuthor>;
  readonly errors: FormErrors;
}

export interface ToasterReading<Slot> {
  readonly controller: ControllerSnapshot<Slot>;
  /** A `Toaster` holds the controller's host lease. */
  readonly mounted: boolean;
  /** A person is on the Toaster: hover, focus, a gesture, or a draft in the open Island. */
  readonly busy: boolean;
  /** One entry per record with a form action. */
  readonly forms: ReadonlyMap<NotificationHandle, FormReading>;
}

/** The grant a step was approved under; a marker stricter than it stops the step. */
export type StepGrant = 'allow' | 'confirm';

type Rejection<Reason extends string> = { readonly status: 'rejected'; readonly reason: Reason };
type HandleReason = 'disposed' | 'invalid-handle' | 'foreign-controller' | 'stale-handle';
type Changed = { readonly status: 'applied' | 'unchanged' };

/** How a pressed command or a submitted form ended, as far as the step waited for it. */
export type PressOutcome =
  /** The action succeeded and closed its notification. */
  | { readonly status: 'done' }
  /** The action failed; `message` is what the person sees. */
  | { readonly status: 'failed'; readonly message: string }
  /** The form did not pass its checks and was not sent; the person sees the same messages. */
  | { readonly status: 'invalid'; readonly errors: FormErrors }
  /** The form's `validate` replaced the action it was checking; neither ran. */
  | { readonly status: 'replaced' }
  /** The step stopped waiting: the notification closed otherwise, the action was replaced, or the signal ended the wait. */
  | { readonly status: 'pending'; readonly gone: boolean };

export interface ToasterPort<Slot> {
  /** The same object until the controller publishes again. */
  readonly read: () => ToasterReading<Slot>;
  readonly subscribe: (listener: () => void) => () => void;
  /** Opens the Island on the top notification, unless a person is busy with the Toaster. */
  readonly open: () => Changed | Rejection<'disposed' | 'no-host' | 'empty' | 'busy'>;
  /** Collapses the Island, unless it holds a draft. */
  readonly close: () => Changed | Rejection<'disposed' | 'busy'>;
  /** Opens the Island on the notification or moves the open one to it, unless a person is busy. */
  readonly show: (handle: NotificationHandle) => Changed | Rejection<HandleReason | 'no-host' | 'busy'>;
  /**
   * Brings the notification in front of the person for a step only they may take: opens the Island
   * on it now, or once they stop interacting (`waiting`). Never moves focus.
   */
  readonly summon: (handle: NotificationHandle) => { readonly status: 'shown' | 'waiting' | 'unchanged' } | Rejection<HandleReason | 'no-host'>;
  readonly dismiss: (handle: NotificationHandle) => Changed | Rejection<HandleReason>;
  readonly clear: () => { readonly status: 'cleared'; readonly count: number } | Rejection<'disposed'>;
  readonly acknowledge: () => Changed | Rejection<'disposed'>;
  readonly cancel: (handle: NotificationHandle) => CancelResult | Rejection<HandleReason | 'no-operation'>;
  readonly retry: (handle: NotificationHandle) => { readonly status: 'started' } | Rejection<HandleReason | 'no-operation' | 'not-retryable' | 'already-pending'>;
  /** Writes a form field as an agent, never over what the person typed. */
  readonly fill: (handle: NotificationHandle, name: string, value: string)
    => Changed | Rejection<HandleReason | 'no-form' | 'invalid-input' | 'already-pending' | 'too-long' | 'person-typed'>;
  /**
   * Starts the command or submits the form, and waits until it settles, its notification closes or
   * `signal` aborts.
   */
  readonly press: (handle: NotificationHandle, grant: StepGrant, signal: CancellationSignal)
    => Promise<PressOutcome> | Rejection<HandleReason | 'no-command' | 'already-pending' | 'stale'>;
}

const STRICTNESS = { allow: 0, confirm: 1, deny: 2 } as const;

/** Throws a TypeError for a controller this package instance did not create. */
export function createToasterPort<Slot>(controller: object): ToasterPort<Slot> {
  const k = getControllerKernel<Slot>(controller);
  let source: RendererSnapshot<Slot> | undefined;
  let mounted = false;
  let reading: ToasterReading<Slot> | undefined;

  const read = (): ToasterReading<Slot> => {
    // Every change of the lease or of what `interacting` reads publishes a new renderer snapshot.
    const next = k.rendererSnapshot;
    const lease = k.lease !== null;
    if (reading && next === source && lease === mounted) return reading;
    source = next;
    mounted = lease;
    const forms = new Map<NotificationHandle, FormReading>();
    for (const form of next.forms) {
      const filled = new Set(Object.keys(form.values).filter((name) => form.values[name]!.trim() !== ''));
      forms.set(form.handle, freeze({ filled, authors: new Map(Object.entries(form.authors)), errors: form.errors }));
    }
    reading = freeze({ controller: next, mounted, busy: k.interacting(), forms });
    return reading;
  };

  const withRecord = k.withRecord;

  return freeze<ToasterPort<Slot>>({
    read,
    subscribe: k.subscribe,
    open() {
      if (k.disposed) return reject('disposed');
      if (k.lease === null) return reject('no-host');
      const record = k.newest();
      if (!record) return reject('empty');
      if (k.island) return UNCHANGED;
      if (k.interacting()) return reject('busy');
      return k.mutate(() => { k.island = { reason: 'attention', current: record }; });
    },
    close() {
      if (k.disposed) return reject('disposed');
      if (!k.island) return UNCHANGED;
      // A person's Escape collapses an Island with a draft; an agent is not that person.
      if (k.dirty(k.island.current)) return reject('busy');
      return k.mutate(() => { k.island = null; });
    },
    show: withRecord((record) => {
      if (k.lease === null) return reject('no-host');
      if (k.island?.current === record) return UNCHANGED;
      if (k.interacting()) return reject('busy');
      // Showing is navigation, as in the renderer: reaching the pending auto-open's record fulfils
      // it, and any other pending auto-open restarts its delay.
      return k.mutate(() => k.reach(record));
    }),
    summon: withRecord((record) => k.lease === null ? reject('no-host') : freeze({ status: k.summon(record) })),
    dismiss: (handle) => k.dismiss(handle, 'programmatic'),
    clear: () => k.clear('clear'),
    acknowledge: () => k.acknowledgeOverflow(),
    // The current attempt's own capability: no token leaves the port.
    cancel: withRecord((record) => record.operation ? record.operation.cancel() : reject('no-operation')),
    retry: withRecord((record) => {
      if (!record.operation) return reject('no-operation');
      const result = record.operation.retry();
      return result.status === 'started' ? freeze({ status: 'started' as const }) : reject(result.reason);
    }),
    fill: withRecord((record, name: string, value: string) => fillFormValue(k, record, name, value)),
    press: withRecord((record, grant: StepGrant, signal: CancellationSignal) => press(k, record, grant, signal)),
  });
}

function press<Slot>(k: ControllerKernel<Slot>, record: RecordState<Slot>, grant: StepGrant, signal: CancellationSignal) {
  const action = record.content.action;
  if (!action || action.kind === 'link') return reject('no-command');
  // The marker is read from the record's content right before the action runs: one the app made
  // stricter after the step was approved stops it.
  if (STRICTNESS[action.agent ?? 'confirm'] > STRICTNESS[grant]) return reject('stale');
  if (record.action.status === 'pending') return reject('already-pending');
  // A wait that has already ended starts nothing.
  if (signal.aborted) return Promise.resolve<PressOutcome>(freeze({ status: 'pending', gone: false }));
  const handle = record.handle;
  return new Promise<PressOutcome>((resolve) => {
    let settled = false;
    let token: string | undefined;
    const finish = (outcome: PressOutcome): void => {
      if (settled) return;
      settled = true;
      stopState();
      stopEvents();
      signal.removeEventListener('abort', abort);
      resolve(freeze(outcome));
    };
    const abort = (): void => { finish({ status: 'pending', gone: k.records.get(handle.id) !== record }); };
    // Only the closing event says why the notification closed; state listeners run before it.
    const stopEvents = k.onEvent((event) => {
      if (event.type === 'closed' && event.handle === handle) {
        finish(event.reason === 'action-success' ? { status: 'done' } : { status: 'pending', gone: true });
      }
    });
    const stopState = k.subscribe(() => {
      if (token === undefined || k.records.get(handle.id) !== record) return;
      const state = record.action;
      if (state.status === 'failed' && state.token === token) finish({ status: 'failed', message: state.message });
      else if (state.status === 'idle' || state.token !== token) finish({ status: 'pending', gone: false });
    });
    signal.addEventListener('abort', abort, { once: true });
    // Listeners first: the command may close or replace its notification synchronously.
    const started = invokeAction(k, record);
    if (started.status === 'invalid') { finish({ status: 'invalid', errors: started.errors }); return; }
    if (started.status !== 'started') {
      finish(started.reason === 'action-replaced' ? { status: 'replaced' } : { status: 'pending', gone: k.records.get(handle.id) !== record });
      return;
    }
    if (settled) return;
    // This press's own attempt: a listener of `action-started` may already have begun another one.
    token = started.token;
    const state = record.action;
    if (state.status === 'failed' && state.token === token) finish({ status: 'failed', message: state.message });
    else if (state.status === 'idle' || state.token !== token) finish({ status: 'pending', gone: false });
    else if (signal.aborted) abort();
  });
}
