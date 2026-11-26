import type { CloudletController } from './contracts/controller.js';
import type { NotificationHandle } from './contracts/identity.js';
import type { NotificationKind, Priority } from './contracts/notifications.js';
import type { CancellationSignal, OperationStatus } from './contracts/operations.js';
import type { NotificationLocation, NotificationSnapshot, PauseReason } from './contracts/snapshots.js';
import { createToasterPort, type FormReading, type ToasterReading } from './core/agent-port.js';

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
 * A cancellation signal as the bridge hands it out; an `AbortSignal` at runtime.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export interface AgentSignalShape {
  readonly aborted: boolean;
  readonly reason: unknown;
  readonly throwIfAborted: () => void;
  readonly addEventListener: (type: 'abort', listener: () => void, options?: { readonly once?: boolean }) => void;
  readonly removeEventListener: (type: 'abort', listener: () => void) => void;
}

/**
 * A value a step may return to the agent.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type AgentValueShape = string | number | boolean | null | readonly AgentValueShape[] | { readonly [key: string]: AgentValueShape };

/**
 * What a step may do: on its own, with approval, or never.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type AgentPermissionShape = 'allow' | 'confirm' | 'deny';

/**
 * A step as the bridge hands it to a component.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export interface AgentStepCallShape {
  readonly ref: string;
  readonly action: string;
  readonly args: readonly unknown[];
}

/**
 * How a person names what a step acts on, for the bridge's messages.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export interface AgentStepNamesShape {
  readonly target: string;
  readonly within?: string;
}

/**
 * A component's answer to the bridge's `check`.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type AgentStepCheckShape =
  | { readonly available: true; readonly permission: AgentPermissionShape; readonly names?: AgentStepNamesShape }
  | { readonly available: false; readonly message?: string };

/**
 * What the bridge's `run` receives besides the step.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export interface AgentRunContextShape {
  readonly signal: AgentSignalShape;
  readonly approved: 'allow' | 'confirm';
}

/**
 * A component's answer to the bridge's `run`.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type AgentRunOutcomeShape =
  | { readonly status: 'done'; readonly result?: AgentValueShape; readonly gone?: boolean }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'unavailable'; readonly message?: string }
  | { readonly status: 'stale' };

/**
 * A component's answer to the bridge's `summon`.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type AgentSummonOutcomeShape = boolean | { readonly reached: boolean; readonly note: string };

/**
 * What a component hands to the bridge's `connect`. `check` and `run` come together, `summon` is
 * optional, and a read-only component leaves all three out.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export interface AgentComponentShape<Entry extends AgentEntryShape = AgentEntryShape> {
  readonly protocol: 1;
  readonly name: string;
  snapshot(): readonly Entry[];
  subscribe(listener: () => void): () => void;
  readonly check?: (step: AgentStepCallShape) => AgentStepCheckShape;
  readonly run?: (step: AgentStepCallShape, context: AgentRunContextShape) => AgentRunOutcomeShape | PromiseLike<AgentRunOutcomeShape>;
  readonly summon?: (step: AgentStepCallShape) => AgentSummonOutcomeShape;
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
  /**
   * What the app lets an agent do with a command or a form: `allow`, `confirm` (a person approves)
   * or `deny`. `confirm` when the app set nothing; absent for a link.
   */
  readonly agent?: 'allow' | 'confirm' | 'deny';
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
  /** `dismiss`, `show` (with a mounted `Toaster`), `press`, `fill`, `submit`, `cancel`, `retry`, by state. */
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
  /** Whether a step is available now and the class it needs; no side effects. */
  readonly check: (step: AgentStepCallShape) => AgentStepCheckShape;
  /** Reads the controller again and runs the step, unless it changed since it was approved. */
  readonly run: (step: AgentStepCallShape, context: AgentRunContextShape) => AgentRunOutcomeShape | PromiseLike<AgentRunOutcomeShape>;
  /**
   * Opens the Island on the step's notification for a person, at once or once they stop using the
   * Toaster, without moving focus, and says which in `note`.
   */
  readonly summon: (step: AgentStepCallShape) => AgentSummonOutcomeShape;
}

/** @experimental The protocol may change before the bridge reaches 1.0. */
export interface ToasterAgentOptions {
  /** The component's name and the prefix of its refs; matches `[a-z][a-z0-9-]*`. Default `toaster`. */
  readonly name?: string;
}

const freeze = Object.freeze;
const EMPTY: readonly never[] = freeze([]);
const quote = JSON.stringify;
const TOASTER_VERBS: ReadonlySet<string> = new Set(['open', 'close', 'clear', 'acknowledge']);
const NOTIFICATION_VERBS: ReadonlySet<string> = new Set(['dismiss', 'show', 'press', 'fill', 'submit', 'cancel', 'retry']);
const STRICTNESS = { allow: 0, confirm: 1, deny: 2 } as const;
const DONE: AgentRunOutcomeShape = freeze({ status: 'done' });
const GONE: AgentRunOutcomeShape = freeze({ status: 'done', gone: true });
const STALE: AgentRunOutcomeShape = freeze({ status: 'stale' });
const UNAVAILABLE: AgentRunOutcomeShape = freeze({ status: 'unavailable' });

// Refusals the adapter words itself; the bridge words the rest from the record's `actions`.
// Labels and titles come from the app, so they are quoted.
const texts = {
  noScreen: (action: string) => `No Toaster is on screen: ${quote(action)} needs one.`,
  noArguments: (step: AgentStepCallShape) => `${quote(step.action)} on ${quote(step.ref)} takes no arguments.`,
  running: (label: string) => `${quote(label)} is already running.`,
  failed: (label: string, message: string) => `${quote(label)} failed: ${message}`,
  finished: 'This operation has already finished.',
  cancelRequested: 'Cancelling this operation was already requested.',
  notCancellable: "This operation can't be cancelled.",
  stillRunning: "This operation is still running, so it can't be retried yet.",
  notRetryable: "This operation can't be retried.",
  busy: 'The person is using the Island. Try again later.',
  islandOpen: 'The Island is open on it.',
  islandLater: 'The Island will open on it once they stop using it.',
  noToaster: 'No Toaster is on screen, so tell them what it does.',
};

/** A step as the adapter sees it right now: refused, or allowed under a class with a way to run it. */
type Plan =
  | { readonly available: false; readonly message?: string }
  | {
    readonly available: true;
    readonly permission: AgentPermissionShape;
    readonly names?: AgentStepNamesShape;
    readonly perform: (context: AgentRunContextShape) => AgentRunOutcomeShape | Promise<AgentRunOutcomeShape>;
  };

const NOT_AVAILABLE: Plan = freeze({ available: false });
const refuse = (message: string): Plan => freeze({ available: false, message });
const allowed = (perform: () => AgentRunOutcomeShape): Plan => freeze({ available: true, permission: 'allow', perform });
type PortResult = { readonly status: string; readonly reason?: string };
/** A port refusal after the plan said yes: the state changed in between, so the step is unavailable. */
const outcome = (result: PortResult, done: AgentRunOutcomeShape, words: Readonly<Record<string, string>> = {}): AgentRunOutcomeShape => {
  if (result.status !== 'rejected') return done;
  const message = result.reason === undefined ? undefined : words[result.reason];
  return message === undefined ? UNAVAILABLE : freeze({ status: 'unavailable', message });
};

/**
 * Lets an agent read and drive a controller through the kit's agent bridge:
 * `agent.connect(toasterAgent(controller))`. It touches no DOM, starts no timers, never takes the
 * host from a `Toaster` and never moves focus. Form values never reach the snapshot.
 *
 * Steps: `open`, `close`, `clear` and `acknowledge` on the Toaster record; `show`, `dismiss`,
 * `press`, `cancel` and `retry` on a notification. `open` and `show` need a mounted `Toaster`.
 * `press` follows the action's `agent` marker; every other step is allowed unless the bridge's
 * `allow` says no. A press that needs a person opens the Island on its notification for them: at
 * once, or after the attention delay once they stop using the Toaster. While they use it (hover,
 * focus, a gesture, a draft in the open Island), `open` and `show` are refused, and so is `close`
 * over a draft.
 *
 * @throws TypeError for a controller that this copy of `@cloudlet/toast` did not create.
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export function toasterAgent<Slot, Signal extends CancellationSignal>(
  controller: Omit<CloudletController<Slot, Signal>, 'track'>,
  options?: ToasterAgentOptions,
): ToasterAgent {
  const name = options?.name ?? 'toaster';
  const port = createToasterPort<Slot>(controller);
  // A number per handle, so a closed notification's ref is never handed to another one.
  const refs = new WeakMap<NotificationHandle, string>();
  let issued = 0;
  const refOf = (handle: NotificationHandle): string => {
    let ref = refs.get(handle);
    if (ref === undefined) refs.set(handle, ref = `${name}:${++issued}`);
    return ref;
  };
  let source: ToasterReading<Slot> | undefined;
  let entries: readonly ToasterAgentEntry[] = EMPTY;
  // The notifications of the current snapshot by ref, for steps.
  let targets: ReadonlyMap<string, { readonly item: NotificationSnapshot<Slot>; readonly entry: NotificationEntry }> = new Map();

  const snapshot = (): readonly ToasterAgentEntry[] => {
    const reading = port.read();
    if (reading === source) return entries;
    source = reading;
    const state = reading.controller;
    if (state.disposed) { targets = new Map(); return entries = EMPTY; }
    const byHandle = new Map(state.notifications.map((item) => [item.handle, item] as const));
    const island = state.island;
    const count = state.stack.length;
    const found = new Map<string, { readonly item: NotificationSnapshot<Slot>; readonly entry: NotificationEntry }>();
    // Refs are issued in presentation order, so the top notification gets the lower number.
    const notifications = state.stack.map((handle) => {
      const item = byHandle.get(handle)!;
      const entry = notification(item, refOf(handle), island.open && island.current === handle, reading.mounted, reading.forms.get(handle));
      found.set(entry.ref, { item, entry });
      return entry;
    });
    targets = found;
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

  /** Reads the step against the controller as it is now; `check` and `run` both start here. */
  const plan = (step: AgentStepCallShape): Plan => {
    const current = snapshot();
    const mounted = source?.mounted ?? false;
    const { action } = step;
    if (step.ref === name && current.length) {
      if (!TOASTER_VERBS.has(action)) return NOT_AVAILABLE;
      if (step.args.length) return refuse(texts.noArguments(step));
      if (action === 'open' && !mounted) return refuse(texts.noScreen(action));
      if (!current[0]!.actions.includes(action)) return NOT_AVAILABLE;
      // A busy person is not interrupted; only a draft stops `close`, which a person's Escape would collapse.
      if (action === 'open' && source!.busy) return refuse(texts.busy);
      if (action === 'close' && holdsDraft()) return refuse(texts.busy);
      switch (action) {
        case 'open': return allowed(() => outcome(port.open(), DONE, { 'no-host': texts.noScreen(action), busy: texts.busy }));
        case 'close': return allowed(() => outcome(port.close(), DONE, { busy: texts.busy }));
        case 'clear': return allowed(() => outcome(port.clear(), DONE));
        default: return allowed(() => outcome(port.acknowledge(), DONE));
      }
    }
    const target = targets.get(step.ref);
    if (!target || !NOTIFICATION_VERBS.has(action)) return NOT_AVAILABLE;
    // Forms take agent steps in a later release; until then fill and submit only read.
    if (action === 'fill' || action === 'submit') return NOT_AVAILABLE;
    if (step.args.length) return refuse(texts.noArguments(step));
    const { item, entry } = target;
    const { handle } = item;
    switch (action) {
      case 'show':
        if (!mounted) return refuse(texts.noScreen(action));
        break;
      case 'press': return pressPlan(item);
      case 'cancel': {
        const operation = item.operation;
        if (!operation) return NOT_AVAILABLE;
        if (operation.status !== 'pending') return refuse(texts.finished);
        if (operation.cancelRequested) return refuse(texts.cancelRequested);
        if (!operation.canCancel) return refuse(texts.notCancellable);
        break;
      }
      case 'retry': {
        const operation = item.operation;
        if (!operation) return NOT_AVAILABLE;
        if (operation.status === 'pending') return refuse(texts.stillRunning);
        if (!operation.canRetry) return refuse(texts.notRetryable);
        break;
      }
    }
    if (!entry.actions.includes(action)) return NOT_AVAILABLE;
    if (action === 'show' && source!.busy) return refuse(texts.busy);
    switch (action) {
      case 'show': return allowed(() => outcome(port.show(handle), DONE, { 'no-host': texts.noScreen(action), busy: texts.busy }));
      case 'dismiss': return allowed(() => outcome(port.dismiss(handle), GONE));
      case 'cancel': return allowed(() => {
        const result = port.cancel(handle);
        return result.status === 'requested' ? freeze({ status: 'done', result: 'requested' })
          : outcome(result.status === 'unchanged' ? { status: 'rejected', reason: result.reason } : result, DONE, {
            settled: texts.finished, 'already-requested': texts.cancelRequested, 'not-cancellable': texts.notCancellable,
          });
      });
      default: return allowed(() => outcome(port.retry(handle), freeze({ status: 'done', result: 'started' }), {
        'already-pending': texts.stillRunning, 'not-retryable': texts.notRetryable,
      }));
    }
  };

  /** The open Island shows a notification whose form holds a draft. */
  const holdsDraft = (): boolean => {
    const state = source!.controller;
    const current = state.island.current;
    return current !== null && state.notifications.some((item) => item.handle === current && item.draft);
  };

  const pressPlan = (item: NotificationSnapshot<Slot>): Plan => {
    const action = item.content.action;
    if (action?.kind !== 'command') return NOT_AVAILABLE;
    const { label } = action;
    const permission = action.agent ?? 'confirm';
    const names = freeze({ target: label, within: item.content.title });
    // A denied press never runs, so it is reported before its state.
    if (permission !== 'deny' && item.action.status === 'pending') return refuse(texts.running(label));
    return freeze({
      available: true, permission, names,
      async perform({ signal, approved }: AgentRunContextShape): Promise<AgentRunOutcomeShape> {
        const started = port.press(item.handle, approved, signal);
        if (!(started instanceof Promise)) {
          return started.reason === 'stale' ? STALE : outcome(started, DONE, { 'already-pending': texts.running(label) });
        }
        const ended = await started;
        if (ended.status === 'done') return GONE;
        if (ended.status === 'failed') return freeze({ status: 'failed', message: texts.failed(label, ended.message) });
        return freeze({ status: 'done', result: 'pending', ...(ended.gone ? { gone: true } : {}) });
      },
    });
  };

  const check = (step: AgentStepCallShape): AgentStepCheckShape => {
    const verdict = plan(step);
    if (!verdict.available) return verdict;
    return freeze({ available: true, permission: verdict.permission, ...(verdict.names ? { names: verdict.names } : {}) });
  };

  // The bridge approved the step under `approved`; the controller is read again before anything runs.
  const run = (step: AgentStepCallShape, context: AgentRunContextShape): AgentRunOutcomeShape | Promise<AgentRunOutcomeShape> => {
    const verdict = plan(step);
    if (!verdict.available) return verdict.message === undefined ? UNAVAILABLE : freeze({ status: 'unavailable', message: verdict.message });
    if (STRICTNESS[verdict.permission] > STRICTNESS[context.approved]) return STALE;
    return verdict.perform(context);
  };

  // A step only a person may take: the Island opens on its notification for them, through the
  // attention queue, so a person busy with the Toaster is not interrupted.
  const summon = (step: AgentStepCallShape): AgentSummonOutcomeShape => {
    snapshot();
    const target = targets.get(step.ref);
    if (!target) return false;
    const result = port.summon(target.item.handle);
    if (result.status === 'rejected') return result.reason === 'no-host' ? freeze({ reached: false, note: texts.noToaster }) : false;
    return freeze({ reached: true, note: result.status === 'waiting' ? texts.islandLater : texts.islandOpen });
  };

  return freeze({ protocol: 1 as const, name, snapshot, subscribe: port.subscribe, check, run, summon });
}

function notification<Slot>(item: NotificationSnapshot<Slot>, ref: string, shown: boolean, mounted: boolean, form: FormReading | undefined): NotificationEntry {
  const { content } = item;
  const description = content.description;
  const progress = content.progress;
  const operation = item.operation;
  const action = actionEntry(item, form);
  // `deny` stops pressing and submitting only: a person can still submit what an agent filled.
  const ready = item.action.status !== 'pending';
  const may = ready && action?.agent !== 'deny';
  return freeze({
    ref, component: 'notification' as const,
    actions: freeze([
      'dismiss',
      ...(!shown && mounted ? ['show'] : []),
      ...(action?.kind === 'command' && may ? ['press'] : []),
      ...(action?.kind === 'form' && ready ? ['fill'] : []),
      ...(action?.kind === 'form' && may ? ['submit'] : []),
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
  if (action.kind === 'command') return freeze({ ...common, agent: action.agent ?? 'confirm' });
  const errors = form?.errors;
  return freeze({
    ...common,
    agent: action.agent ?? 'confirm',
    fields: freeze(action.fields.map((field) => freeze({
      name: field.name, label: field.label, required: field.required ?? false,
      filled: form?.filled.has(field.name) ?? false,
      // Own keys only: a field named `constructor` must not read `Object.prototype`.
      error: errors && Object.hasOwn(errors.fields, field.name) ? errors.fields[field.name]! : null,
    }))),
    error: errors?.form ?? null,
  });
}
