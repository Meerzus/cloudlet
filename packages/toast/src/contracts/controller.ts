import type { Diagnostic, SemanticEvent } from './events.js';
import type { HandleRejection, InputIssue, NotificationHandle, Unsubscribe } from './identity.js';
import type { AdmissionResult, NotificationPatch, NotificationSpec, OverflowSnapshot } from './notifications.js';
import type { CancellationSignal, OperationHandle, OperationSource, TrackOptions } from './operations.js';
import type { ControllerSnapshot } from './snapshots.js';

export interface FallbackMessages {
  readonly operationSuccess: string;
  readonly operationError: string;
  readonly operationCancelled: string;
  readonly cancellationRequested: string;
  readonly actionError: string;
  readonly renderError: string;
}

export interface ControllerOptions {
  readonly autoDismiss?: boolean;
  /** Auto-open delay after admission, in milliseconds; default 600. A host may override it. */
  readonly attentionDelay?: number;
  readonly messages?: Partial<FallbackMessages>;
  readonly onOverflow?: (overflow: OverflowSnapshot) => void;
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void;
}

export type MutationRejection = HandleRejection | 'disposed' | 'invalid-input' | 'action-pending' | 'operation-owned';
export type MutationResult =
  | { readonly status: 'applied' }
  | { readonly status: 'unchanged' }
  | { readonly status: 'rejected'; readonly reason: MutationRejection; readonly issues?: readonly InputIssue[] };

export type FocusTarget =
  | { readonly kind: 'anchor' }
  | { readonly kind: 'notification'; readonly handle: NotificationHandle; readonly control?: 'action' | 'close' }
  | { readonly kind: 'overflow' };

export type FocusResult =
  | { readonly status: 'requested' }
  | { readonly status: 'rejected'; readonly reason: HandleRejection | 'disposed' | 'no-host' | 'not-visible' | 'unavailable' };

export type ClearResult =
  | { readonly status: 'cleared'; readonly count: number }
  | { readonly status: 'rejected'; readonly reason: 'disposed' };

export interface CloudletController<Slot = never, Signal extends CancellationSignal = CancellationSignal> {
  readonly show: (spec: NotificationSpec<Slot>) => AdmissionResult;
  readonly update: (handle: NotificationHandle, patch: NotificationPatch<Slot>) => MutationResult;
  readonly getHandle: (id: string) => NotificationHandle | undefined;
  readonly track: <T>(source: OperationSource<T, Signal>, options: TrackOptions<T, Slot, Signal>) => OperationHandle<T>;
  readonly dismiss: (handle: NotificationHandle) => MutationResult;
  readonly clear: () => ClearResult;
  readonly requestFocus: (target?: FocusTarget) => FocusResult;
  readonly acknowledgeOverflow: () => MutationResult;
  readonly getSnapshot: () => ControllerSnapshot<Slot>;
  readonly getServerSnapshot: () => ControllerSnapshot<Slot>;
  readonly subscribe: (listener: () => void) => Unsubscribe;
  readonly onEvent: (listener: (event: SemanticEvent) => void) => Unsubscribe;
  readonly dispose: () => void;
}

/** Notification-only view of a controller, useful to consumers that do not track operations. */
export type NotificationController<Slot = never> = Omit<CloudletController<Slot>, 'track'>;
