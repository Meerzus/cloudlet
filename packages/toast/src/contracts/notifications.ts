import type { ActionAttemptToken, InputIssue, NotificationHandle } from './identity.js';

export type NotificationKind = 'info' | 'success' | 'loading' | 'warning' | 'error';
export type Priority = 'normal' | 'high';
export type AnnouncementPriority = 'polite' | 'assertive' | 'off';
export type Duration = number | null;
/** Auto-open rule: `auto` opens for an action, a retryable operation or a description; `open` always; `stack` never. */
export type Attention = 'auto' | 'open' | 'stack';

/** Core treats Slot as opaque and never traverses or freezes its payload. */
export type Description<Slot = never> =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'rich'; readonly content: Slot; readonly announcement: string };

export type Progress =
  | { readonly kind: 'indeterminate'; readonly label?: string }
  | { readonly kind: 'determinate'; readonly value: number; readonly label?: string };

export interface ActionContext {
  readonly handle: NotificationHandle;
  readonly token: ActionAttemptToken;
}

export interface CommandAction {
  readonly kind: 'command';
  readonly label: string;
  readonly run: (context: ActionContext) => unknown;
  readonly errorMessage?: (error: unknown) => string;
}

export interface NavigationAction {
  readonly kind: 'link';
  readonly label: string;
  readonly href: string;
  readonly target?: '_self' | '_blank' | '_parent' | '_top';
  readonly rel?: string;
}

export type FormFieldKind = 'text' | 'textarea';
export type FormInputMode = 'text' | 'email' | 'numeric' | 'decimal' | 'tel' | 'url' | 'search';

/** One field of a form action. `label` is read by screen readers; the placeholder falls back to it. */
export interface FormField<Name extends string = string> {
  readonly name: Name;
  readonly kind: FormFieldKind;
  readonly label: string;
  readonly placeholder?: string;
  readonly defaultValue?: string;
  readonly required?: boolean;
  readonly maxLength?: number;
  readonly autoComplete?: string;
  readonly inputMode?: FormInputMode;
}

/** Field values as typed, without trimming. */
export type FormValues<Name extends string = string> = Readonly<Record<Name, string>>;

export interface FormContext<Name extends string = string> extends ActionContext {
  readonly values: FormValues<Name>;
}

/** `true` accepts; a string is a message under the form; an object holds messages under fields. */
export type FormValidation<Name extends string = string> = true | string | Readonly<Partial<Record<Name, string>>>;

/** A form in the Island: one to three fields and a submit button with command semantics. */
export interface FormAction<Name extends string = string> {
  readonly kind: 'form';
  readonly fields: readonly FormField<Name>[];
  /** The submit button's accessible name, like the label of a command. */
  readonly label: string;
  // Methods, not function properties: a form typed with its field names stays assignable to `FormAction`.
  run(context: FormContext<Name>): unknown;
  errorMessage?(error: unknown): string;
  /** Runs on submit after `required` and `maxLength`. */
  validate?(values: FormValues<Name>): FormValidation<Name>;
}

export type PrimaryAction<Name extends string = string> = CommandAction | NavigationAction | FormAction<Name>;

export interface NotificationContent<Slot = never, Name extends string = string> {
  readonly title: string;
  readonly description?: Description<Slot>;
  readonly icon?: Slot;
  readonly progress?: Progress;
  readonly action?: PrimaryAction<Name>;
  readonly announcementPriority?: AnnouncementPriority;
  /** Omitted = policy default; null = persistent; number = readable milliseconds. */
  readonly duration?: Duration;
  /** Omitted = `auto`. */
  readonly attention?: Attention;
}

export type CloseReason =
  | 'timeout'
  | 'programmatic'
  | 'close-button'
  | 'swipe'
  | 'action-success'
  | 'navigation'
  | 'clear'
  | 'dispose';

export interface CloseNotice {
  readonly handle: NotificationHandle;
  readonly reason: CloseReason;
}

export interface NotificationSpec<Slot = never, Name extends string = string> extends NotificationContent<Slot, Name> {
  readonly id?: string;
  readonly kind?: NotificationKind;
  readonly priority?: Priority;
  readonly dedupeKey?: string;
  readonly onClose?: (notice: CloseNotice) => void;
}

/** Omitted preserves; null removes optional content. IDs/dedupe keys are immutable. */
export interface NotificationPatch<Slot = never, Name extends string = string> {
  readonly title?: string;
  readonly kind?: NotificationKind;
  readonly description?: Description<Slot> | null;
  readonly icon?: Slot | null;
  readonly progress?: Progress | null;
  readonly action?: PrimaryAction<Name> | null;
  readonly priority?: Priority;
  readonly announcementPriority?: AnnouncementPriority;
  readonly duration?: Duration;
  readonly attention?: Attention;
}

export type AdmissionRejection = 'disposed' | 'invalid-input' | 'id-conflict' | 'capacity';

export type AdmissionResult =
  | { readonly status: 'created'; readonly handle: NotificationHandle }
  | { readonly status: 'deduplicated'; readonly handle: NotificationHandle; readonly occurrences: number }
  | { readonly status: 'rejected'; readonly reason: AdmissionRejection; readonly issues?: readonly InputIssue[] };

/** Track never participates in deduplication. */
export type OperationAdmissionResult = Exclude<AdmissionResult, { readonly status: 'deduplicated' }>;

export interface OverflowSnapshot {
  readonly count: number;
  readonly pending: boolean;
}
