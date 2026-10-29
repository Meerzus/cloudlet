import { Component, Suspense, useEffect, useId, useRef, useState } from 'react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import type { HostLease, RendererBridge } from '../contracts/internal.js';
import type { NotificationHandle } from '../contracts/identity.js';
import type { NotificationKind } from '../contracts/notifications.js';
import type { NotificationSnapshot } from '../contracts/snapshots.js';
import type { CloudletLabels, CloudletPart, ToasterProps } from '../react.js';

export const defaultLabels: CloudletLabels = {
  region: 'Notifications', island: 'Current notifications', carousel: 'carousel', slide: 'slide',
  close: 'Close notification', retry: 'Retry',
  cancel: 'Request cancellation', cancellationRequested: 'Cancellation requested',
  acknowledgeOverflow: 'Acknowledge missed notifications', collapse: 'Press Escape to collapse',
  stackSummary: (title, count, missed) => [title, ...(count > 1 ? [`${count} notifications`] : []),
    ...(missed > 0 ? [`${missed} missed`] : [])].join(', '),
  page: (index, total) => `${index} of ${total}`,
  overflowCount: count => `${count} missed notifications`,
};

interface SlotProps {
  readonly content: ReactNode;
  readonly bridge: RendererBridge<ReactNode>;
  readonly lease: HostLease;
  readonly handle: NotificationHandle;
  readonly rejectFocus: (previous: EventTarget | null) => void;
}

class SlotBoundary extends Component<SlotProps, { failed: boolean; content: ReactNode }> {
  override state = { failed: false, content: this.props.content };
  static getDerivedStateFromError() { return { failed: true }; }
  static getDerivedStateFromProps(props: SlotProps, state: { content: ReactNode }) {
    return props.content === state.content ? null : { failed: false, content: props.content };
  }
  override componentDidCatch(error: unknown) {
    this.props.bridge.reportDiagnostic(this.props.lease, { code: 'slot-error', source: 'Toaster.slot',
      message: 'A rich slot could not be rendered', handle: this.props.handle, error });
  }
  override render() {
    return this.state.failed ? this.props.bridge.renderError
      : <Suspense fallback={this.props.bridge.renderError}><CheckedSlot {...this.props} /></Suspense>;
  }
}

function CheckedSlot({ content, bridge, lease, handle, rejectFocus }: SlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [invalidContent, setInvalidContent] = useState<{ content: ReactNode } | null>(null);
  const invalid = invalidContent?.content === content;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let reported = false;
    const check = () => {
      if (reported || !element.querySelector('a[href],button,input,select,textarea,summary,iframe,[tabindex],[contenteditable]:not([contenteditable="false"]),audio[controls],video[controls]')) return;
      reported = true;
      setInvalidContent({ content });
      bridge.reportDiagnostic(lease, { code: 'slot-error', source: 'Toaster.slot',
        message: 'Rich slots must be non-interactive; use the notification action', handle });
    };
    check();
    const Observer = element.ownerDocument.defaultView?.MutationObserver;
    const observer = Observer ? new Observer(check) : null;
    observer?.observe(element, { childList: true, subtree: true, attributes: true });
    return () => observer?.disconnect();
  }, [content, bridge, lease, handle]);
  return <div ref={ref} className="cloudlet-slot" onFocusCapture={event => rejectFocus(event.relatedTarget)}>
    {invalid ? bridge.renderError : content}
  </div>;
}

function control(name: string, children: ReactNode, onClick: () => void, props?: ComponentPropsWithRef<'button'>) {
  return <button type="button" data-cloudlet-control={name} {...props} onClick={onClick}>{children}</button>;
}

function glyph(path: string) {
  return <svg aria-hidden="true" viewBox="0 0 16 16"><path d={path} /></svg>;
}

/** Adds the application's `classNames` part to an own `cloudlet-*` class, never replacing it. */
export type PartClass = (part: CloudletPart, own: string) => string;
export function partClasses(classNames: ToasterProps['classNames']): PartClass {
  return (part, own) => {
    const extra = classNames?.[part];
    return typeof extra === 'string' && extra.trim() ? `${own} ${extra.trim()}` : own;
  };
}

/** 16 px stroke glyphs drawn in the status colour. */
const glyphs: Record<Exclude<NotificationKind, 'loading'>, string> = {
  success: 'M4.5 8.5 7 11l4.5-5.5',
  error: 'm5.5 5.5 5 5m0-5-5 5',
  info: 'M8 7.5V11M8 5h.01',
  warning: 'M8 4.75V8.5M8 11.25h.01',
};

/**
 * The status icon: a 24 px tinted circle with a glyph, the loading spinner or the
 * notification's own icon, and the 2 px progress ring around it (pill and Island
 * share these nodes). With progress the icon is the accessible progressbar. The
 * determinate arc is owned by the host sampler (one RAF per host, 240 ms tween);
 * `preview` draws the value statically for the inert swipe neighbour.
 */
export function StatusIcon({ notification, slot, part, preview = false }: {
  notification: NotificationSnapshot<ReactNode>; slot: (value: ReactNode) => ReactNode; part: PartClass; preview?: boolean;
}) {
  const { content, kind } = notification;
  const { progress } = content;
  const determinate = progress?.kind === 'determinate';
  return <div className={part('icon', 'cloudlet-icon')} data-kind={kind}
    {...(progress && !preview ? { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100,
      'aria-valuenow': determinate ? Math.round(progress.value * 100) : undefined, 'aria-label': progress.label ?? content.title }
      : { 'aria-hidden': 'true' })}>
    {content.icon !== undefined
      ? <span className="cloudlet-glyph" aria-hidden="true">{slot(content.icon)}</span>
      // With progress the ring is the activity indicator of a loading record.
      : kind === 'loading' ? !progress && <svg aria-hidden="true" viewBox="0 0 16 16" className="cloudlet-glyph cloudlet-spinner">
        <circle cx="8" cy="8" r="5.5" strokeDasharray="22 13" /></svg>
        : <svg aria-hidden="true" viewBox="0 0 16 16" className="cloudlet-glyph"><path d={glyphs[kind]} /></svg>}
    {progress && <svg aria-hidden="true" viewBox="0 0 32 32" className="cloudlet-ring" data-progress={progress.kind}>
      <circle className="cloudlet-ring-track" cx="16" cy="16" r="15" />
      <circle className="cloudlet-progress-fill" cx="16" cy="16" r="15" pathLength="100" transform="rotate(-90 16 16)"
        strokeDasharray={!determinate ? '25 75' : preview ? `${Math.round(progress.value * 10000) / 100} 100` : '0 100'} />
    </svg>}
  </div>;
}

export function slotRenderer(bridge: RendererBridge<ReactNode>, lease: HostLease, handle: NotificationHandle,
  rejectSlotFocus: (previous: EventTarget | null) => void) {
  return (value: ReactNode) => <SlotBoundary content={value} bridge={bridge} lease={lease} handle={handle} rejectFocus={rejectSlotFocus} />;
}

/**
 * Status icon and title: the same DOM nodes in the pill and in the Island header,
 * so opening never re-creates them and the title can receive focus in place.
 */
export function Heading({ notification, slot, part, titleId }: {
  notification: NotificationSnapshot<ReactNode>; slot: (value: ReactNode) => ReactNode; part: PartClass;
  /** Omitted for the inert neighbour preview: no id, focus target, data hook or live progress. */
  titleId?: string;
}) {
  const title = part('title', 'cloudlet-title');
  return <div className="cloudlet-heading">
    <StatusIcon notification={notification} slot={slot} part={part} preview={titleId === undefined} />
    {titleId === undefined ? <h2 className={title}>{notification.content.title}</h2>
      : <h2 id={titleId} tabIndex={-1} data-cloudlet-title="" className={title}>{notification.content.title}</h2>}
  </div>;
}

/** Rich content of the inert neighbour preview: rendered as is, never checked or reported twice. */
export const previewSlot = (value: ReactNode) => <div className="cloudlet-slot">{value}</div>;

/** A settled factory can always retry through the API; only an unsuccessful attempt offers the button. */
type Operation = NotificationSnapshot<ReactNode>['operation'];
const retryable = (operation: Operation): operation is NonNullable<Operation> => !!operation?.canRetry && operation.status !== 'fulfilled';

/**
 * The neighbour shown only while a finger drags the Island content:
 * the same layout as a live slide, but every control is a lookalike without
 * handlers, ids, links or tab stops. The caller puts it in an `inert` container.
 */
export function SlidePreview({ notification, labels, part }: { notification: NotificationSnapshot<ReactNode>; labels: CloudletLabels; part: PartClass }) {
  const { content, operation, kind } = notification;
  const action = part('action', 'cloudlet-action');
  const lookalike = (children: ReactNode, primary = false) =>
    <button type="button" tabIndex={-1} className={primary ? `${action} cloudlet-primary` : action}>{children}</button>;
  // Only the body slides: the preview shows the neighbour's body under the live heading.
  return <div className="cloudlet-slide" data-kind={kind}>
    <div className={part('body', 'cloudlet-body')} data-kind={kind}>
      {content.description && <div className={part('description', 'cloudlet-description')}>
        {content.description.kind === 'text' ? <p>{content.description.text}</p> : previewSlot(content.description.content)}
      </div>}
      <div className={part('actions', 'cloudlet-actions')}>
        {content.action?.kind === 'command' && lookalike(content.action.label, true)}
        {content.action?.kind === 'link' && <a className={`${action} cloudlet-primary`}>{content.action.label}</a>}
        {retryable(operation) && lookalike(labels.retry)}
        {operation?.canCancel && lookalike(operation.cancelRequested ? labels.cancellationRequested : labels.cancel)}
      </div>
      {notification.action.status === 'failed' && <p className="cloudlet-action-error">{notification.action.message}</p>}
    </div>
  </div>;
}

/** Island slide body: description, progress, actions and the action error. */
export function Body({ notification, bridge, lease, labels, navigate, slot, part }: {
  notification: NotificationSnapshot<ReactNode>; bridge: RendererBridge<ReactNode>; lease: HostLease;
  labels: CloudletLabels; navigate: (handle: NotificationHandle) => void; slot: (value: ReactNode) => ReactNode; part: PartClass;
}) {
  const { handle, content, operation, action, kind } = notification;
  // The primary action is tinted with the status; retry and cancel stay neutral.
  const neutral = part('action', 'cloudlet-action');
  const primary = `${neutral} cloudlet-primary`;
  const id = useId();
  const command = content.action;
  const activateLink = (event: MouseEvent) => {
    // Observe cancellation after portal/application ancestors have handled activation.
    queueMicrotask(() => { if (!event.defaultPrevented) navigate(handle); });
  };
  return <div className={part('body', 'cloudlet-body')} data-kind={kind}>
    {content.description && <div className={part('description', 'cloudlet-description')}>
      {content.description.kind === 'text' && <p>{content.description.text}</p>}
      {content.description.kind === 'rich' && slot(content.description.content)}
    </div>}
    <div className={part('actions', 'cloudlet-actions')}>
      {command?.kind === 'command' && control('action', command.label, () => {
        if (action.status !== 'pending') bridge.invokeAction(lease, handle);
      }, { className: primary, 'aria-disabled': action.status === 'pending', 'aria-busy': action.status === 'pending',
        'aria-describedby': action.status === 'failed' ? `${id}-action-error` : undefined })}
      {command?.kind === 'link' && <a data-cloudlet-control="action" className={primary} href={command.href} target={command.target}
        rel={command.target === '_blank' ? [...new Set(`${command.rel ?? ''} noopener`.trim().split(/\s+/u))].join(' ') : command.rel}
        onClick={event => activateLink(event.nativeEvent)}
        onAuxClick={event => { if (event.button === 1) activateLink(event.nativeEvent); }}>{command.label}</a>}
      {retryable(operation) && control('retry', labels.retry, () => bridge.retryOperation(lease, handle, operation.token), { className: neutral })}
      {operation?.canCancel && control('cancel', operation.cancelRequested ? labels.cancellationRequested : labels.cancel, () => {
        if (!operation.cancelRequested) bridge.cancelOperation(lease, handle, operation.token);
      }, { className: neutral, 'aria-disabled': operation.cancelRequested })}
    </div>
    {action.status === 'failed' && <p id={`${id}-action-error`} className="cloudlet-action-error">{action.message}</p>}
  </div>;
}

export function closeButton(labels: CloudletLabels, part: PartClass, onClick: () => void) {
  return control('close', glyph('m4.5 4.5 7 7m0-7-7 7'), onClick, { 'aria-label': labels.close, className: part('close', 'cloudlet-close') });
}
