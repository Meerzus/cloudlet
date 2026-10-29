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
  region: 'Notifications', island: 'Current notifications', carousel: 'carousel', slide: 'slide', close: 'Close notification', collapse: 'Escape to collapse',
  retry: 'Retry', cancel: 'Request cancellation', cancellationRequested: 'Cancellation requested', acknowledgeOverflow: 'Acknowledge missed',
  stackSummary: (title, count, missed) => [title, ...(count > 1 ? [`notifications: ${count}`] : []), ...(missed ? [`missed: ${missed}`] : [])].join(', '),
  page: (index, total) => `${index} of ${total}`,
  overflowCount: count => `Missed: ${count}`,
};

const announcements: AnnouncementFormatters = {
  notification: notification => {
    const description = notification.content.description;
    return `Event: ${notification.content.title}${description ? `. ${description.kind === 'text' ? description.text : description.announcement}` : ''}`;
  },
  queued: count => `Queued: ${count}`,
  occurrences: notification => `Repeats: ${notification.occurrences}`,
  overflow: count => `Missed: ${count}`,
  operation: (notification, phase) => `Operation ${phase}: ${notification.content.title}`,
  actionPending: notification => `Action running: ${notification.content.title}`,
  actionError: (_notification, message) => `Action failed: ${message}`,
  resumed: count => `Current notifications: ${count}`,
};

/**
 * `?fixture=accessibility`: keyboard, roles and names of the stack → Island
 * model, localization, announcements and the no-auto-dismiss preference.
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
          id: 'action', title: 'Saving document', duration: null, announcementPriority: 'polite',
          description: { kind: 'text', text: 'If it fails, the context stays and the action can be retried.' },
          action: {
            kind: 'command', label: 'Save', errorMessage: () => 'Could not save. Retry the action.',
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
          pending: { title: 'Uploading document', announcementPriority: 'polite', progress: { kind: 'determinate', value: 0.1, label: 'Upload progress' } },
          success: { title: 'Document uploaded', announcementPriority: 'polite', duration: null },
          error: { title: 'Upload failed', announcementPriority: 'assertive', duration: null },
        });
        void operation.result.catch(() => undefined);
      },
      settleOperation: success => { const finish = finishOperation; finishOperation = undefined; finish?.(success); },
      rich: () => {
        controller.clear();
        controller.show({
          id: 'rich', title: 'Rich description', duration: null,
          description: { kind: 'rich', content: <p>Visual context of the <strong>document</strong> 📄</p>, announcement: 'The document is ready for review.' },
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
      <p className="eyebrow">Accessibility check</p>
      <h1>Cloudlet accessibility</h1>
      <p>The pill is a button named “title, notifications: N”; Enter opens the Island and moves focus to the title, ← / → / Home / End page, Escape collapses and returns focus to the pill. Localisation, announcements and the preference to turn auto-dismiss off.</p>
      <div className="controls" data-lab-keep-island="">
        <button id="accessibility-origin" type="button" onClick={() => controller.requestFocus()}>Go to notifications</button>
        <button type="button" onClick={() => window.accessibilityFixture?.reset([{ id: 'one', title: 'Draft saved' }, { id: 'two', title: 'File uploaded', description: { kind: 'text', text: 'report.pdf' } }, { id: 'three', title: 'New comment' }])}>Three notifications</button>
        <button type="button" onClick={() => window.accessibilityFixture?.open()} disabled={snapshot.island.open || !snapshot.stack.length}>Open Island</button>
        <button type="button" onClick={() => window.accessibilityFixture?.collapse()} disabled={!snapshot.island.open}>Collapse</button>
        <button type="button" onClick={() => window.accessibilityFixture?.command()}>Check action</button>
        <button type="button" onClick={() => window.accessibilityFixture?.operation()}>Check operation</button>
        <button id="accessibility-after" type="button" onClick={() => controller.clear()}>Clear notifications</button>
      </div>
      <output data-testid="accessibility-state">{snapshot.notifications.length} notifications; {snapshot.island.open ? `island · ${snapshot.island.reason}` : 'stack'}</output>
      <p id="accessibility-destination" tabIndex={-1}>Target of a real link</p>
    </main>
    {attached && <Toaster theme={theme} dir={dir} position="bottom-center" labels={labels} announcements={announcements} {...(nonce ? { nonce } : {})} />}
  </>;
}
