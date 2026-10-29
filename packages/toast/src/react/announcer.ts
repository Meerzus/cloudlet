import type { ReactNode } from 'react';
import type { AnnouncementAcknowledgement, HostLease, OperationAnnouncementPhase, RendererBridge } from '../contracts/internal.js';
import type { NotificationHandle } from '../contracts/identity.js';
import type { NotificationSnapshot } from '../contracts/snapshots.js';
import type { AnnouncementFormatters } from '../react.js';

type Notification = NotificationSnapshot<ReactNode>;
const content = ({ content: value }: Notification) => [value.title,
  value.description?.kind === 'rich' ? value.description.announcement : value.description?.text,
].filter(Boolean).join('. ');

const defaults: Required<AnnouncementFormatters> = {
  notification: content,
  queued: count => `${count} notifications queued`,
  occurrences: item => `${item.content.title}. ${item.occurrences} occurrences`,
  overflow: count => `${count} missed notifications`,
  operation: content,
  actionError: (item, message) => `${item.content.title}. ${message}`,
  actionPending: item => `${item.content.title}. ${item.content.action?.label}. In progress`,
  resumed: count => `${count} current notifications`,
};

/** One attachment, two existing live hosts, one fixed batch window. No event history. */
export function createAnnouncer(bridge: RendererBridge<ReactNode>, lease: HostLease, doc: Document,
  options: () => Partial<AnnouncementFormatters> | undefined) {
  let polite: Element | null = null;
  let assertive: Element | null = null;
  let timer: number | undefined;
  let unsubscribe: (() => void) | undefined;
  let mounted = false;
  let resumed = false;
  /** The record last presented, and one shown again inside the open Island (a slide back, or the next after a close). */
  let shown: NotificationHandle | null = null;
  let revisit: NotificationHandle | null = null;
  /** A flush held back until the presented record is readable (see `flush`). */
  let waiting = false;
  let reinsert: number | undefined;
  const view = doc.defaultView;
  const cancel = () => { view?.clearTimeout(timer); timer = undefined; };
  const schedule = () => {
    if (!mounted) return;
    const snapshot = bridge.getSnapshot();
    if (!snapshot.notifications.length && !snapshot.overflow.pending) { cancel(); resumed = false; return; }
    if (timer === undefined && doc.visibilityState !== 'hidden') timer = view?.setTimeout(flush, 300);
  };
  function format<K extends keyof AnnouncementFormatters>(key: K,
    ...args: Parameters<Required<AnnouncementFormatters>[K]>): string {
    // The correlated tuple is preserved at all callers; the cast is local to dispatch.
    type Formatter = (...values: typeof args) => string;
    try {
      const text = (options()?.[key] ?? defaults[key]) as Formatter;
      const value = text(...args);
      if (typeof value !== 'string' || !value.trim()) throw new TypeError('Announcement must be a nonempty string');
      return value;
    } catch (error) {
      bridge.reportDiagnostic(lease, { code: 'formatter-error', source: `Toaster.announcements.${key}`,
        message: 'Announcement formatter failed', error });
      return (defaults[key] as Formatter)(...args);
    }
  }
  function flush() {
    timer = undefined;
    if (!mounted || doc.visibilityState === 'hidden' || !polite || !assertive) return;
    const snapshot = bridge.getSnapshot();
    // The presented record speaks first and the queue after it. While its pill or slide is still
    // arriving (a slow first frame), sending now would say the queue alone; its `presented` event
    // flushes instead.
    if (snapshot.presentation && !snapshot.presentation.readable && !resumed) { waiting = true; return; }
    waiting = false;
    const acks: AnnouncementAcknowledgement[] = [];
    const messages = { polite: [] as string[], assertive: [] as string[] };
    const queued = { polite: 0, assertive: 0 };
    for (const item of snapshot.notifications) {
      const ledger = snapshot.announcements.notifications.find(value => value.handle === item.handle)!;
      const handle = item.handle;
      const priority = item.content.announcementPriority ?? 'polite';
      const readable = snapshot.presentation?.handle === handle && snapshot.presentation.readable;
      const say = (text: () => string) => { if (priority !== 'off' && !resumed) messages[priority].push(text()); };
      // Stack records behind the presented one speak only as an aggregate, like a queue.
      if (item.location === 'stack') {
        if (!ledger.queued) {
          acks.push({ kind: 'queued', handle });
          if (priority !== 'off' && !ledger.firstPresentation && !resumed) queued[priority]++;
        }
        // Queued payloads/progress never speak; first presentation reads the latest state.
        if (!resumed) continue;
      } else if (!readable && !resumed) continue;

      const first = item.location === 'current' && readable && !ledger.firstPresentation;
      if (first) acks.push({ kind: 'first-presentation', handle });
      const operation = item.operation;
      let operationText = false;
      if (operation) {
        const phase = operation.status === 'pending' ? operation.cancelRequested ? 'cancel-requested' : 'started' : operation.status;
        const phases = ledger.operation?.token === operation.token ? ledger.operation.phases : [];
        for (const current of new Set<OperationAnnouncementPhase>(['started', ...(operation.cancelRequested ? ['cancel-requested' as const] : []), phase])) {
          if (!phases.includes(current)) acks.push({ kind: 'operation', handle, token: operation.token, phase: current });
        }
        if (!phases.includes(phase)) { say(() => format('operation', item, phase)); operationText = true; }
      }
      if (first && !operationText) say(() => format('notification', item));
      // The title node is shared by every slide, so focus never moves when a slide comes back:
      // speak the record once more so a screen reader hears where the user landed.
      else if (revisit === handle && item.location === 'current' && !operationText && priority !== 'off' && !resumed) {
        messages.polite.push(format('notification', item));
      }
      if (item.occurrences > ledger.occurrences) {
        acks.push({ kind: 'occurrences', handle, count: item.occurrences });
        if (!first && item.occurrences > 1) say(() => format('occurrences', item));
      }
      const action = item.action;
      if (action.status !== 'idle' && (ledger.action?.token !== action.token || ledger.action.status !== action.status)) {
        acks.push({ kind: 'action', handle, token: action.token, status: action.status });
        say(() => action.status === 'failed' ? format('actionError', item, action.message) : format('actionPending', item));
      }
    }
    for (const priority of ['polite', 'assertive'] as const) {
      if (queued[priority]) messages[priority].push(format('queued', queued[priority]));
    }
    if (snapshot.overflow.count > snapshot.announcements.overflowCount) {
      acks.push({ kind: 'overflow', count: snapshot.overflow.count });
      if (!resumed) messages.polite.push(format('overflow', snapshot.overflow.count));
    }
    if (resumed) {
      for (const priority of ['polite', 'assertive'] as const) {
        const count = snapshot.notifications.filter(item => (item.content.announcementPriority ?? 'polite') === priority).length;
        if (count) messages[priority].push(format('resumed', count));
      }
      if (snapshot.overflow.pending) messages.polite.push(format('overflow', snapshot.overflow.count));
    }
    // A user formatter/diagnostic can reenter the controller. Never deliver its stale batch.
    if (!mounted) return;
    if (bridge.getSnapshot() !== snapshot) { schedule(); return; }
    resumed = false;
    revisit = null;
    for (const [host, lines] of [[polite, messages.polite], [assertive, messages.assertive]] as const) {
      if (!lines.length) continue;
      let text = lines.join('. ');
      // The same message again (a second failed attempt) would leave the region unchanged and silent;
      // a trailing no-break space makes it a change without changing what is spoken.
      if (host.textContent === text) text += '\u00a0';
      host.replaceChildren(doc.createTextNode(text));
    }
    bridge.acknowledgeAnnouncements(lease, acks);
  }
  function visibility() {
    cancel();
    if (doc.visibilityState === 'hidden') {
      polite?.replaceChildren(); assertive?.replaceChildren();
    } else { resumed = true; schedule(); }
  }
  return {
    /**
     * The announcer owns its live regions: created here, next to the host (React owns the host's
     * children), and inserted twice. VoiceOver in Safari ignored assertive changes made while focus
     * was in the open Island in regions inserted only once (0 of 6 runs), and spoke them after one
     * re-insertion on the next frame (6 of 6, rc.2 gate); a zero timeout was not enough (3 of 5).
     */
    mount(host: HTMLElement) {
      mounted = true;
      const region = (priority: 'polite' | 'assertive') => {
        const element = doc.createElement('div');
        element.className = 'cloudlet-announcer';
        element.dataset.cloudletAnnouncer = priority;
        element.setAttribute('aria-live', priority);
        element.setAttribute('aria-atomic', 'true');
        return element;
      };
      polite = region('polite');
      assertive = region('assertive');
      host.after(polite, assertive);
      reinsert = view?.requestAnimationFrame?.(() => {
        reinsert = undefined;
        if (polite && assertive) host.after(polite, assertive);
      });
      unsubscribe = bridge.onEvent(event => {
        if (event.type === 'presented') {
          if (!event.firstPresentation && shown !== null && event.handle !== shown && bridge.getSnapshot().island.open) revisit = event.handle;
          shown = event.handle;
          // The window already passed while the presentation was pending: deliver right away.
          if (waiting) { waiting = false; cancel(); timer = view?.setTimeout(flush, 0); return; }
        }
        // Updated includes progress, reflow and ordinary text edits, not a new semantic phase.
        if (event.type !== 'updated' && event.type !== 'diagnostic') schedule();
      });
      doc.addEventListener('visibilitychange', visibility);
      schedule();
    },
    dispose() {
      mounted = false;
      cancel(); unsubscribe?.();
      doc.removeEventListener('visibilitychange', visibility);
      if (reinsert !== undefined) view?.cancelAnimationFrame(reinsert);
      polite?.remove(); assertive?.remove();
      polite = assertive = null;
    },
  };
}
