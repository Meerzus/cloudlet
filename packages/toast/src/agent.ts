import type { CloudletController } from './contracts/controller.js';
import type { NotificationHandle } from './contracts/identity.js';
import type { NotificationKind, Priority } from './contracts/notifications.js';
import type { CancellationSignal, OperationStatus } from './contracts/operations.js';
import type { NotificationLocation, NotificationSnapshot, PauseReason } from './contracts/snapshots.js';
import { createToasterReadPort, type FormReading } from './core/agent-port.js';

// The Toaster's side of the agent bridge. Its protocol types are declared here structurally:
// this package never imports the bridge package, not even its types.

/**
 * One record of an agent snapshot, as the bridge reads it.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type AgentEntryShape = {
  readonly ref: string;
  readonly component: string;
  readonly actions: readonly string[];
  readonly [key: string]: unknown;
};

/**
 * What a component hands to the bridge's `connect`.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export interface AgentComponentShape<Entry extends AgentEntryShape = AgentEntryShape> {
  readonly protocol: 1;
  readonly name: string;
  snapshot(): readonly Entry[];
  subscribe(listener: () => void): () => void;
}

/**
 * The Toaster's own record: the Island, the count and the overflow.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type ToasterEntry = {
  readonly ref: string;
  readonly component: 'toaster';
  /** `open`, `close`, `clear`, `acknowledge`, by state. */
  readonly actions: readonly string[];
  readonly island: {
    readonly open: boolean;
    /** `ref` of the notification the open Island shows; null while closed. */
    readonly current: string | null;
  };
  readonly count: number;
  readonly overflow: { readonly count: number; readonly pending: boolean };
  /** A mounted `Toaster` renders this controller. */
  readonly mounted: boolean;
};

/**
 * A form field as a reader sees it. Its value, default and placeholder stay inside Cloudlet.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type FormFieldEntry = {
  readonly name: string;
  readonly label: string;
  readonly required: boolean;
  /** The field holds non-blank text. */
  readonly filled: boolean;
  /** The message from the last submit, if any. */
  readonly error: string | null;
};

/**
 * A notification's primary action.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type ActionEntry = {
  readonly kind: 'command' | 'link' | 'form';
  /** The label the application gave the action. */
  readonly label: string;
  readonly status: 'idle' | 'pending' | 'failed';
  /** Why the last attempt failed; null unless `status` is `failed`. */
  readonly message: string | null;
  /** Only for a link. */
  readonly href?: string;
  /** Only for a form. */
  readonly fields?: readonly FormFieldEntry[];
  /** The form-wide message from the last submit; only for a form. */
  readonly error?: string | null;
};

/**
 * A notification's operation, without its attempt token.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type OperationEntry = {
  readonly status: OperationStatus;
  readonly attempt: number;
  readonly canCancel: boolean;
  readonly canRetry: boolean;
  readonly cancelRequested: boolean;
};

/**
 * One notification, in presentation order.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type NotificationEntry = {
  readonly ref: string;
  readonly component: 'notification';
  /** `dismiss`, `show`, `press`, `fill`, `submit`, `cancel`, `retry`, by state. */
  readonly actions: readonly string[];
  /** The title. */
  readonly label: string;
  /** The description as text; for rich content, its announcement. */
  readonly text: string | null;
  readonly kind: NotificationKind;
  readonly priority: Priority;
  readonly occurrences: number;
  readonly location: NotificationLocation;
  readonly remainingMs: number | null;
  readonly pauseReasons: readonly PauseReason[];
  readonly progress: { readonly kind: 'indeterminate' | 'determinate'; readonly value: number | null; readonly label: string | null } | null;
  readonly draft: boolean;
  readonly operation: OperationEntry | null;
  readonly action: ActionEntry | null;
};

/** @experimental The protocol may change before the bridge reaches 1.0. */
export type ToasterAgentEntry = ToasterEntry | NotificationEntry;

/**
 * What {@link toasterAgent} returns: pass it to the bridge's `connect`.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export interface ToasterAgent extends AgentComponentShape<ToasterAgentEntry> {
  /** The same frozen array until the controller changes; empty after `dispose`. */
  snapshot(): readonly ToasterAgentEntry[];
}

/** @experimental The protocol may change before the bridge reaches 1.0. */
export interface ToasterAgentOptions {
  /** The component's name and the prefix of its refs; matches `[a-z][a-z0-9-]*`. Default `toaster`. */
  readonly name?: string;
}

const freeze = Object.freeze;
const EMPTY: readonly never[] = freeze([]);

/**
 * Lets an agent read a controller through the kit's agent bridge:
 * `agent.connect(toasterAgent(controller))`. It touches no DOM, starts no timers and never takes
 * the host from a `Toaster`. Form values never reach the snapshot.
 *
 * @throws TypeError for a controller that this copy of `@cloudlet/toast` did not create.
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export function toasterAgent<Slot, Signal extends CancellationSignal>(
  controller: Omit<CloudletController<Slot, Signal>, 'track'>,
  options?: ToasterAgentOptions,
): ToasterAgent {
  const name = options?.name ?? 'toaster';
  const port = createToasterReadPort<Slot>(controller);
  // A number per handle, so a closed notification's ref is never handed to another one.
  const refs = new WeakMap<NotificationHandle, string>();
  let issued = 0;
  const refOf = (handle: NotificationHandle): string => {
    let ref = refs.get(handle);
    if (ref === undefined) refs.set(handle, ref = `${name}:${++issued}`);
    return ref;
  };
  let source: ReturnType<typeof port.read> | undefined;
  let entries: readonly ToasterAgentEntry[] = EMPTY;

  const snapshot = (): readonly ToasterAgentEntry[] => {
    const reading = port.read();
    if (reading === source) return entries;
    source = reading;
    const state = reading.controller;
    if (state.disposed) return entries = EMPTY;
    const byHandle = new Map(state.notifications.map((item) => [item.handle, item] as const));
    const island = state.island;
    const count = state.stack.length;
    // Refs are issued in presentation order, so the top notification gets the lower number.
    const notifications = state.stack.map((handle) => notification(byHandle.get(handle)!, refOf(handle),
      island.open && island.current === handle, reading.forms.get(handle)));
    const toaster: ToasterEntry = freeze({
      ref: name, component: 'toaster' as const,
      actions: freeze([
        ...(!island.open && count > 0 && reading.mounted ? ['open'] : []),
        ...(island.open ? ['close'] : []),
        ...(count > 0 ? ['clear'] : []),
        ...(state.overflow.pending ? ['acknowledge'] : []),
      ]),
      island: freeze({ open: island.open, current: island.current ? refOf(island.current) : null }),
      count,
      overflow: freeze({ count: state.overflow.count, pending: state.overflow.pending }),
      mounted: reading.mounted,
    });
    return entries = freeze([toaster, ...notifications]);
  };

  return freeze({ protocol: 1 as const, name, snapshot, subscribe: port.subscribe });
}

function notification<Slot>(item: NotificationSnapshot<Slot>, ref: string, shown: boolean, form: FormReading | undefined): NotificationEntry {
  const { content } = item;
  const description = content.description;
  const progress = content.progress;
  const operation = item.operation;
  const action = actionEntry(item, form);
  const ready = item.action.status !== 'pending';
  return freeze({
    ref, component: 'notification' as const,
    actions: freeze([
      'dismiss',
      ...(!shown ? ['show'] : []),
      ...(action?.kind === 'command' && ready ? ['press'] : []),
      ...(action?.kind === 'form' && ready ? ['fill', 'submit'] : []),
      ...(operation?.canCancel ? ['cancel'] : []),
      ...(operation?.canRetry ? ['retry'] : []),
    ]),
    label: content.title,
    text: description ? description.kind === 'text' ? description.text : description.announcement : null,
    kind: item.kind,
    priority: item.priority,
    occurrences: item.occurrences,
    location: item.location,
    remainingMs: item.remainingMs,
    pauseReasons: freeze([...item.pauseReasons]),
    progress: progress ? freeze({
      kind: progress.kind,
      value: progress.kind === 'determinate' ? progress.value : null,
      label: progress.label ?? null,
    }) : null,
    draft: item.draft,
    operation: operation ? freeze({
      status: operation.status, attempt: operation.attempt, canCancel: operation.canCancel,
      canRetry: operation.canRetry, cancelRequested: operation.cancelRequested,
    }) : null,
    action,
  });
}

function actionEntry<Slot>(item: NotificationSnapshot<Slot>, form: FormReading | undefined): ActionEntry | null {
  const action = item.content.action;
  if (!action) return null;
  const state = item.action;
  const common = {
    kind: action.kind, label: action.label, status: state.status,
    message: state.status === 'failed' ? state.message : null,
  };
  if (action.kind === 'link') return freeze({ ...common, href: action.href });
  if (action.kind === 'command') return freeze(common);
  const errors = form?.errors;
  return freeze({
    ...common,
    fields: freeze(action.fields.map((field) => freeze({
      name: field.name, label: field.label, required: field.required ?? false,
      filled: form?.filled.has(field.name) ?? false,
      // Own keys only: a field named `constructor` must not read `Object.prototype`.
      error: errors && Object.hasOwn(errors.fields, field.name) ? errors.fields[field.name]! : null,
    }))),
    error: errors?.form ?? null,
  });
}
