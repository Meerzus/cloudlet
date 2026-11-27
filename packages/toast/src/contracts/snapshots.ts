import type { ChangeSource } from './events.js';
import type { ActionAttemptToken, ControllerIdentity, NotificationHandle } from './identity.js';
import type { NotificationContent, NotificationKind, OverflowSnapshot, Priority } from './notifications.js';
import type { OperationSnapshot } from './operations.js';

export type PauseReason =
  | 'inactive'
  | 'no-host'
  | 'presentation-pending'
  | 'hover'
  | 'focus'
  | 'gesture'
  | 'action-pending'
  | 'content-transition'
  | 'island'
  | 'draft'
  | 'document-hidden'
  | 'window-blur';

export type ActionSnapshot =
  | { readonly status: 'idle' }
  | { readonly status: 'pending'; readonly token: ActionAttemptToken }
  | { readonly status: 'failed'; readonly token: ActionAttemptToken; readonly message: string };

/** `current` is the one presented record: the top pill when collapsed, `island.current` when open. */
export type NotificationLocation = 'stack' | 'current';

export interface NotificationSnapshot<Slot = never> {
  readonly handle: NotificationHandle;
  readonly kind: NotificationKind;
  readonly content: Readonly<NotificationContent<Slot>>;
  readonly priority: Priority;
  readonly occurrences: number;
  readonly location: NotificationLocation;
  readonly remainingMs: number | null;
  readonly pauseReasons: readonly PauseReason[];
  readonly operation: OperationSnapshot | null;
  readonly action: ActionSnapshot;
  /** A form action whose values differ from their defaults. The values stay inside Cloudlet. */
  readonly draft: boolean;
}

export type IslandReason = 'user' | 'attention';

export interface IslandSnapshot {
  readonly open: boolean;
  /** Null exactly when the Island is closed. */
  readonly reason: IslandReason | null;
  /** Null exactly when the Island is closed. */
  readonly current: NotificationHandle | null;
  /**
   * Who opened the Island or moved it to its current notification last: `user` by hand, `system`
   * when it opened for attention on its own, `agent` for an agent's step or its request for a
   * person. When the current notification closed and the Island moved on, whoever closed it.
   * Null exactly when the Island is closed.
   */
  readonly source: ChangeSource | null;
}

export interface ControllerSnapshot<Slot = never> {
  readonly controller: ControllerIdentity | null;
  readonly revision: number;
  readonly disposed: boolean;
  /** Admission order, oldest first. */
  readonly notifications: readonly NotificationSnapshot<Slot>[];
  /** The same records in presentation order: newest first, index 0 is the top pill. */
  readonly stack: readonly NotificationHandle[];
  readonly island: IslandSnapshot;
  readonly overflow: OverflowSnapshot;
}
