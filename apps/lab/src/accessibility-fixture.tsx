import { useEffect, useState, useSyncExternalStore } from 'react';
import { Toaster, useCloudlet } from '@cloudlet/toast';
import type { AnnouncementFormatters, CloudletLabels, NotificationHandle, ReactNotificationPatch, ReactNotificationSpec } from '@cloudlet/toast';
import { islandState } from './fixture-kit.js';
import type { IslandState } from './fixture-kit.js';
import { collapseIsland, keepIslandOnLabControls, openIsland } from './pilot.js';
import './accessibility-fixture.css';

export interface AccessibilityFixtureApi {
  reset: (records?: readonly ReactNotificationSpec[]) => void;
  show: (record: ReactNotificationSpec) => void;
  update: (id: string, patch: ReactNotificationPatch) => void;
  dismiss: (id: string) => void;
  open: () => boolean;
  collapse: () => boolean;
  theme: (theme: 'light' | 'dark' | 'system') => void;
  dir: (dir: 'ltr' | 'rtl') => void;
  attach: (attached: boolean) => void;
  command: () => void;
  settleAction: (success: boolean) => void;
  operation: () => void;
  settleOperation: (success: boolean) => void;
  rich: () => void;
  snapshot: () => IslandState & {
    ids: readonly string[];
    actionAttempts: number;
    operationAttempts: number;
  };
}

declare global {
  interface Window { accessibilityFixture?: AccessibilityFixtureApi; }
}

const labels: CloudletLabels = {
  region: 'Уведомления', island: 'Текущие уведомления', carousel: 'карусель', slide: 'слайд', close: 'Закрыть уведомление', collapse: 'Escape — свернуть',
  retry: 'Повторить', cancel: 'Запросить отмену', cancellationRequested: 'Отмена запрошена', acknowledgeOverflow: 'Подтвердить пропущенные',
  stackSummary: (title, count, missed) => [title, ...(count > 1 ? [`уведомлений: ${count}`] : []), ...(missed ? [`пропущено: ${missed}`] : [])].join(', '),
  page: (index, total) => `${index} из ${total}`,
  overflowCount: count => `Пропущено: ${count}`,
};

const announcements: AnnouncementFormatters = {
  notification: notification => {
    const description = notification.content.description;
    return `Событие: ${notification.content.title}${description ? `. ${description.kind === 'text' ? description.text : description.announcement}` : ''}`;
  },
  queued: count => `В очереди: ${count}`,
  occurrences: notification => `Повторов: ${notification.occurrences}`,
  overflow: count => `Пропущено: ${count}`,
  operation: (notification, phase) => `Операция ${phase}: ${notification.content.title}`,
  actionPending: notification => `Выполняется действие: ${notification.content.title}`,
  actionError: (_notification, message) => `Ошибка действия: ${message}`,
  resumed: count => `Актуальных уведомлений: ${count}`,
};

/**
 * `?fixture=accessibility` (tasks 07, 16): keyboard, roles and names of the stack → Island
 * model (DESIGN §9), localization, announcements and the no-auto-dismiss preference.
 * Data mutations use the public controller API; open/collapse go through the pill and Escape.
 */
export function AccessibilityFixture() {
  const controller = useCloudlet();
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('light');
  const [dir, setDir] = useState<'ltr' | 'rtl'>('ltr');
  const [attached, setAttached] = useState(true);
  const nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;

  useEffect(() => keepIslandOnLabControls(window), []);
  useEffect(() => {
    const host = () => document.querySelector('.cloudlet-host');
    let finishAction: ((success: boolean) => void) | undefined;
    let finishOperation: ((success: boolean) => void) | undefined;
    let actionAttempts = 0;
    let operationAttempts = 0;
    const handle = (id: string): NotificationHandle => {
      const found = controller.getHandle(id);
      if (!found) throw new Error(`Missing fixture notification: ${id}`);
      return found;
    };
    const api: AccessibilityFixtureApi = {
      reset: (records = []) => {
        controller.clear();
        controller.acknowledgeOverflow();
        for (const record of records) controller.show({ duration: null, attention: 'stack', ...record });
      },
      show: record => { controller.show({ duration: null, attention: 'stack', ...record }); },
      update: (id, patch) => { controller.update(handle(id), patch); },
      dismiss: id => { controller.dismiss(handle(id)); },
      open: () => openIsland(host()),
      collapse: () => collapseIsland(host()),
      theme: setTheme, dir: setDir, attach: setAttached,
      command: () => {
        controller.clear();
        actionAttempts = 0;
        controller.show({
          id: 'action', title: 'Сохранение документа', duration: null, announcementPriority: 'polite',
          description: { kind: 'text', text: 'При ошибке контекст сохранится и действие можно повторить.' },
          action: {
            kind: 'command', label: 'Сохранить', errorMessage: () => 'Не удалось сохранить. Повторите действие.',
            run: () => {
              actionAttempts += 1;
              return new Promise<void>((resolve, reject) => {
                finishAction = success => { if (success) resolve(); else reject(new Error('Acceptance action failure')); };
              });
            },
          },
        });
      },
      settleAction: success => { const finish = finishAction; finishAction = undefined; finish?.(success); },
      operation: () => {
        controller.clear();
        operationAttempts = 0;
        const operation = controller.track(() => {
          operationAttempts += 1;
          return new Promise<void>((resolve, reject) => {
            finishOperation = success => { if (success) resolve(); else reject(new Error('Acceptance operation failure')); };
          });
        }, {
          id: 'operation',
          pending: { title: 'Загрузка документа', announcementPriority: 'polite', progress: { kind: 'determinate', value: 0.1, label: 'Прогресс загрузки' } },
          success: { title: 'Документ загружен', announcementPriority: 'polite', duration: null },
          error: { title: 'Загрузка не удалась', announcementPriority: 'assertive', duration: null },
        });
        void operation.result.catch(() => undefined);
      },
      settleOperation: success => { const finish = finishOperation; finishOperation = undefined; finish?.(success); },
      rich: () => {
        controller.clear();
        controller.show({
          id: 'rich', title: 'Богатое описание', duration: null,
          description: { kind: 'rich', content: <p>Визуальный контекст <strong>документа</strong> 📄</p>, announcement: 'Документ готов к проверке.' },
        });
      },
      snapshot: () => ({ ...islandState(controller), ids: controller.getSnapshot().notifications.map(item => item.handle.id),
        actionAttempts, operationAttempts }),
    };
    window.accessibilityFixture = api;
    api.reset();
    return () => { if (window.accessibilityFixture === api) delete window.accessibilityFixture; };
  }, [controller]);

  return <>
    <main className="accessibility-fixture">
      <p className="eyebrow">Задачи 07, 16 · Проверка доступности</p>
      <h1>Cloudlet accessibility</h1>
      <p>Пилюля — кнопка с именем «заголовок, уведомлений: N»; Enter открывает Island и переносит фокус на заголовок, ← / → / Home / End листают, Escape сворачивает и возвращает фокус на пилюлю. Локализация, объявления и предпочтение отключения автозакрытия.</p>
      <div className="controls" data-lab-keep-island="">
        <button id="accessibility-origin" type="button" onClick={() => controller.requestFocus()}>Перейти к уведомлениям</button>
        <button type="button" onClick={() => window.accessibilityFixture?.reset([{ id: 'one', title: 'Черновик сохранён' }, { id: 'two', title: 'Файл загружен', description: { kind: 'text', text: 'report.pdf' } }, { id: 'three', title: 'Новый комментарий' }])}>Три уведомления</button>
        <button type="button" onClick={() => window.accessibilityFixture?.open()} disabled={snapshot.island.open || !snapshot.stack.length}>Открыть Island</button>
        <button type="button" onClick={() => window.accessibilityFixture?.collapse()} disabled={!snapshot.island.open}>Свернуть</button>
        <button type="button" onClick={() => window.accessibilityFixture?.command()}>Проверить действие</button>
        <button type="button" onClick={() => window.accessibilityFixture?.operation()}>Проверить операцию</button>
        <button id="accessibility-after" type="button" onClick={() => controller.clear()}>Очистить уведомления</button>
      </div>
      <output data-testid="accessibility-state">{snapshot.notifications.length} уведомлений; {snapshot.island.open ? `island · ${snapshot.island.reason}` : 'stack'}</output>
      <p id="accessibility-destination" tabIndex={-1}>Цель настоящей ссылки</p>
    </main>
    {attached && <Toaster theme={theme} dir={dir} position="bottom-center" labels={labels} announcements={announcements} {...(nonce ? { nonce } : {})} />}
  </>;
}
