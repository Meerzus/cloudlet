/** Opaque identities are minted by a controller, never reconstructed from IDs. */
declare const controllerBrand: unique symbol;
declare const generationBrand: unique symbol;
declare const notificationBrand: unique symbol;
declare const attemptBrand: unique symbol;
declare const actionBrand: unique symbol;

export type ControllerIdentity = string & { readonly [controllerBrand]: never };
export type Generation = string & { readonly [generationBrand]: never };
export type OperationAttemptToken = string & { readonly [attemptBrand]: never };
export type ActionAttemptToken = string & { readonly [actionBrand]: never };

export interface NotificationHandle {
  readonly id: string;
  readonly controller: ControllerIdentity;
  readonly generation: Generation;
  readonly [notificationBrand]: never;
}

export type Unsubscribe = () => void;

export type HandleRejection = 'invalid-handle' | 'foreign-controller' | 'stale-handle';

export interface InputIssue {
  readonly path: string;
  readonly message: string;
}
