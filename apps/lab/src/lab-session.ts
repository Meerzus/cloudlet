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
  if (!current) return 'пусто';
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
  private lastTransition = 'пусто';
  private serial = 0;
  private stopped = false;
  private interval: ReturnType<typeof setInterval> | undefined;
  private updates = 0;
  private progressHandle: NotificationHandle | undefined;
  private message = 'Выберите сценарий. Контроллер пуст.';
  private action: Deferred | undefined;
  private old: Deferred | undefined;
  private generated = 0;
  private unsubscribe: () => void;
  private snapshot!: LabSnapshot;

  constructor(autoDismiss = true) {
    this.controller = createCloudlet({ autoDismiss, messages: {
      operationSuccess: 'Готово', operationError: 'Не удалось завершить', operationCancelled: 'Операция отменена',
      cancellationRequested: 'Отмена запрошена', actionError: 'Не удалось выполнить действие', renderError: 'Содержимое недоступно',
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

  /** «3 → открыть → закрыть текущее»: a clean stack of three different records, no auto-open. */
  threeScenario() {
    this.controller.clear(); this.controller.acknowledgeOverflow();
    this.controller.show({ id: 'draft', title: 'Черновик сохранён', kind: 'success', description: { kind: 'text', text: 'Изменения записаны локально. Синхронизация начнётся при подключении.' }, duration: null, attention: 'stack' });
    this.controller.show({ id: 'upload', title: 'Файл загружен', kind: 'info', description: { kind: 'text', text: 'report.pdf · 2,4 МБ' }, duration: null, attention: 'stack',
      action: { kind: 'command', label: 'Открыть', run: () => this.note('Действие «Открыть» выполнено: карточка закрыта как action-success.') } });
    this.controller.show({ id: 'comment', title: 'Новый комментарий', duration: null, attention: 'stack' });
    this.note('Три уведомления в стопке: откройте Island, закройте текущее, сверните.');
  }

  /** Generators: each kind of record DESIGN §5 treats differently, with an explicit `attention`. */
  generate(kind: 'description' | 'action' | 'plain', attention: Attention, long = false) {
    const n = ++this.generated;
    if (kind === 'description') this.controller.show({ title: `Документ обновлён · ${n}`, kind: 'success', attention,
      description: { kind: 'text', text: long ? 'Рабочее пространство обновлено. '.repeat(35) + 'تم حفظ التغييرات بنجاح. '.repeat(12) : 'Новая версия сохранена в общей папке «Отчёты». Коллеги увидят её при следующем открытии.' } });
    else if (kind === 'action') this.controller.show({ title: `Письмо в архиве · ${n}`, kind: 'info', attention,
      action: { kind: 'command', label: 'Отменить', run: () => this.note(`Отмена для письма ${n} выполнена.`) } });
    else this.controller.show({ title: `Ссылка скопирована · ${n}`, attention });
  }
  /** A tracked operation whose first attempt fails: the Island offers retry, the next attempt succeeds. */
  generateRetry(attention: Attention) {
    const n = ++this.generated;
    const operation = this.controller.track(({ attempt }) => this.later(900, attempt === 1, attempt === 1 ? 'Сервер недоступен' : `отправлено с попытки ${attempt}`), {
      pending: { title: `Отправка отчёта · ${n}`, attention },
      success: value => ({ title: `Отчёт отправлен · ${n}`, description: { kind: 'text', text: value }, attention }),
      error: { title: `Не удалось отправить · ${n}`, description: { kind: 'text', text: 'Отчёт сохранён. Повторите, когда будете готовы.' }, attention },
    });
    this.observe(`retry-${n}`, operation);
  }
  /** Determinate progress 0 → 100 % in ~3 s, then the same record becomes success. */
  generateProgress(attention: Attention) {
    const n = ++this.generated;
    const result = this.controller.show({ title: `Загрузка архива · ${n}`, kind: 'loading', attention, duration: null,
      progress: { kind: 'determinate', value: 0, label: 'Загрузка архива' }, description: { kind: 'text', text: '0 из 20 файлов' } });
    if (result.status === 'rejected') { this.note(`Прогресс не принят: ${result.reason}`); return; }
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      if (step >= 20) {
        clearInterval(timer); this.progressTimers.delete(timer);
        this.controller.update(result.handle, { kind: 'success', title: `Архив загружен · ${n}`, progress: null, duration: 6000, description: { kind: 'text', text: '20 файлов' } });
      } else this.controller.update(result.handle, { progress: { kind: 'determinate', value: step / 20, label: 'Загрузка архива' }, description: { kind: 'text', text: `${step} из 20 файлов` } });
      this.publish();
    }, 150);
    this.progressTimers.add(timer);
    this.publish();
  }
  /** loading → success / error through `track`: the same record changes in place. */
  loadingTo(outcome: 'success' | 'error', attention: Attention) {
    const n = ++this.generated;
    const operation = this.controller.track(() => this.later(1500, outcome === 'error', outcome === 'error' ? 'Нет соединения' : 'сохранено'), {
      pending: { title: `Сохраняем изменения · ${n}`, attention, description: { kind: 'text', text: 'Это займёт пару секунд.' } },
      success: { title: `Изменения сохранены · ${n}`, attention, description: { kind: 'text', text: 'Все правки на сервере.' } },
      error: { title: `Сохранение не удалось · ${n}`, attention, description: { kind: 'text', text: 'Правки остались в черновике.' } },
    });
    this.observe(`${outcome}-${n}`, operation);
  }
  /** 101 records into an empty stack: cap 100, at least one missed in the badge. */
  overflow() {
    const free = 100 - this.controller.getSnapshot().notifications.length;
    for (let i = 0; i < Math.max(free, 0) + 1; i++) this.controller.show({ title: `Файл ${i + 1} обработан`, duration: null, attention: 'stack', announcementPriority: 'off' });
    this.note('Стопка заполнена до 100; пропущенные — в бэйдже и в строке индикатора Island.');
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
      id: `task-${name}`, pending: { title: mode === 'manual' ? `Подготовка ${name}` : mode === 'ignore' ? 'Экспорт архива' : 'Синхронизация файлов', attention: 'stack' },
      success: value => ({ title: `${name}: готово`, description: { kind: 'text', text: value }, attention: 'stack' }),
      error: { title: `${name}: ошибка`, description: { kind: 'text', text: 'Данные сохранены. Повторите попытку, когда будете готовы.' }, attention: 'stack' },
      cancelled: { title: 'Синхронизация отменена' },
    });
    this.observe(name, operation, item);
  }

  settle(name: string, reject = false) {
    const task = this.tasks.get(name);
    if (!task) return;
    if (reject) task.deferred?.reject(new Error(`${name}: отклонено вручную`)); else task.deferred?.resolve(`${name}: результат получен`);
  }
  cancel(name: string) { const result = this.tasks.get(name)?.operation.cancel(); this.note(`cancel ${name}: ${result?.status ?? 'нет попытки'}`); }
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
    }, { pending: { title: 'Сохраняем изменения' }, success: () => { throw new Error('Success mapper failure'); }, error: { title: 'Сохранение не удалось' } });
    this.observe(mapper ? 'mapper' : 'sync', operation);
  }

  showAction() {
    if (this.controller.getHandle('action-demo')) { this.note('«Публикация отчёта» уже в стопке: откройте Island.'); return; }
    let attempt = 0;
    this.controller.show({ id: 'action-demo', title: 'Публикация отчёта', duration: null,
      description: { kind: 'text', text: 'Подтвердите публикацию. При ошибке отчёт останется доступен для повтора.' },
      action: { kind: 'command', label: 'Опубликовать', errorMessage: () => 'Публикация не удалась. Попробуйте ещё раз.', run: () => {
        attempt += 1;
        if (this.action) { this.action.reject(new Error('Fixture action replaced')); this.release(this.action); }
        const item = this.resource(); this.action = item;
        this.note(`Действие: попытка ${attempt}, pending. Завершите или отклоните вручную.`);
        return item.promise.then(() => { this.release(item); this.publish(); }, reason => { this.release(item); this.publish(); throw reason; });
      } },
    });
  }
  settleAction(reject: boolean) { if (reject) this.action?.reject(new Error('Action rejected manually')); else this.action?.resolve('published'); }

  reuse() {
    if (this.old) { this.old.reject(new Error('Fixture replaced')); this.release(this.old); }
    const existing = this.controller.getHandle('reused'); if (existing) this.controller.dismiss(existing);
    const item = this.resource(); this.old = item;
    const operation = this.controller.track(() => item.promise, { id: 'reused', pending: { title: 'Старый экспорт', attention: 'stack' }, success: { title: 'Старый результат' }, error: { title: 'Старый экспорт не завершён' } });
    this.observe('old', operation, item);
    if (operation.admission.status === 'created') this.controller.dismiss(operation.admission.handle);
    this.controller.show({ id: 'reused', title: 'Новый экспорт', duration: null, attention: 'stack' });
    this.note('ID reused пересоздан. Resolve old должен дать uiApplied=false и сохранить «Новый экспорт».');
  }
  resolveOld() { this.old?.resolve('late value'); }
  dedupe() {
    for (let i = 0; i < 3; i++) this.controller.show({ title: 'Подключение восстановлено', dedupeKey: 'connection', duration: null });
  }
  burst() { for (let i = 0; i < 120; i++) this.controller.show({ title: `Файл ${i + 1} обработан`, duration: null, attention: 'stack', announcementPriority: 'off' }); }
  capacityTask() {
    const operation = this.controller.track(() => 'business despite capacity', { pending: { title: 'Готовим архив' }, success: { title: 'Архив готов' }, error: { title: 'Архив недоступен' } });
    this.observe('capacity', operation);
  }
  startStress() {
    if (this.interval !== undefined || this.controller.getSnapshot().disposed) return;
    const previous = this.progressHandle && this.controller.getSnapshot().notifications.find(item => item.handle === this.progressHandle);
    const result = previous ? { status: 'created' as const, handle: previous.handle } : this.controller.show({ title: 'Обработка коллекции', kind: 'loading', progress: { kind: 'determinate', value: 0 }, duration: null, attention: 'stack', announcementPriority: 'off' });
    this.burst();
    if (result.status === 'rejected') { this.note('Для progress нужен свободный слот: выполните reset. Burst завершён.'); return; }
    this.progressHandle = result.handle;
    this.interval = setInterval(() => {
      this.updates += 1;
      this.controller.update(result.handle, { progress: { kind: 'determinate', value: (this.updates % 301) / 300, label: 'Обработка коллекции' } });
      this.publish();
    }, 1000 / 30);
    this.publish();
  }
  stopStress() { if (this.interval !== undefined) clearInterval(this.interval); this.interval = undefined; this.publish(); }
  clear() { this.controller.clear(); this.note('clear удаляет UI. Управляемые операции можно завершить независимо.'); }
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
