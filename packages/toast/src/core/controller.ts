import type { CloudletController, ControllerOptions, FocusTarget } from '../contracts/controller.js';
import type { Diagnostic, EventBase, SemanticEvent } from '../contracts/events.js';
import type { ActionAttemptToken, ControllerIdentity, Generation, HandleRejection, NotificationHandle, OperationAttemptToken, Unsubscribe } from '../contracts/identity.js';
import type {
  FocusRequest, FocusRequestToken, ControllerDependencies, HostLease, OperationAnnouncementPhase, PresentationToken,
  RendererSnapshot,
} from '../contracts/internal.js';
import type { AdmissionResult, CloseReason, NotificationContent, NotificationKind, NotificationPatch, NotificationSpec, OperationAdmissionResult, Priority } from '../contracts/notifications.js';
import type { AttemptStartResult, CancellationSignal, CancelResult, OperationAttempt, OperationContext, OperationHandle, OperationSnapshot, OperationSource, OperationStatus, TrackOptions } from '../contracts/operations.js';
import type { ActionSnapshot, ControllerSnapshot, IslandReason, IslandSnapshot, PauseReason } from '../contracts/snapshots.js';
import { copyContent, patchContent, validateContent, validateOptions, validatePatch, validateSpec, validateTrackOptions } from './validation.js';

export interface OperationBinding {
  readonly getSnapshot: () => OperationSnapshot;
  readonly retry: () => AttemptStartResult<unknown>;
  readonly cancel: (reason?: unknown) => CancelResult;
  readonly detach: () => Delivery;
}

type EventPayload = SemanticEvent extends infer E ? E extends SemanticEvent ? Omit<E, keyof EventBase> : never : never;
export type Delivery = EventPayload | { readonly callback: () => void; readonly source: string; readonly handle?: NotificationHandle };

export interface RecordState<Slot> {
  readonly handle: NotificationHandle;
  readonly dedupeKey: string | undefined;
  readonly onClose: NotificationSpec<Slot>['onClose'];
  content: Readonly<NotificationContent<Slot>>;
  kind: NotificationKind;
  priority: Priority;
  occurrences: number;
  remaining: number | null;
  activeSince: number | null;
  presentation: PresentationToken | null;
  readable: boolean;
  everPresented: boolean;
  readonly pauses: Set<PauseReason>;
  queuedAnnounced: boolean;
  firstAnnounced: boolean;
  occurrencesAnnounced: number;
  operation: OperationBinding | null;
  readonly operationAnnounced: Set<OperationAnnouncementPhase>;
  action: ActionSnapshot;
  actionAnnounced?: { readonly token: ActionAttemptToken; readonly status: 'pending' | 'failed' };
}

/** Open Island state; `null` is the collapsed stack. */
export interface IslandState<Slot> {
  readonly reason: IslandReason;
  current: RecordState<Slot>;
}

export interface AttentionCandidate<Slot> {
  readonly record: RecordState<Slot>;
  due: number;
  /** Expired during user interaction or without a host; restarts the delay afterwards. */
  waiting: boolean;
}

export const ATTENTION_DELAY = 600;

const freeze = Object.freeze;

// Weak registries authenticate capabilities without retaining disposed controllers.
const handles = new WeakSet<object>();
const kernels = new WeakMap<object, ControllerKernel<unknown>>();
let nextController = 0;
const EMPTY: readonly never[] = freeze([]);
const COLLAPSED: IslandSnapshot = freeze({ open: false, reason: null, current: null });
const SERVER: ControllerSnapshot<never> = freeze({
  controller: null, revision: 0, disposed: false, notifications: EMPTY, stack: EMPTY,
  island: COLLAPSED, overflow: freeze({ count: 0, pending: false }),
});
export const RENDERER_SERVER: RendererSnapshot<never> = freeze({
  ...SERVER, presentation: null, focusRequest: null,
  announcements: freeze({ notifications: EMPTY, overflowCount: 0 }),
});
const IDLE = freeze({ status: 'idle' as const });
export const APPLIED = freeze({ status: 'applied' as const });
export const UNCHANGED = freeze({ status: 'unchanged' as const });
export const reject = <Reason extends string>(reason: Reason) => ({ status: 'rejected' as const, reason });

type Rejected<Reason extends string> = { status: 'rejected'; reason: Reason };

/**
 * Controller state and transactions the renderer bridge needs (core/bridge.ts). The bridge travels
 * in the lazily loaded renderer chunk, so the start bundle carries only this accessor object.
 */
export interface ControllerKernel<Slot> {
  readonly options: ReturnType<typeof validateOptions>;
  readonly clock: ControllerDependencies<CancellationSignal>['clock'];
  readonly records: Map<string, RecordState<Slot>>;
  readonly globalPauses: Set<PauseReason>;
  readonly subscribe: CloudletController<Slot, CancellationSignal>['subscribe'];
  readonly onEvent: CloudletController<Slot, CancellationSignal>['onEvent'];
  readonly disposed: boolean;
  readonly presented: RecordState<Slot> | null;
  readonly rendererSnapshot: RendererSnapshot<Slot>;
  readonly overflow: number;
  lease: HostLease | null;
  lastLease: HostLease | null;
  hostDelay: number | undefined;
  hostAutoDismiss: boolean | undefined;
  island: IslandState<Slot> | null;
  attention: AttentionCandidate<Slot> | null;
  focusRequest: FocusRequest | null;
  focused: NotificationHandle | null;
  overflowAnnounced: number;
  readonly token: () => string;
  readonly diagnostic: (diagnostic: Diagnostic) => void;
  readonly failure: (code: Diagnostic['code'], source: string, error: unknown, handle?: NotificationHandle) => void;
  readonly mutate: (apply: (deliveries: Delivery[]) => void, final?: boolean) => typeof APPLIED;
  readonly commit: (deliveries?: readonly Delivery[], now?: number, final?: boolean) => void;
  readonly settle: () => number;
  readonly assign: (record: RecordState<Slot>) => void;
  readonly newest: () => RecordState<Slot> | null;
  readonly handleError: (handle: NotificationHandle) => HandleRejection | 'disposed' | undefined;
  readonly withRecord: <Args extends unknown[], Result>(action: (record: RecordState<Slot>, ...args: Args) => Result)
    => (handle: NotificationHandle, ...args: Args) => Result | Rejected<HandleRejection | 'disposed'>;
  readonly autoDismissing: (host: boolean | undefined) => boolean;
  readonly setHostAutoDismiss: (value: boolean | undefined) => void;
  readonly dismiss: (handle: NotificationHandle, reason: CloseReason) => typeof APPLIED | Rejected<HandleRejection | 'disposed'>;
  readonly acknowledgeOverflow: () => typeof APPLIED | typeof UNCHANGED | Rejected<'disposed'>;
  readonly reportRendererLoadError: (error: unknown) => void;
}

export function getControllerKernel<Slot>(controller: object): ControllerKernel<Slot> {
  const kernel = kernels.get(controller);
  if (!kernel) throw new TypeError('Controller was not created by this Cloudlet package instance');
  // The registry stores the kernel together with its controller's opaque Slot type.
  return kernel as ControllerKernel<Slot>;
}

/** The sole owner of notification state, the stack/Island, budgets, attention and host leases. */
export function createCloudletCore<Slot = never, Signal extends CancellationSignal = CancellationSignal>(
  inputOptions: ControllerOptions | undefined,
  dependencies: ControllerDependencies<Signal>,
): CloudletController<Slot, Signal> {
  const options = validateOptions(inputOptions);
  if (!dependencies?.clock || typeof dependencies.clock.now !== 'function' || typeof dependencies.clock.schedule !== 'function') {
    throw new TypeError('Cloudlet requires a monotonic clock');
  }
  const clock = dependencies.clock;
  if (typeof dependencies.createCancellation !== 'function') throw new TypeError('Cloudlet requires a cancellation source factory');
  const identity = `cloudlet-${++nextController}` as ControllerIdentity;
  const records = new Map<string, RecordState<Slot>>();
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(event: SemanticEvent) => void>();
  const operationSubscriptions = new Map<Set<() => void>, Delivery>();
  const globalPauses = new Set<PauseReason>();
  const batches: (() => void)[] = [];
  let focused: NotificationHandle | null = null;
  let focusRequest: FocusRequest | null = null;
  let lease: HostLease | null = null;
  let lastLease: HostLease | null = null;
  let serial = 0;
  let autoId = 0;
  let revision = 0;
  let eventSequence = 0;
  let island: IslandState<Slot> | null = null;
  // The presented record: Island current when open, otherwise the newest record.
  let presented: RecordState<Slot> | null = null;
  let hostDelay: number | undefined;
  /** `Toaster autoDismiss`: overrides ControllerOptions.autoDismiss while defined and attached. */
  let hostAutoDismiss: boolean | undefined;
  let attention: AttentionCandidate<Slot> | null = null;
  let cancelAttention: Unsubscribe | null = null;
  let attentionEpoch = 0;
  let overflow = 0;
  let overflowAnnounced = 0;
  let disposed = false;
  let delivering = false;
  let cancelTimer: Unsubscribe | null = null;
  let timerEpoch = 0;
  let snapshot: ControllerSnapshot<Slot>;
  let rendererSnapshot: RendererSnapshot<Slot>;

  const token = () => `${identity}:${++serial}`;
  // Map insertion order is admission order; the stack shows newest first.
  const stackOrder = () => [...records.values()].reverse();
  const newest = (): RecordState<Slot> | null => stackOrder()[0] ?? null;
  // A settled factory can always retry; only an unsuccessful attempt offers retry as an action.
  const retryable = (record: RecordState<Slot>) => {
    const operation = record.operation?.getSnapshot();
    return !!operation?.canRetry && operation.status !== 'fulfilled';
  };
  const requiresAction = (record: RecordState<Slot>) => !!record.content.action
    || retryable(record) || record.content.attention === 'open';
  const wantsAttention = (record: RecordState<Slot>) => {
    const rule = record.content.attention ?? 'auto';
    return rule === 'open' || (rule === 'auto' && (requiresAction(record) || !!record.content.description));
  };
  const interacting = () => globalPauses.has('hover') || globalPauses.has('focus')
    || [...records.values()].some((record) => record.pauses.has('gesture'));
  const pauses = (record: RecordState<Slot>): PauseReason[] => {
    const current = record === presented;
    return [
      ...(!current ? ['inactive' as const] : []),
      ...(lease === null ? ['no-host' as const] : []),
      ...(current && !record.readable ? ['presentation-pending' as const] : []),
      // An Island opened by the user, or a slide that asks for action, keeps its time.
      ...(current && island && (island.reason === 'user' || requiresAction(record)) ? ['island' as const] : []),
      ...(record.action.status === 'pending' ? ['action-pending' as const] : []),
      ...globalPauses, ...record.pauses,
    ];
  };
  const handleError = (handle: NotificationHandle): HandleRejection | 'disposed' | undefined => {
    if (disposed) return 'disposed';
    if (typeof handle !== 'object' || handle === null || !handles.has(handle)) return 'invalid-handle';
    if (handle.controller !== identity) return 'foreign-controller';
    if (records.get(handle.id)?.handle !== handle) return 'stale-handle';
    return undefined;
  };

  // Capability validation always precedes method-specific validation/mutation.
  function withRecord<Args extends unknown[], Result>(action: (record: RecordState<Slot>, ...args: Args) => Result) {
    return (handle: NotificationHandle, ...args: Args) => {
      const error = handleError(handle);
      return error ? reject(error) : action(records.get(handle.id)!, ...args);
    };
  }

  function diagnostic(diagnosticValue: Diagnostic): void {
    const value = freeze({ ...diagnosticValue });
    enqueue([{ type: 'diagnostic', diagnostic: value }]);
  }
  function failure(code: Diagnostic['code'], source: string, error: unknown, handle?: NotificationHandle): void {
    diagnostic({ code, source, message: `${source} failed`, error, ...(handle ? { handle } : {}) });
  }
  function notifyListeners(set: Set<() => void>, source: string): void {
    for (const listener of [...set]) {
      if (!set.has(listener)) continue;
      try { listener(); } catch (error) {
        failure('listener-error', source, error);
      }
    }
  }
  function enqueue(deliveries: readonly Delivery[], notify = false, at = clock.now(), final = false, release = false): void {
    batches.push(() => {
      if (notify) notifyListeners(listeners, 'subscribe');
      for (const delivery of deliveries) {
        if ('callback' in delivery) {
          try { delivery.callback(); } catch (error) {
            failure('callback-error', delivery.source, error, delivery.handle);
          }
          continue;
        }
        const event: SemanticEvent = freeze({ ...delivery, controller: identity, sequence: ++eventSequence,
          at: release ? clock.now() : at });
        for (const listener of [...eventListeners]) {
          if (!eventListeners.has(listener)) continue;
          try { listener(event); } catch (error) {
            if (event.type !== 'diagnostic') failure('listener-error', 'onEvent', error);
          }
        }
        if (event.type === 'diagnostic') {
          try { options.onDiagnostic?.(event.diagnostic); } catch { /* No recursive diagnostics. */ }
        }
      }
      // Close-callback diagnostics are queued before disposal releases observers.
      if (final) enqueue([{ type: 'disposed' }], false, at, false, true);
      if (release) {
        listeners.clear(); eventListeners.clear();
        for (const set of operationSubscriptions.keys()) set.clear();
        operationSubscriptions.clear();
      }
    });
    if (delivering) return;
    delivering = true;
    try {
      let batch: (() => void) | undefined;
      while ((batch = batches.shift())) batch();
    } finally { delivering = false; }
  }
  function settle(): number {
    const now = clock.now();
    for (const record of records.values()) {
      if (record.activeSince !== null && record.remaining !== null) {
        record.remaining = Math.max(0, record.remaining - Math.max(0, now - record.activeSince));
        record.activeSince = now;
      }
    }
    return now;
  }
  function stopTimer(): void {
    ++timerEpoch;
    cancelTimer?.();
    cancelTimer = null;
  }
  function schedule(now: number): void {
    stopTimer();
    let deadline = Infinity;
    for (const record of records.values()) {
      const active = record.remaining !== null && pauses(record).length === 0 && !disposed;
      record.activeSince = active ? now : null;
      if (active) deadline = Math.min(deadline, now + record.remaining!);
    }
    if (!Number.isFinite(deadline)) return;
    const epoch = timerEpoch;
    cancelTimer = clock.schedule(deadline, () => {
      if (disposed || epoch !== timerEpoch) return;
      const at = settle();
      const due = [...records.values()].filter((record) => record.activeSince !== null && record.remaining === 0);
      const deliveries: Delivery[] = [];
      for (const record of due) remove(record, 'timeout', deliveries);
      // An early delivery only rearms; a late delivery closes exactly the due generations.
      if (due.length) commit(deliveries, at);
      else schedule(at);
    });
  }
  function publish(): void {
    const current = [...records.values()];
    const notifications = freeze(current.map((record) => freeze({
      handle: record.handle, kind: record.kind, content: record.content, priority: record.priority,
      occurrences: record.occurrences, location: record === presented ? 'current' as const : 'stack' as const,
      remainingMs: record.remaining, pauseReasons: freeze(pauses(record)), operation: record.operation?.getSnapshot() ?? null, action: record.action,
    })));
    snapshot = freeze({ controller: identity, revision, disposed, notifications,
      stack: freeze(stackOrder().map((record) => record.handle)),
      island: island ? freeze({ open: true, reason: island.reason, current: island.current.handle }) : COLLAPSED,
      overflow: freeze({ count: overflow, pending: overflow > 0 }),
    });
    rendererSnapshot = freeze({ ...snapshot,
      presentation: presented ? freeze({ handle: presented.handle, token: presented.presentation, readable: presented.readable }) : null,
      focusRequest,
      announcements: freeze({ overflowCount: overflowAnnounced,
        notifications: freeze(current.map((record) => freeze({
          handle: record.handle, queued: record.queuedAnnounced, firstPresentation: record.firstAnnounced,
          occurrences: record.occurrencesAnnounced, action: record.actionAnnounced ?? null, operation: record.operation ? freeze({
            token: record.operation.getSnapshot().token, phases: freeze([...record.operationAnnounced]),
          }) : null,
        }))),
      }),
    });
  }
  function commit(deliveries: readonly Delivery[] = [], now = clock.now(), final = false): void {
    present();
    schedule(now);
    armAttention(now);
    ++revision;
    publish();
    enqueue(deliveries, true, now, final);
  }
  // Every state mutation settles the old budget, publishes once, then delivers.
  // The presented record is derived inside that transaction, before subscribers can reenter.
  function mutate(apply: (deliveries: Delivery[]) => void, final = false) {
    const now = settle();
    const deliveries: Delivery[] = [];
    apply(deliveries);
    commit(deliveries, now, final);
    return APPLIED;
  }
  function assign(record: RecordState<Slot>): void {
    record.readable = false;
    record.presentation = lease === null ? null : token() as PresentationToken;
  }
  function retire(record: RecordState<Slot>): void {
    record.presentation = null;
    record.readable = false;
    record.pauses.clear();
    if (focused === record.handle) focused = null;
    if (focusRequest?.target.kind === 'notification' && focusRequest.target.handle === record.handle) focusRequest = null;
  }
  /** A change of the presented record mints a new presentation token; its predecessor keeps its budget. */
  function present(): void {
    const next = island ? island.current : newest();
    if (next === presented) return;
    if (presented) retire(presented);
    presented = next;
    if (next) assign(next);
  }
  function stopAttention(): void {
    ++attentionEpoch;
    cancelAttention?.();
    cancelAttention = null;
  }
  /** Newest candidate wins: a new nomination replaces the pending one. */
  function nominate(record: RecordState<Slot>, now: number): void {
    if (wantsAttention(record)) attention = { record, due: now + (hostDelay ?? options.attentionDelay ?? ATTENTION_DELAY), waiting: false };
  }
  function armAttention(now: number): void {
    stopAttention();
    const candidate = attention;
    if (!candidate || disposed) return;
    // Without a host nothing has landed yet: wait without allocating a timer.
    if (lease === null) { candidate.waiting = true; return; }
    if (candidate.waiting) {
      if (interacting()) return;
      candidate.waiting = false;
      candidate.due = now + (hostDelay ?? options.attentionDelay ?? ATTENTION_DELAY);
    }
    const epoch = attentionEpoch;
    cancelAttention = clock.schedule(candidate.due, () => {
      if (disposed || epoch !== attentionEpoch || attention !== candidate) return;
      const at = clock.now();
      if (at < candidate.due) { armAttention(at); return; }
      cancelAttention = null;
      // Expiry during hover/focus/gesture waits; the next release restarts the delay.
      if (interacting()) { candidate.waiting = true; return; }
      attention = null;
      const record = candidate.record;
      if (!wantsAttention(record) || island?.current === record) return;
      mutate(() => {
        if (island) island.current = record;
        else island = { reason: 'attention', current: record };
      });
    });
  }
  const autoDismissing = (host: boolean | undefined) => (host ?? options.autoDismiss) !== false;
  /** Off stops every budget; on starts each one in full. */
  function setHostAutoDismiss(value: boolean | undefined): void {
    const changed = autoDismissing(value) !== autoDismissing(hostAutoDismiss);
    hostAutoDismiss = value;
    if (!changed) return;
    for (const record of records.values()) record.remaining = budget(record);
  }
  function budget(record: RecordState<Slot>): number | null {
    if (!autoDismissing(hostAutoDismiss)) return null;
    if (record.content.duration !== undefined) return record.content.duration;
    return (record.kind === 'info' || record.kind === 'success') && !record.content.action ? 6000 : null;
  }
  function remove(record: RecordState<Slot>, reason: CloseReason, deliveries: Delivery[]): void {
    if (island?.current === record) {
      // The next older slide, else the next newer one, else the Island closes.
      const order = stackOrder();
      const index = order.indexOf(record);
      const next = order[index + 1] ?? order[index - 1];
      if (next) island.current = next; else island = null;
    }
    if (attention?.record === record) attention = null;
    records.delete(record.handle.id);
    if (record.operation) deliveries.push(record.operation.detach());
    deliveries.push({ type: 'closed', handle: record.handle, reason });
    if (record.onClose) {
      const onClose = record.onClose;
      const notice = freeze({ handle: record.handle, reason });
      deliveries.push({ callback: () => onClose(notice), source: 'onClose', handle: record.handle });
    }
  }
  const dismiss = withRecord((record, reason: CloseReason) =>
    mutate((deliveries) => remove(record, reason, deliveries)));
  function acknowledgeOverflow() {
    if (disposed) return reject('disposed');
    if (!overflow) return UNCHANGED;
    return mutate((deliveries) => {
      deliveries.push({ type: 'overflow-acknowledged', count: overflow });
      overflow = overflowAnnounced = 0;
      if (focusRequest?.target.kind === 'overflow') focusRequest = null;
    });
  }
  function subscribe<T>(set: Set<T>, listener: T): Unsubscribe {
    if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
    if (disposed) return () => {};
    set.add(listener);
    return () => { set.delete(listener); };
  }
  function admit(spec: NotificationSpec<Slot>): AdmissionResult {
    if (disposed) return reject('disposed');
    const issues = validateSpec(spec);
    if (issues.length) {
      diagnostic({ code: 'invalid-input', source: 'show', message: 'Invalid notification specification' });
      return { ...reject('invalid-input'), issues };
    }
    return insert(spec);
  }
  function insert(spec: NotificationSpec<Slot>, initialize?: (record: RecordState<Slot>) => void): AdmissionResult {
    if (spec.id !== undefined && records.has(spec.id)) return reject('id-conflict');
    const existing = spec.dedupeKey === undefined ? undefined : [...records.values()].find((record) => record.dedupeKey === spec.dedupeKey);
    if (existing) {
      let occurrences = existing.occurrences;
      mutate((deliveries) => {
        occurrences = existing.occurrences = Math.min(Number.MAX_SAFE_INTEGER, occurrences + 1);
        deliveries.push({ type: 'deduplicated', handle: existing.handle, occurrences });
      });
      return { status: 'deduplicated', handle: existing.handle, occurrences };
    }
    if (records.size >= 100) {
      mutate((deliveries) => {
        overflow = Math.min(Number.MAX_SAFE_INTEGER, overflow + 1);
        const overflowValue = freeze({ count: overflow, pending: true });
        deliveries.push({ type: 'overflow', count: overflow });
        if (options.onOverflow) deliveries.push({ callback: () => options.onOverflow!(overflowValue), source: 'onOverflow' });
      });
      return reject('capacity');
    }
    const now = settle();
    let id = spec.id;
    if (id === undefined) { do { id = `${identity}:notification-${++autoId}`; } while (records.has(id)); }
    const handle = freeze({ id, controller: identity, generation: token() as Generation }) as NotificationHandle;
    handles.add(handle);
    const record: RecordState<Slot> = {
      handle: handle,
      dedupeKey: spec.dedupeKey,
      onClose: spec.onClose,
      content: copyContent(spec),
      kind: spec.kind ?? 'info',
      priority: spec.priority ?? 'normal',
      occurrences: 1,
      remaining: null,
      activeSince: null,
      presentation: null,
      readable: false,
      everPresented: false,
      pauses: new Set(),
      queuedAnnounced: false,
      firstAnnounced: false,
      occurrencesAnnounced: 0,
      operation: null,
      operationAnnounced: new Set(),
      action: IDLE,
    };
    record.remaining = budget(record);
    records.set(id, record);
    initialize?.(record);
    nominate(record, now);
    const deliveries: Delivery[] = [{ type: 'admitted', handle }];
    if (record.operation) {
      const operation = record.operation.getSnapshot();
      deliveries.push({ type: 'operation-started', handle, token: operation.token, attempt: operation.attempt });
    }
    commit(deliveries, now);
    return { status: 'created', handle };
  }
  function emit(deliveries: readonly Delivery[]): void {
    if (disposed) return;
    enqueue(deliveries);
  }
  function replaceContent(record: RecordState<Slot>, content: Readonly<NotificationContent<Slot>>, kind: NotificationKind): void {
    record.content = content;
    record.kind = kind;
    record.remaining = kind === 'loading' ? null : budget(record);
    // A replacement owns a new action context; old completions cannot close it.
    record.action = IDLE;
    if (record === presented) assign(record);
    // A runner phase (terminal result or new attempt) is evaluated like an admission.
    nominate(record, clock.now());
    if (focusRequest?.target.kind === 'notification' && focusRequest.target.handle === record.handle &&
        focusRequest.target.control === 'action' && !content.action) focusRequest = null;
  }
  function track<T>(source: OperationSource<T, Signal>, input: TrackOptions<T, Slot, Signal>): OperationHandle<T> {
    const factory = typeof source === 'function' ? source : null;
    let sourceThen: PromiseLike<T>['then'] | undefined;
    if (!factory && (source === null || typeof source !== 'object' || typeof (sourceThen = source.then) !== 'function')) {
      throw new TypeError('Operation source must be a factory or thenable');
    }
    const issues = validateTrackOptions(input, factory !== null);
    // Invalid presentation options cannot suppress a valid business source. Read
    // only data properties here; validation never executes option accessors.
    const field = (key: keyof TrackOptions<T, Slot, Signal>): unknown => input && typeof input === 'object'
      ? Object.getOwnPropertyDescriptor(input, key)?.value : undefined;
    const cancelValue = field('cancel');
    const cancelCallback = !factory && typeof cancelValue === 'function' ? cancelValue as (reason: unknown) => void : null;
    const classifierValue = field('isCancellation');
    const classifier = typeof classifierValue === 'function' ? classifierValue as NonNullable<TrackOptions<T, Slot, Signal>['isCancellation']> : null;
    const config = issues.length ? null : freeze({ ...input,
      pending: copyContent(input.pending),
      success: typeof input.success === 'function' ? input.success : copyContent(input.success),
      error: typeof input.error === 'function' ? input.error : copyContent(input.error),
      ...(input.cancelled === undefined ? {} : { cancelled: typeof input.cancelled === 'function' ? input.cancelled : copyContent(input.cancelled) }),
    });
    const subscribers = new Set<() => void>();
    let notification: NotificationHandle | null = null;
    let attached = false;
    let snapshotValue: OperationSnapshot;
    let attemptNumber = 0;
    type Attempt = {
      readonly public: OperationAttempt<T>;
      readonly context: OperationContext<Signal>;
      readonly abort: (reason?: unknown) => void;
      readonly resolve: (value: T | PromiseLike<T>) => void;
      readonly reject: (reason: unknown) => void;
      status: OperationStatus;
      cancelRequested: boolean;
    };
    function createAttempt(): Attempt {
      const cancellation = dependencies.createCancellation();
      const context = freeze({ signal: cancellation.signal, token: token() as OperationAttemptToken, attempt: ++attemptNumber });
      let resolve!: Attempt['resolve'];
      let fail!: Attempt['reject'];
      const result = new Promise<T>((fulfill, rejectResult) => { resolve = fulfill; fail = rejectResult; });
      const attempt: Attempt = {
        public: freeze({ token: context.token, attempt: context.attempt, result }), context,
        abort: cancellation.abort, resolve, reject: fail, status: 'pending', cancelRequested: false,
      };
      // Observe both branches without altering the public promise's value/reason.
      // The derived internal chain is handled as well, even if a platform port fails.
      void result.then((value) => finish(attempt, 'fulfilled', value), (error: unknown) => finish(attempt, 'rejected', error))
        .catch((error: unknown) => {
          if (!disposed) failure('callback-error', 'operation-settlement', error);
        });
      return attempt;
    }
    const first = createAttempt();
    let current = first;
    function getSnapshot(): OperationSnapshot {
      const next = {
        token: current.context.token, attempt: current.context.attempt, status: current.status,
        cancelRequested: current.cancelRequested,
        canCancel: !disposed && current.status === 'pending' && !current.cancelRequested && (!!factory || !!cancelCallback),
        canRetry: !disposed && !!factory && current.status !== 'pending',
        notification: attached && !disposed ? notification : null,
      };
      if (!snapshotValue || Object.keys(next).some((key) => next[key as keyof OperationSnapshot] !== snapshotValue[key as keyof OperationSnapshot])) {
        snapshotValue = freeze(next);
      }
      return snapshotValue;
    }
    const notify: Delivery = { source: 'operation.subscribe',
      callback: () => notifyListeners(subscribers, 'operation.subscribe') };
    function live(attempt: Attempt): RecordState<Slot> | undefined {
      if (disposed || current !== attempt || !attached || !notification) return undefined;
      const record = records.get(notification.id);
      return record?.handle === notification && record.operation === binding ? record : undefined;
    }
    function run(attempt: Attempt): void {
      // Validate and assimilate the same then method once, preserving its receiver.
      // Reading a user accessor again could replace the business outcome.
      try { attempt.resolve(factory ? factory(attempt.context) : { then: sourceThen!.bind(source) }); }
      catch (error) { attempt.reject(error); }
    }
    function deliver(deliveries: Delivery[], apply?: () => void): void {
      if (apply) {
        const now = settle();
        apply();
        commit(deliveries, now);
      } else emit(deliveries);
    }
    function finish(attempt: Attempt, initialStatus: 'fulfilled' | 'rejected', value: unknown): void {
      attempt.status = initialStatus;
      if (initialStatus === 'rejected') {
        try {
          const cancelled = classifier ? classifier(value, attempt.context) === true
            : attempt.cancelRequested && value !== null && typeof value === 'object' && 'name' in value && value.name === 'AbortError';
          if (cancelled) attempt.status = 'cancelled';
        } catch (error) {
          if (!disposed) failure('cancellation-error', 'isCancellation', error);
        }
      }
      let content: Readonly<NotificationContent<Slot>> | undefined;
      if (live(attempt) && config) {
        const status = attempt.status;
        const fallback = status === 'fulfilled' ? options.messages?.operationSuccess ?? 'Completed'
          : status === 'cancelled' ? options.messages?.operationCancelled ?? 'Cancelled'
            : options.messages?.operationError ?? 'Something went wrong';
        try {
          const mapper = status === 'fulfilled' ? config.success : status === 'cancelled' ? config.cancelled : config.error;
          const mapped = typeof mapper === 'function' ? mapper(value as T) : mapper ?? { title: fallback };
          if (validateContent(mapped).length) throw new TypeError('Invalid terminal notification content');
          content = copyContent(mapped);
        } catch (error) {
          content = freeze({ title: fallback, announcementPriority: 'polite' });
          if (!disposed) failure('mapper-error', `track.${status}`, error, notification ?? undefined);
        }
      }
      // User mappers, classifiers and diagnostic listeners are reentrant.
      const record = live(attempt);
      const uiApplied = !!record && !!content;
      const deliveries: Delivery[] = [
        ...(current === attempt ? [notify] : []),
        { type: 'operation-settled', handle: notification, token: attempt.context.token, status: attempt.status, uiApplied },
      ];
      deliver(deliveries, record && content ? () => replaceContent(record, content,
        attempt.status === 'fulfilled' ? 'success' : attempt.status === 'cancelled' ? 'warning' : 'error') : undefined);
    }
    function requestCancellation(attempt: Attempt, reason: unknown): void {
      attempt.cancelRequested = true;
      const record = live(attempt);
      const deliveries: Delivery[] = [notify, { type: 'cancellation-requested', handle: notification, token: attempt.context.token }];
      deliver(deliveries, record ? () => {
        record.content = patchContent(record.content, { title: options.messages?.cancellationRequested ?? 'Cancellation requested' });
      } : undefined);
      try {
        attempt.abort(reason);
        cancelCallback?.(reason);
      } catch (error) {
        if (!disposed) failure('cancellation-error', 'cancel', error, notification ?? undefined);
      }
    }
    function cancellationReason(): Error {
      const error = new Error('Cancellation requested');
      error.name = 'AbortError';
      return error;
    }
    function cancel(reason: unknown = cancellationReason()): CancelResult {
      if (disposed) return reject('disposed');
      if (current.status !== 'pending') return { status: 'unchanged', reason: 'settled' };
      if (!factory && !cancelCallback) return reject('not-cancellable');
      if (current.cancelRequested) return { status: 'unchanged', reason: 'already-requested' };
      requestCancellation(current, reason);
      return { status: 'requested' };
    }
    function start(restart: boolean): AttemptStartResult<T> {
      if (disposed) return reject('disposed');
      if (!factory) return reject('not-retryable');
      if (current.status === 'pending' && !restart) return reject('already-pending');
      const previous = current;
      const next = createAttempt();
      current = next; // Invalidate old ownership before any observer or abort callback.
      const record = live(next);
      const deliveries: Delivery[] = [notify, { type: 'operation-started', handle: notification, token: next.context.token, attempt: next.context.attempt }];
      deliver(deliveries, record && config ? () => {
        record.operationAnnounced.clear();
        replaceContent(record, config.pending, 'loading');
      } : undefined);
      if (previous.status === 'pending' && !previous.cancelRequested) requestCancellation(previous, cancellationReason());
      run(next);
      return { status: 'started', attempt: next.public };
    }
    const binding: OperationBinding = {
      getSnapshot, retry: () => start(false), cancel,
      detach: () => { attached = false; return notify; },
    };
    let admission: OperationAdmissionResult;
    if (disposed) admission = reject('disposed');
    else if (!config) {
      admission = { ...reject('invalid-input'), issues };
      diagnostic({ code: 'invalid-input', source: 'track', message: 'Invalid operation options' });
    } else {
      const admitted = insert({ ...config.pending, ...config, kind: 'loading' }, (record) => {
        notification = record.handle;
        attached = true;
        record.operation = binding;
      });
      // No dedupe key can reach this path (validated TrackOptions).
      if (admitted.status === 'deduplicated') throw new Error('Tracked operation cannot be deduplicated');
      admission = admitted;
    }
    if (admission.status === 'rejected') emit([{ type: 'operation-started', handle: null, token: first.context.token, attempt: 1 }]);
    run(first);
    return freeze({ ...first.public, admission: freeze(admission), getSnapshot,
      subscribe(listener: () => void) {
        const unsubscribe = subscribe(subscribers, listener);
        if (subscribers.size) operationSubscriptions.set(subscribers, notify);
        return () => { unsubscribe(); if (!subscribers.size) operationSubscriptions.delete(subscribers); };
      },
      cancel, retry: () => start(false), restart: () => start(true),
    });
  }

  const controller = freeze<CloudletController<Slot, Signal>>({
    show: (spec) => admit(spec),
    track,
    update: withRecord((record, patch: NotificationPatch<Slot>) => {
      const handle = record.handle;
      const issues = validatePatch(patch);
      if (issues.length) {
        diagnostic({ code: 'invalid-input', source: 'update', message: 'Invalid notification patch', handle });
        return { ...reject('invalid-input'), issues };
      }
      if (record.action.status === 'pending' && Object.prototype.hasOwnProperty.call(patch, 'action')) return reject('action-pending');
      if (record.operation && (Object.prototype.hasOwnProperty.call(patch, 'kind') ||
          (record.operation.getSnapshot().status === 'pending' && Object.prototype.hasOwnProperty.call(patch, 'duration')))) return reject('operation-owned');
      const content = patchContent(record.content, patch);
      const kind = patch.kind ?? record.kind;
      const priority = patch.priority ?? record.priority;
      const durationChanged = Object.prototype.hasOwnProperty.call(patch, 'duration');
      if (content === record.content && kind === record.kind && priority === record.priority && !durationChanged &&
          !(Object.prototype.hasOwnProperty.call(patch, 'action') && record.action.status === 'failed')) return UNCHANGED;
      return mutate((deliveries) => {
        const previousBudget = budget(record);
        record.content = content;
        if (Object.prototype.hasOwnProperty.call(patch, 'action')) record.action = IDLE;
        record.kind = kind;
        record.priority = priority;
        const nextBudget = budget(record);
        if (durationChanged || previousBudget !== nextBudget) record.remaining = nextBudget;
        if (focusRequest?.target.kind === 'notification' && focusRequest.target.handle === handle && focusRequest.target.control === 'action' && !content.action) focusRequest = null;
        if (attention?.record === record && !wantsAttention(record)) attention = null;
        deliveries.push({ type: 'updated', handle });
      });
    }),
    getHandle: (id) => !disposed && typeof id === 'string' ? records.get(id)?.handle : undefined,
    dismiss: (handle) => dismiss(handle, 'programmatic'),
    clear() {
      if (disposed) return reject('disposed');
      const count = records.size;
      if (!count) return { status: 'cleared', count };
      mutate((deliveries) => {
        for (const record of records.values()) remove(record, 'clear', deliveries);
      });
      return { status: 'cleared', count };
    },
    requestFocus(target: FocusTarget = { kind: 'anchor' }) {
      if (disposed) return reject('disposed');
      if (target?.kind === 'notification') {
        const error = handleError(target.handle);
        if (error) return reject(error);
      }
      if (!lease) return reject('no-host');
      if (!target || !['anchor', 'notification', 'overflow'].includes(target.kind)) return reject('unavailable');
      if (target.kind === 'notification') {
        const record = records.get(target.handle.id)!;
        if (record !== presented) return reject('not-visible');
        if (target.control !== undefined && !['action', 'close'].includes(target.control)) return reject('unavailable');
        if (target.control === 'action' && !record.content.action) return reject('unavailable');
        // Card controls exist only inside the open Island; the collapsed pill has none.
        if (target.control !== undefined && !island) return reject('not-visible');
      }
      if (target.kind === 'overflow' && !overflow) return reject('unavailable');
      mutate(() => {
        const copied: FocusTarget = target.kind === 'notification'
          ? freeze({ kind: target.kind, handle: target.handle, ...(target.control ? { control: target.control } : {}) })
          : freeze({ kind: target.kind });
        focusRequest = freeze({ token: token() as FocusRequestToken, target: copied });
      });
      return { status: 'requested' };
    },
    acknowledgeOverflow,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => SERVER,
    subscribe: (listener) => subscribe(listeners, listener),
    onEvent: (listener) => subscribe(eventListeners, listener),
    dispose() {
      if (disposed) return;
      mutate((deliveries) => {
        disposed = true;
        for (const record of records.values()) remove(record, 'dispose', deliveries);
        // Detached/admission-rejected handles also lose their capabilities.
        for (const notify of operationSubscriptions.values()) if (!deliveries.includes(notify)) deliveries.push(notify);
        lease = lastLease = null;
        island = null;
        attention = null;
        stopAttention();
        focusRequest = null;
        globalPauses.clear();
        overflow = overflowAnnounced = 0;
      }, true);
    },
  });

  publish();
  kernels.set(controller, freeze<ControllerKernel<Slot>>({
    options, clock, records, globalPauses, subscribe: controller.subscribe, onEvent: controller.onEvent,
    get disposed() { return disposed; },
    get presented() { return presented; },
    get rendererSnapshot() { return rendererSnapshot; },
    get overflow() { return overflow; },
    get lease() { return lease; }, set lease(value) { lease = value; },
    get lastLease() { return lastLease; }, set lastLease(value) { lastLease = value; },
    get hostDelay() { return hostDelay; }, set hostDelay(value) { hostDelay = value; },
    get hostAutoDismiss() { return hostAutoDismiss; }, set hostAutoDismiss(value) { hostAutoDismiss = value; },
    get island() { return island; }, set island(value) { island = value; },
    get attention() { return attention; }, set attention(value) { attention = value; },
    get focusRequest() { return focusRequest; }, set focusRequest(value) { focusRequest = value; },
    get focused() { return focused; }, set focused(value) { focused = value; },
    get overflowAnnounced() { return overflowAnnounced; }, set overflowAnnounced(value) { overflowAnnounced = value; },
    token, diagnostic, failure, mutate, commit, settle, assign, newest, handleError, withRecord,
    autoDismissing, setHostAutoDismiss, dismiss, acknowledgeOverflow,
    reportRendererLoadError(error) {
      if (!disposed) diagnostic({ code: 'renderer-load-error', source: 'Toaster', message: 'Toaster renderer failed to load', error });
    },
  }) as ControllerKernel<unknown>);
  return controller;
}
