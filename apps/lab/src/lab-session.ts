import { createCloudlet } from '@cloudlet/toast';
import type { ControllerSnapshot, NotificationHandle, OperationHandle, ReactCloudletController, SemanticEvent } from '@cloudlet/toast';
import type { ReactNode } from 'react';

import { logDebug } from './debug-log.js';

export const LOG_LIMIT = 80;
export type Attention = 'auto' | 'open' | 'stack';
type Deferred = { promise: Promise<string>; resolve: (value: string) => void; reject: (reason: unknown) => void };
type Task = { operation: OperationHandle<string>; deferred: Deferred | undefined; outcome: string };
export type LogEntry = { sequence: number; text: string };
export type LabSnapshot = {
  logical: readonly LogEntry[]; presentation: readonly LogEntry[]; transitions: readonly LogEntry[];
  tasks: readonly { name: string; status: string; outcome: string; admission: string; attempt: number }[];
  running: boolean; updates: number; intervals: number; pending: number; listeners: number; message: string;
};

// These promises belong to the fixture, never to the library's store.
function deferred(): Deferred {
  let resolve!: Deferred['resolve'];
  let reject!: Deferred['reject'];
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/** Island state and current record as one log line: what `data-state` and the slider show. */
export function describeIsland(snapshot: ControllerSnapshot<ReactNode>): string {
  const current = snapshot.notifications.find(item => item.location === 'current');
  if (!current) return 'empty';
  const index = snapshot.stack.indexOf(current.handle) + 1;
  const state = snapshot.island.open ? `island · ${snapshot.island.reason}` : 'stack';
  return `${state} · current=${current.content.title} (${index}/${snapshot.stack.length})`;
}

export class LabSession {
  readonly controller: ReactCloudletController;
  private listeners = new Set<() => void>();
  private resources = new Set<Deferred>();
  private abortCleanups = new Set<() => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private progressTimers = new Set<ReturnType<typeof setInterval>>();
  private tasks = new Map<string, Task>();
  private logical: LogEntry[] = [];
  private presentation: LogEntry[] = [];
  private transitions: LogEntry[] = [];
  private lastTransition = 'empty';
  private serial = 0;
  private stopped = false;
  private interval: ReturnType<typeof setInterval> | undefined;
  private updates = 0;
  private progressHandle: NotificationHandle | undefined;
  private message = 'Pick a scenario. The controller is empty.';
  private action: Deferred | undefined;
  private old: Deferred | undefined;
  private generated = 0;
  private unsubscribe: () => void;
  private snapshot!: LabSnapshot;

  constructor(autoDismiss = true) {
    this.controller = createCloudlet({ autoDismiss, messages: {
      operationSuccess: 'Done', operationError: 'Could not finish', operationCancelled: 'Operation cancelled',
      cancellationRequested: 'Cancellation requested', actionError: 'The action failed', renderError: 'Content unavailable',
    } });
    const events = this.controller.onEvent(event => this.event(event));
    const state = this.controller.subscribe(() => this.transition());
    this.unsubscribe = () => { events(); state(); };
    this.publish();
  }

  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  readonly getSnapshot = () => this.snapshot;

  private publish() {
    if (this.stopped) return;
    this.snapshot = {
      logical: this.logical, presentation: this.presentation, transitions: this.transitions,
      tasks: [...this.tasks].map(([name, task]) => ({ name, status: task.operation.getSnapshot().status, outcome: task.outcome,
        admission: task.operation.admission.status === 'rejected' ? task.operation.admission.reason : task.operation.admission.status,
        attempt: task.operation.getSnapshot().attempt })),
      running: this.interval !== undefined, updates: this.updates,
      intervals: Number(this.interval !== undefined) + this.progressTimers.size, pending: this.resources.size,
      listeners: this.abortCleanups.size, message: this.message,
    };
    for (const listener of this.listeners) listener();
  }

  note(message: string) { this.message = message; this.publish(); }
  private event(event: SemanticEvent) {
    let text = `${event.sequence} ${event.type}`;
    logDebug(`event ${event.type}${'handle' in event && event.handle ? ' ' + event.handle.id : ''}${event.type === 'closed' ? ' ' + event.reason : ''}`);
    if ('handle' in event && event.handle) text += ` ${event.handle.id} · ${event.handle.generation}`;
    if (event.type === 'operation-settled') text += ` ${event.status} uiApplied=${event.uiApplied}`;
    if (event.type === 'closed') text += ` ${event.reason}`;
    if (event.type === 'diagnostic') text += ` ${event.diagnostic.code}`;
    const entry = { sequence: ++this.serial, text };
    if (event.type === 'presented' || event.type === 'diagnostic') this.presentation = [...this.presentation, entry].slice(-LOG_LIMIT);
    else this.logical = [...this.logical, entry].slice(-LOG_LIMIT);
    this.publish();
  }
  /** Logs every change of the Island state, its reason or the current record (not every snapshot). */
  private transition() {
    const snapshot = this.controller.getSnapshot();
    if (snapshot.disposed) return;
    const text = describeIsland(snapshot);
    if (text === this.lastTransition) return;
    this.lastTransition = text;
    this.transitions = [...this.transitions, { sequence: ++this.serial, text }].slice(-LOG_LIMIT);
    this.publish();
  }

  private resource() { const item = deferred(); this.resources.add(item); this.publish(); return item; }
  private release(item: Deferred) { this.resources.delete(item); }
  /** A fixture promise settled by a timer; cleanup clears the timer and rejects the promise. */
  private later(ms: number, fail: boolean, value: string) {
    const item = this.resource();
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.release(item);
      if (fail) item.reject(new Error(value)); else item.resolve(value);
      this.publish();
    }, ms);
    this.timers.add(timer);
    return item.promise;
  }
  private observe(name: string, operation: OperationHandle<string>, item?: Deferred) {
    const task: Task = { operation, deferred: item, outcome: '—' };
    this.tasks.set(name, task);
    // Both branches are handled. Obsolete callbacks cannot write into a reset session.
    this.observeResult(task, item, operation.result);
    this.publish();
  }

  private observeResult(task: Task, item: Deferred | undefined, result: Promise<string>) {
    void result.then(value => {
      if (item) this.release(item); if (this.stopped || task.deferred !== item) return; task.outcome = `fulfilled: ${value}`; this.publish();
    }, reason => {
      if (item) this.release(item); if (this.stopped || task.deferred !== item) return; task.outcome = `rejected: ${reason instanceof Error ? reason.message : String(reason)}`; this.publish();
    });
  }

  /** “3 → open → close current”: a clean stack of three different records, no auto-open. */
  threeScenario() {
    this.controller.clear(); this.controller.acknowledgeOverflow();
    this.controller.show({ id: 'draft', title: 'Draft saved', kind: 'success', description: { kind: 'text', text: 'Changes are stored locally. Sync starts when you are back online.' }, duration: null, attention: 'stack' });
    this.controller.show({ id: 'upload', title: 'File uploaded', kind: 'info', description: { kind: 'text', text: 'report.pdf · 2.4 MB' }, duration: null, attention: 'stack',
      action: { kind: 'command', label: 'Open', run: () => this.note('The “Open” action ran: the card closed as action-success.') } });
    this.controller.show({ id: 'comment', title: 'New comment', duration: null, attention: 'stack' });
    this.note('Three notifications in the stack: open the Island, close the current one, collapse.');
  }

  /** Generators: each kind of record `attention` treats differently, with an explicit `attention`. */
  generate(kind: 'description' | 'action' | 'plain', attention: Attention, long = false) {
    const n = ++this.generated;
    if (kind === 'description') this.controller.show({ title: `Document updated · ${n}`, kind: 'success', attention,
      description: { kind: 'text', text: long ? 'The workspace was updated. '.repeat(35) + 'تم حفظ التغييرات بنجاح. '.repeat(12) : 'The new version is saved to the shared “Reports” folder. Colleagues will see it next time they open it.' } });
    else if (kind === 'action') this.controller.show({ title: `Email archived · ${n}`, kind: 'info', attention,
      action: { kind: 'command', label: 'Undo', run: () => this.note(`Undo for email ${n} done.`) } });
    else this.controller.show({ title: `Link copied · ${n}`, attention });
  }
  /**
   * A quick reply, or a note with a name and several lines. The send takes 700 ms; text containing
   * "fail" makes it fail, so the error under the form and a second try can be checked.
   */
  generateForm(fields: 'reply' | 'note', attention: Attention) {
    const n = ++this.generated;
    const send = (text: string, done: string) => this.later(700, /fail/iu.test(text), done).then(() => this.note(done));
    if (fields === 'reply') this.controller.show({ title: `Anna: are you coming tonight? · ${n}`, kind: 'info', attention,
      description: { kind: 'text', text: 'Dinner at eight, table for four.' },
      action: { kind: 'form', label: 'Send', errorMessage: () => 'Could not send. Try again.',
        fields: [{ name: 'reply', kind: 'text', label: 'Reply', required: true, maxLength: 120 }],
        run: ({ values }) => send(values.reply, `Reply ${n} sent: ${values.reply}`) } });
    else this.controller.show({ title: `Leave a note · ${n}`, kind: 'info', attention,
      action: { kind: 'form', label: 'Send note', errorMessage: () => 'Could not send. Try again.',
        fields: [{ name: 'name', kind: 'text', label: 'Name', autoComplete: 'name' },
          { name: 'note', kind: 'textarea', label: 'Note', required: true, maxLength: 500 }],
        validate: values => values.note.trim().length >= 3 || { note: 'Write at least three characters' },
        run: ({ values }) => send(values.note, `Note ${n} sent${values.name ? ` from ${values.name}` : ''}`) } });
  }
  /** A tracked operation whose first attempt fails: the Island offers retry, the next attempt succeeds. */
  generateRetry(attention: Attention) {
    const n = ++this.generated;
    const operation = this.controller.track(({ attempt }) => this.later(900, attempt === 1, attempt === 1 ? 'Server unavailable' : `sent on attempt ${attempt}`), {
      pending: { title: `Sending report · ${n}`, attention },
      success: value => ({ title: `Report sent · ${n}`, description: { kind: 'text', text: value }, attention }),
      error: { title: `Could not send · ${n}`, description: { kind: 'text', text: 'The report is saved. Retry when you are ready.' }, attention },
    });
    this.observe(`retry-${n}`, operation);
  }
  /** Determinate progress 0 → 100 % in ~3 s, then the same record becomes success. */
  generateProgress(attention: Attention) {
    const n = ++this.generated;
    const result = this.controller.show({ title: `Downloading archive · ${n}`, kind: 'loading', attention, duration: null,
      progress: { kind: 'determinate', value: 0, label: 'Downloading archive' }, description: { kind: 'text', text: '0 of 20 files' } });
    if (result.status === 'rejected') { this.note(`Progress not accepted: ${result.reason}`); return; }
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      if (step >= 20) {
        clearInterval(timer); this.progressTimers.delete(timer);
        this.controller.update(result.handle, { kind: 'success', title: `Archive downloaded · ${n}`, progress: null, duration: 6000, description: { kind: 'text', text: '20 files' } });
      } else this.controller.update(result.handle, { progress: { kind: 'determinate', value: step / 20, label: 'Downloading archive' }, description: { kind: 'text', text: `${step} of 20 files` } });
      this.publish();
    }, 150);
    this.progressTimers.add(timer);
    this.publish();
  }
  /** loading → success / error through `track`: the same record changes in place. */
  loadingTo(outcome: 'success' | 'error', attention: Attention) {
    const n = ++this.generated;
    const operation = this.controller.track(() => this.later(1500, outcome === 'error', outcome === 'error' ? 'No connection' : 'saved'), {
      pending: { title: `Saving changes · ${n}`, attention, description: { kind: 'text', text: 'This takes a couple of seconds.' } },
      success: { title: `Changes saved · ${n}`, attention, description: { kind: 'text', text: 'Every edit is on the server.' } },
      error: { title: `Saving failed · ${n}`, attention, description: { kind: 'text', text: 'The edits stay in the draft.' } },
    });
    this.observe(`${outcome}-${n}`, operation);
  }
  /** 101 records into an empty stack: cap 100, at least one missed in the badge. */
  overflow() {
    const free = 100 - this.controller.getSnapshot().notifications.length;
    for (let i = 0; i < Math.max(free, 0) + 1; i++) this.controller.show({ title: `File ${i + 1} processed`, duration: null, attention: 'stack', announcementPriority: 'off' });
    this.note('The stack is filled to 100; the missed ones are in the badge and in the Island indicator line.');
  }

  start(name: string, mode: 'manual' | 'cooperative' | 'ignore' = 'manual') {
    const previous = this.tasks.get(name);
    if (previous) {
      previous.deferred?.reject(new Error('Fixture replaced'));
      if (previous.deferred) this.release(previous.deferred);
      const handle = previous.operation.getSnapshot().notification;
      if (handle) this.controller.dismiss(handle);
    }
    let item = this.resource();
    const operation = this.controller.track(({ signal, attempt }) => {
      if (attempt > 1) {
        item = this.resource();
        const task = this.tasks.get(name);
        if (task) { task.deferred = item; task.outcome = '—'; this.observeResult(task, item, item.promise); }
      }
      if (mode === 'cooperative') {
        const onAbort = () => item.reject(signal.reason);
        const cleanup = () => { signal.removeEventListener('abort', onAbort); this.abortCleanups.delete(cleanup); };
        signal.addEventListener('abort', onAbort, { once: true });
        this.abortCleanups.add(cleanup);
        void item.promise.then(cleanup, cleanup);
      }
      return item.promise;
    }, {
      id: `task-${name}`, pending: { title: mode === 'manual' ? `Preparing ${name}` : mode === 'ignore' ? 'Exporting archive' : 'Syncing files', attention: 'stack' },
      success: value => ({ title: `${name}: done`, description: { kind: 'text', text: value }, attention: 'stack' }),
      error: { title: `${name}: error`, description: { kind: 'text', text: 'The data is saved. Retry when you are ready.' }, attention: 'stack' },
      cancelled: { title: 'Sync cancelled' },
    });
    this.observe(name, operation, item);
  }

  settle(name: string, reject = false) {
    const task = this.tasks.get(name);
    if (!task) return;
    if (reject) task.deferred?.reject(new Error(`${name}: rejected by hand`)); else task.deferred?.resolve(`${name}: result received`);
  }
  cancel(name: string) { const result = this.tasks.get(name)?.operation.cancel(); this.note(`cancel ${name}: ${result?.status ?? 'no attempt'}`); }
  retry(name: string) {
    const task = this.tasks.get(name);
    if (!task) return;
    const result = task.operation.retry();
    this.note(`retry ${name}: ${result.status}`);
  }

  errors(mapper: boolean) {
    const operation = this.controller.track<string>(() => {
      if (!mapper) throw new Error('Synchronous factory failure');
      return 'business value preserved';
    }, { pending: { title: 'Saving changes' }, success: () => { throw new Error('Success mapper failure'); }, error: { title: 'Saving failed' } });
    this.observe(mapper ? 'mapper' : 'sync', operation);
  }

  showAction() {
    if (this.controller.getHandle('action-demo')) { this.note('“Publishing report” is already in the stack: open the Island.'); return; }
    let attempt = 0;
    this.controller.show({ id: 'action-demo', title: 'Publishing report', duration: null,
      description: { kind: 'text', text: 'Confirm publishing. If it fails, the report stays here to retry.' },
      action: { kind: 'command', label: 'Publish', errorMessage: () => 'Publishing failed. Try again.', run: () => {
        attempt += 1;
        if (this.action) { this.action.reject(new Error('Fixture action replaced')); this.release(this.action); }
        const item = this.resource(); this.action = item;
        this.note(`Action: attempt ${attempt}, pending. Settle or reject it by hand.`);
        return item.promise.then(() => { this.release(item); this.publish(); }, reason => { this.release(item); this.publish(); throw reason; });
      } },
    });
  }
  settleAction(reject: boolean) { if (reject) this.action?.reject(new Error('Action rejected manually')); else this.action?.resolve('published'); }

  reuse() {
    if (this.old) { this.old.reject(new Error('Fixture replaced')); this.release(this.old); }
    const existing = this.controller.getHandle('reused'); if (existing) this.controller.dismiss(existing);
    const item = this.resource(); this.old = item;
    const operation = this.controller.track(() => item.promise, { id: 'reused', pending: { title: 'Old export', attention: 'stack' }, success: { title: 'Old result' }, error: { title: 'Old export not finished' } });
    this.observe('old', operation, item);
    if (operation.admission.status === 'created') this.controller.dismiss(operation.admission.handle);
    this.controller.show({ id: 'reused', title: 'New export', duration: null, attention: 'stack' });
    this.note('ID reused was recreated. Resolve old must give uiApplied=false and keep “New export”.');
  }
  resolveOld() { this.old?.resolve('late value'); }
  dedupe() {
    for (let i = 0; i < 3; i++) this.controller.show({ title: 'Connection restored', dedupeKey: 'connection', duration: null });
  }
  burst() { for (let i = 0; i < 120; i++) this.controller.show({ title: `File ${i + 1} processed`, duration: null, attention: 'stack', announcementPriority: 'off' }); }
  capacityTask() {
    const operation = this.controller.track(() => 'business despite capacity', { pending: { title: 'Preparing archive' }, success: { title: 'Archive ready' }, error: { title: 'Archive unavailable' } });
    this.observe('capacity', operation);
  }
  startStress() {
    if (this.interval !== undefined || this.controller.getSnapshot().disposed) return;
    const previous = this.progressHandle && this.controller.getSnapshot().notifications.find(item => item.handle === this.progressHandle);
    const result = previous ? { status: 'created' as const, handle: previous.handle } : this.controller.show({ title: 'Processing collection', kind: 'loading', progress: { kind: 'determinate', value: 0 }, duration: null, attention: 'stack', announcementPriority: 'off' });
    this.burst();
    if (result.status === 'rejected') { this.note('Progress needs a free slot: run a reset. Burst finished.'); return; }
    this.progressHandle = result.handle;
    this.interval = setInterval(() => {
      this.updates += 1;
      this.controller.update(result.handle, { progress: { kind: 'determinate', value: (this.updates % 301) / 300, label: 'Processing collection' } });
      this.publish();
    }, 1000 / 30);
    this.publish();
  }
  stopStress() { if (this.interval !== undefined) clearInterval(this.interval); this.interval = undefined; this.publish(); }
  clear() { this.controller.clear(); this.note('clear removes the UI. Managed operations can still be settled on their own.'); }
  dispose() {
    if (this.stopped) return;
    this.stopStress();
    for (const timer of this.timers) clearTimeout(timer);
    for (const timer of this.progressTimers) clearInterval(timer);
    this.timers.clear(); this.progressTimers.clear();
    for (const cleanup of [...this.abortCleanups]) cleanup();
    for (const item of this.resources) item.reject(new Error('Fixture cleanup'));
    this.resources.clear();
    this.controller.dispose();
    this.tasks.clear(); this.action = undefined; this.old = undefined;
    this.publish(); this.stopped = true; this.unsubscribe(); this.listeners.clear();
  }
}
