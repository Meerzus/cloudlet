/** Package-private contracts; never exported from the package entrypoint. */
import type { CloudletController, ControllerOptions, FocusTarget, MutationResult } from './controller.js';
import type { Diagnostic, SemanticEvent } from './events.js';
import type { ActionAttemptToken, HandleRejection, NotificationHandle, OperationAttemptToken, Unsubscribe } from './identity.js';
import type { CloseReason } from './notifications.js';
import type { CancellationSignal } from './operations.js';
import type { ControllerSnapshot, IslandReason } from './snapshots.js';

declare const leaseBrand: unique symbol;
declare const presentationBrand: unique symbol;
declare const focusBrand: unique symbol;

export type HostLease = string & { readonly [leaseBrand]: never };
export type PresentationToken = string & { readonly [presentationBrand]: never };
export type FocusRequestToken = string & { readonly [focusBrand]: never };

export interface MonotonicClock {
  readonly now: () => number;
  /** Absolute deadline; never invokes callback synchronously. Cancellation is idempotent. */
  readonly schedule: (deadline: number, callback: () => void) => Unsubscribe;
}

export interface CancellationSource<Signal extends CancellationSignal = CancellationSignal> {
  readonly signal: Signal;
  readonly abort: (reason?: unknown) => void;
}

export interface ControllerDependencies<Signal extends CancellationSignal = CancellationSignal> {
  readonly clock: MonotonicClock;
  readonly createCancellation: () => CancellationSource<Signal>;
}

export type CreateCloudletCore = <Slot = never, Signal extends CancellationSignal = CancellationSignal>(options: ControllerOptions | undefined, dependencies: ControllerDependencies<Signal>) => CloudletController<Slot, Signal>;

/** Stable package-private lookup for controllers minted by this package instance. */
export type GetRendererBridge = <Slot, Signal extends CancellationSignal>(controller: CloudletController<Slot, Signal>) => RendererBridge<Slot>;

/** Per-attachment settings; omitted fields fall back to ControllerOptions. */
export interface HostOptions {
  /** Finite nonnegative milliseconds; overrides ControllerOptions.attentionDelay while attached. */
  readonly attentionDelay?: number;
}

/** The single presented record (`location: 'current'`) and its presentation token. */
export interface RendererPresentation {
  readonly handle: NotificationHandle;
  /** Null without an active host. */
  readonly token: PresentationToken | null;
  readonly readable: boolean;
}

export interface FocusRequest {
  readonly token: FocusRequestToken;
  readonly target: FocusTarget;
}

export type OperationAnnouncementPhase = 'started' | 'fulfilled' | 'rejected' | 'cancelled' | 'cancel-requested';

export interface NotificationAnnouncementLedger {
  readonly handle: NotificationHandle;
  readonly queued: boolean;
  readonly firstPresentation: boolean;
  readonly occurrences: number;
  readonly action: { readonly token: ActionAttemptToken; readonly status: 'pending' | 'failed' } | null;
  readonly operation: {
    readonly token: OperationAttemptToken;
    readonly phases: readonly OperationAnnouncementPhase[];
  } | null;
}

export interface AnnouncementLedgerSnapshot {
  readonly notifications: readonly NotificationAnnouncementLedger[];
  readonly overflowCount: number;
}

export type AnnouncementAcknowledgement =
  | { readonly kind: 'queued' | 'first-presentation'; readonly handle: NotificationHandle }
  | { readonly kind: 'occurrences'; readonly handle: NotificationHandle; readonly count: number }
  | { readonly kind: 'action'; readonly handle: NotificationHandle; readonly token: ActionAttemptToken; readonly status: 'pending' | 'failed' }
  | { readonly kind: 'operation'; readonly handle: NotificationHandle; readonly token: OperationAttemptToken; readonly phase: OperationAnnouncementPhase }
  | { readonly kind: 'overflow'; readonly count: number };

export interface RendererSnapshot<Slot = never> extends ControllerSnapshot<Slot> {
  readonly presentation: RendererPresentation | null;
  readonly focusRequest: FocusRequest | null;
  readonly announcements: AnnouncementLedgerSnapshot;
}

export type AttachResult =
  | { readonly status: 'attached'; readonly lease: HostLease }
  | { readonly status: 'rejected'; readonly reason: 'disposed' | 'host-exists' | 'invalid-input' };

export type BridgeRejection = HandleRejection | 'disposed' | 'stale-lease' | 'not-current' | 'stale-presentation' | 'stale-operation-token' | 'stale-focus-request' | 'invalid-input' | 'empty' | 'island-closed';
export type BridgeResult =
  | { readonly status: 'applied' }
  | { readonly status: 'unchanged' }
  | { readonly status: 'rejected'; readonly reason: BridgeRejection };

export type PauseChange =
  | { readonly scope: 'host'; readonly reason: 'hover' | 'focus' | 'document-hidden' | 'window-blur'; readonly active: boolean }
  /** Island navigation (swipe/drag) is reported as `gesture` on the current record. */
  | { readonly scope: 'notification'; readonly handle: NotificationHandle; readonly reason: 'gesture' | 'content-transition'; readonly active: boolean };

export type RendererCloseReason = Extract<CloseReason, 'close-button' | 'swipe' | 'navigation'>;

export type ActionResult =
  | { readonly status: 'started' }
  | { readonly status: 'rejected'; readonly reason: BridgeRejection | 'no-command' | 'already-pending' };

export type RetryOperationResult =
  | { readonly status: 'started'; readonly token: OperationAttemptToken }
  | { readonly status: 'rejected'; readonly reason: BridgeRejection | 'not-retryable' | 'already-pending' | 'no-operation' };

export type CancelOperationResult =
  | { readonly status: 'requested' }
  | { readonly status: 'unchanged'; readonly reason: 'already-requested' | 'settled' }
  | { readonly status: 'rejected'; readonly reason: BridgeRejection | 'not-cancellable' | 'no-operation' };

export interface RendererBridge<Slot = never> {
  /** Immutable presentation fallback; user options remain controller-owned. */
  readonly renderError: string;
  /** A rejected portal has no lease. This reports without acquiring host ownership. */
  readonly reportInvalidContainer: (message: string, error?: unknown) => void;
  readonly attach: (options?: HostOptions) => AttachResult;
  readonly detach: (lease: HostLease) => BridgeResult;
  readonly getSnapshot: () => RendererSnapshot<Slot>;
  readonly getServerSnapshot: () => RendererSnapshot<Slot>;
  readonly subscribe: (listener: () => void) => Unsubscribe;
  readonly onEvent: (listener: (event: SemanticEvent) => void) => Unsubscribe;
  /** Without handle current becomes the top record. When already open only current changes. */
  readonly openIsland: (lease: HostLease, reason: IslandReason, handle?: NotificationHandle) => BridgeResult;
  readonly collapseIsland: (lease: HostLease) => BridgeResult;
  /** Overrides ControllerOptions.autoDismiss while attached; undefined restores it. */
  readonly setAutoDismiss: (lease: HostLease, value?: boolean) => BridgeResult;
  readonly navigate: (lease: HostLease, handle: NotificationHandle) => BridgeResult;
  readonly setPause: (lease: HostLease, change: PauseChange) => BridgeResult;
  readonly setFocused: (lease: HostLease, handle: NotificationHandle | null) => BridgeResult;
  readonly beginPresentation: (lease: HostLease, handle: NotificationHandle, previous: PresentationToken) =>
    | { readonly status: 'started'; readonly token: PresentationToken }
    | { readonly status: 'rejected'; readonly reason: BridgeRejection };
  readonly acknowledgePresentation: (lease: HostLease, handle: NotificationHandle, token: PresentationToken) => BridgeResult;
  readonly acknowledgeFocus: (lease: HostLease, token: FocusRequestToken, outcome: 'focused' | 'unavailable') => BridgeResult;
  readonly acknowledgeOverflow: (lease: HostLease) => BridgeResult;
  readonly acknowledgeAnnouncements: (lease: HostLease, acknowledgements: readonly AnnouncementAcknowledgement[]) => BridgeResult;
  readonly dismiss: (lease: HostLease, handle: NotificationHandle, reason: RendererCloseReason) => MutationResult | { readonly status: 'rejected'; readonly reason: 'stale-lease' };
  readonly invokeAction: (lease: HostLease, handle: NotificationHandle) => ActionResult;
  readonly retryOperation: (lease: HostLease, handle: NotificationHandle, expected: OperationAttemptToken) => RetryOperationResult;
  readonly cancelOperation: (lease: HostLease, handle: NotificationHandle, expected: OperationAttemptToken, reason?: unknown) => CancelOperationResult;
  readonly reportDiagnostic: (lease: HostLease, diagnostic: Diagnostic) => BridgeResult;
}
