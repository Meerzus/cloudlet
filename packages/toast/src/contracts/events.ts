import type { ActionAttemptToken, ControllerIdentity, NotificationHandle, OperationAttemptToken } from './identity.js';
import type { CloseReason } from './notifications.js';
import type { OperationStatus } from './operations.js';

export type DiagnosticCode =
  | 'invalid-input'
  | 'second-host'
  | 'stale-host'
  | 'mapper-error'
  | 'callback-error'
  | 'listener-error'
  | 'cancellation-error'
  | 'slot-error'
  | 'formatter-error'
  | 'invalid-container'
  | 'renderer-load-error';

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly source: string;
  readonly message: string;
  readonly handle?: NotificationHandle;
  readonly error?: unknown;
}

/**
 * Who caused a change.
 *
 * - `user`: a person, through the `Toaster` on screen: a click, a swipe, a key.
 * - `agent`: a step an agent took through `@cloudlet/toast/agent`.
 * - `app`: the application's own code, through the controller or an operation handle.
 * - `system`: Cloudlet itself: a timer, the outcome of an operation, `dispose()`.
 */
export type ChangeSource = 'user' | 'agent' | 'app' | 'system';

export interface EventBase {
  readonly controller: ControllerIdentity;
  /**
   * Who caused the event. Both outcomes of an action attempt carry the source of whoever pressed
   * it, however long the action ran; the outcome of an operation is always `system`.
   */
  readonly source: ChangeSource;
  readonly sequence: number;
  /** Monotonic milliseconds, not wall-clock time. */
  readonly at: number;
}

export type SemanticEvent = EventBase & (
  | { readonly type: 'admitted'; readonly handle: NotificationHandle }
  | { readonly type: 'deduplicated'; readonly handle: NotificationHandle; readonly occurrences: number }
  | { readonly type: 'updated'; readonly handle: NotificationHandle }
  | { readonly type: 'closed'; readonly handle: NotificationHandle; readonly reason: CloseReason }
  | { readonly type: 'presented'; readonly handle: NotificationHandle; readonly firstPresentation: boolean }
  | { readonly type: 'operation-started'; readonly handle: NotificationHandle | null; readonly token: OperationAttemptToken; readonly attempt: number }
  | { readonly type: 'operation-settled'; readonly handle: NotificationHandle | null; readonly token: OperationAttemptToken; readonly status: Exclude<OperationStatus, 'pending'>; readonly uiApplied: boolean }
  | { readonly type: 'cancellation-requested'; readonly handle: NotificationHandle | null; readonly token: OperationAttemptToken }
  | { readonly type: 'action-started'; readonly handle: NotificationHandle; readonly token: ActionAttemptToken }
  | { readonly type: 'action-failed'; readonly handle: NotificationHandle; readonly token: ActionAttemptToken; readonly message: string }
  | { readonly type: 'overflow'; readonly count: number }
  | { readonly type: 'overflow-acknowledged'; readonly count: number }
  | { readonly type: 'diagnostic'; readonly diagnostic: Diagnostic }
  | { readonly type: 'disposed' }
);
