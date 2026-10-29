'use client';

import type { ReactElement, ReactNode } from 'react';
import type { CloudletController, ControllerOptions, FocusTarget } from './contracts/controller.js';
import type { NotificationHandle } from './contracts/identity.js';
import type { NotificationPatch, NotificationSpec } from './contracts/notifications.js';
import type { OperationContext, OperationFactory, TrackOptions } from './contracts/operations.js';
import type { ControllerSnapshot, NotificationSnapshot } from './contracts/snapshots.js';

export type ReactNotificationSpec = NotificationSpec<ReactNode>;
export type ReactNotificationPatch = NotificationPatch<ReactNode>;
export type ReactCloudletController = CloudletController<ReactNode, AbortSignal>;
export type ReactOperationContext = OperationContext<AbortSignal>;
export type ReactOperationFactory<T> = OperationFactory<T, AbortSignal>;
export type ReactTrackOptions<T> = TrackOptions<T, ReactNode, AbortSignal>;

/** Public web factory signature, including native cancellation signals. */
export type CreateCloudlet = (options?: ControllerOptions) => ReactCloudletController;

export interface CloudletProviderProps {
  /** Null while an effect-owned controller does not exist yet (server render, first client render). */
  readonly controller: ReactCloudletController | null;
  readonly children?: ReactNode;
}

export interface EdgeInsets {
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly left?: number;
}

export interface ToasterOffsets {
  /** CSS px added outside safe area; omitting an edge uses the CSS viewport-gutter token. */
  readonly gutter?: EdgeInsets;
  /** Additional obstruction beyond safe area; never include safe-area size again. */
  readonly obstruction?: EdgeInsets;
}

export interface CloudletLabels {
  readonly region: string;
  /** Accessible name of the Island carousel region. */
  readonly island: string;
  /** Spoken role of the open Island (`aria-roledescription`), "carousel" by default. */
  readonly carousel: string;
  /** Spoken role of each slide in the Island (`aria-roledescription`), "slide" by default. */
  readonly slide: string;
  readonly close: string;
  readonly retry: string;
  readonly cancel: string;
  readonly cancellationRequested: string;
  readonly acknowledgeOverflow: string;
  /** Hidden hint that Escape collapses the Island. */
  readonly collapse: string;
  /** Name of the collapsed stack button: top title, records in the stack, missed notifications. */
  readonly stackSummary: (title: string, count: number, missed: number) => string;
  /** 1-based slide position. */
  readonly page: (index: number, total: number) => string;
  readonly overflowCount: (count: number) => string;
}

export interface AnnouncementFormatters {
  readonly notification: (notification: NotificationSnapshot<ReactNode>) => string;
  readonly queued: (count: number) => string;
  readonly occurrences: (notification: NotificationSnapshot<ReactNode>) => string;
  readonly overflow: (count: number) => string;
  readonly operation: (notification: NotificationSnapshot<ReactNode>, phase: 'started' | 'fulfilled' | 'rejected' | 'cancelled' | 'cancel-requested') => string;
  readonly actionError: (notification: NotificationSnapshot<ReactNode>, message: string) => string;
  /** Optional for compatibility with existing complete formatter objects. */
  readonly actionPending?: (notification: NotificationSnapshot<ReactNode>) => string;
  /** Current aggregate after returning from a hidden document; no event replay. */
  readonly resumed?: (count: number) => string;
}

export interface ToasterAttention {
  /** Milliseconds from admission before an auto-open; default 600. */
  readonly delay?: number;
}

/** A physical spring of the motion system. */
export interface CloudletSpring {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

/** A time-defined spring: settles in about `duration` ms; `bounce` 0 has no overshoot. */
export interface CloudletTimedSpring {
  readonly duration: number;
  readonly bounce: number;
}

/**
 * The motion constants: durations in ms at `timeScale: 1`, offsets and blur in CSS px.
 * Reported by the laboratory's tuning panel; see `ToasterMotion.overrides`.
 */
export interface CloudletMotionConstants {
  /** A new pill: opacity, scale from `scale` and translateY from `offset` px at the edge. */
  readonly enter: CloudletTimedSpring & { readonly scale: number; readonly offset: number; readonly fade: number };
  /** The last record or a dismissed top pill leaving. */
  readonly exit: CloudletTimedSpring;
  /** Shape (width, height, radius) opening into the Island. */
  readonly shapeOpen: CloudletSpring;
  /** Shape collapsing into the pill and adjusting to new content. */
  readonly shapeClose: CloudletSpring;
  /** Slide between notifications inside the Island; swipes release with it. */
  readonly slide: CloudletSpring;
  /** Badge presence; `scale` is its hidden scale. */
  readonly badge: CloudletTimedSpring & { readonly scale: number };
  /** Tails retracting on open and returning at the end of a collapse. */
  readonly tails: number;
  /** Close button, body and indicator: delay, fade in, fade out on collapse, rise in px. */
  readonly chromeDelay: number;
  readonly chromeIn: number;
  readonly chromeOut: number;
  readonly chromeOffset: number;
  /** Title and icon blur swap: outgoing, incoming, blur radius in px. */
  readonly headerOut: number;
  readonly headerIn: number;
  readonly blur: number;
  /** Body crossfade: outgoing, incoming, rise of the incoming body in px. */
  readonly bodyOut: number;
  readonly bodyIn: number;
  readonly bodyOffset: number;
  /** A body update sooner than this after the previous one changes the text in place (no crossfade). */
  readonly bodyQuiet: number;
  /** Badge number and indicator text blur swap. */
  readonly countSwap: number;
  /** Progress ring value tween. */
  readonly progress: number;
  /** Hover: duration and the extra tail spread per step in px. */
  readonly hover: number;
  readonly hoverLift: number;
  /** Reduced motion: every transition becomes an opacity change of this length. */
  readonly reduced: number;
}

/** Partial `CloudletMotionConstants`; nested springs may be partial too. */
export type CloudletMotionOverrides = {
  readonly [K in keyof CloudletMotionConstants]?: CloudletMotionConstants[K] extends number
    ? number : Partial<CloudletMotionConstants[K]>;
};

export interface ToasterMotion {
  /**
   * Debugging and laboratory aid: slows every transition (0.5 = twice as slow).
   * Default 1; a non-finite or nonpositive value falls back to 1. Not recommended in production.
   */
  readonly timeScale?: number;
  /**
   * Debugging and laboratory channel: replaces the motion constants live, for
   * transitions started after the change. A field that is not a finite number in range
   * (stiffness and mass > 0, the rest ≥ 0) keeps its default. Not a styling API: the
   * values may change between releases; do not ship overrides to production.
   */
  readonly overrides?: CloudletMotionOverrides;
}

/** Styling hooks of the renderer; see `ToasterProps.classNames`. */
export type CloudletPart = 'host' | 'stack' | 'pill' | 'tail' | 'badge' | 'island' | 'header' | 'icon' | 'title'
  | 'close' | 'body' | 'description' | 'actions' | 'action' | 'indicator' | 'overflow';

export interface ToasterProps {
  readonly position?: 'auto' | 'top-center' | 'bottom-center';
  readonly theme?: 'system' | 'light' | 'dark';
  readonly dir?: 'ltr' | 'rtl';
  /** Read after mount; a connected HTML Element in the mounting root's document. Fixed until remount. */
  readonly container?: Element | (() => Element | null) | null;
  readonly offsets?: ToasterOffsets;
  readonly nonce?: string;
  readonly labels?: Partial<CloudletLabels>;
  readonly announcements?: Partial<AnnouncementFormatters>;
  /** Read on attach; changing it requires remount. */
  readonly attention?: ToasterAttention;
  /** Overrides the controller's `autoDismiss` while defined; changes apply without remount. */
  readonly autoDismiss?: boolean;
  /** Read on every render. */
  readonly motion?: ToasterMotion;
  /** Extra classes per part, added to the own `cloudlet-*` classes (never replacing them). Read on every render. */
  readonly classNames?: Partial<Record<CloudletPart, string>>;
}

/** Public component and hook signatures. */
export type CloudletProviderComponent = (props: CloudletProviderProps) => ReactElement | null;
export type UseCloudlet = () => ReactCloudletController;
export type UseOptionalCloudlet = () => ReactCloudletController | null;
export type ToasterComponent = (props: ToasterProps) => ReactElement | null;

export type { ControllerSnapshot, FocusTarget, NotificationHandle };
export { CloudletProvider, useCloudlet, useOptionalCloudlet, Toaster } from './react/bindings.js';
