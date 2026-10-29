import type { NotificationHandle, OperationAttemptToken, Unsubscribe } from './identity.js';
import type { NotificationContent, OperationAdmissionResult, Priority, CloseNotice } from './notifications.js';

/** Minimal abort port: native AbortSignal can implement it; core requires no DOM lib. */
export interface CancellationSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  readonly throwIfAborted: () => void;
  readonly addEventListener: (type: 'abort', listener: () => void, options?: { readonly once?: boolean }) => void;
  readonly removeEventListener: (type: 'abort', listener: () => void) => void;
}

export interface OperationContext<Signal extends CancellationSignal = CancellationSignal> {
  readonly signal: Signal;
  readonly token: OperationAttemptToken;
  readonly attempt: number;
}

export type OperationFactory<T, Signal extends CancellationSignal = CancellationSignal> = (context: OperationContext<Signal>) => T | PromiseLike<T>;
export type OperationSource<T, Signal extends CancellationSignal = CancellationSignal> = PromiseLike<T> | OperationFactory<T, Signal>;
export type OperationStatus = 'pending' | 'fulfilled' | 'rejected' | 'cancelled';

export interface OperationSnapshot {
  readonly token: OperationAttemptToken;
  readonly attempt: number;
  readonly status: OperationStatus;
  readonly cancelRequested: boolean;
  readonly canCancel: boolean;
  readonly canRetry: boolean;
  readonly notification: NotificationHandle | null;
}

export interface TrackOptions<T, Slot = never, Signal extends CancellationSignal = CancellationSignal> {
  readonly id?: string;
  readonly priority?: Priority;
  readonly pending: Omit<NotificationContent<Slot>, 'duration'> & { readonly duration?: never };
  readonly success: NotificationContent<Slot> | ((value: T) => NotificationContent<Slot>);
  readonly error: NotificationContent<Slot> | ((error: unknown) => NotificationContent<Slot>);
  readonly cancelled?: NotificationContent<Slot> | ((reason: unknown) => NotificationContent<Slot>);
  /** Optional cooperative cancellation for an already-created promise. */
  readonly cancel?: (reason: unknown) => void;
  readonly isCancellation?: (error: unknown, context: OperationContext<Signal>) => boolean;
  readonly onClose?: (notice: CloseNotice) => void;
  readonly dedupeKey?: never;
}

export interface OperationAttempt<T> {
  readonly token: OperationAttemptToken;
  readonly attempt: number;
  /** Preserves the business value/rejection, including cancellation rejection. */
  readonly result: Promise<T>;
}

export type AttemptStartResult<T> =
  | { readonly status: 'started'; readonly attempt: OperationAttempt<T> }
  | { readonly status: 'rejected'; readonly reason: 'disposed' | 'not-retryable' | 'already-pending' };

export type CancelResult =
  | { readonly status: 'requested' }
  | { readonly status: 'unchanged'; readonly reason: 'already-requested' | 'settled' }
  | { readonly status: 'rejected'; readonly reason: 'disposed' | 'not-cancellable' };

export interface OperationHandle<T> extends OperationAttempt<T> {
  /** Initial admission is immutable, independent of every attempt's result. */
  readonly admission: OperationAdmissionResult;
  readonly getSnapshot: () => OperationSnapshot;
  readonly subscribe: (listener: () => void) => Unsubscribe;
  readonly cancel: (reason?: unknown) => CancelResult;
  readonly retry: () => AttemptStartResult<T>;
  readonly restart: () => AttemptStartResult<T>;
}
