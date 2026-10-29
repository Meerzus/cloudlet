import { useEffect, useState, useSyncExternalStore } from 'react';
import { Toaster, useCloudlet } from '@cloudlet/toast';
import type { NotificationHandle, ReactNotificationPatch, ReactNotificationSpec } from '@cloudlet/toast';
import { fixtureLabels, islandState, nonce } from './fixture-kit.js';
import type { IslandState } from './fixture-kit.js';
import { closeCurrent, collapseIsland, keepIslandOnLabControls, openIsland } from './pilot.js';

export interface SurfaceFixtureApi {
  reset: (records?: readonly ReactNotificationSpec[]) => void;
  update: (id: string, patch: ReactNotificationPatch) => void;
  dismiss: (id: string) => void;
  open: () => boolean;
  collapse: () => boolean;
  closeCurrent: () => boolean;
  loading: () => void;
  complete: (outcome?: 'success' | 'error') => void;
  snapshot: () => IslandState & { ids: readonly string[] };
}

declare global {
  interface Window { surfaceFixture?: SurfaceFixtureApi; }
}

export const longTitle = 'A very long notification saying that every change is ready and the documents are synced between devices';
export const longDescription = 'The description stays readable even in a narrow window. '.repeat(10)
  + 'https://example.com/a-very-long-path-without-any-spaces/abcdefghijklmnopqrstuvwxyz0123456789'.repeat(4);

const three: readonly ReactNotificationSpec[] = [
  { id: 'C', title: 'Draft saved', kind: 'success', description: { kind: 'text', text: 'Changes are stored locally.' } },
  { id: 'B', title: 'File uploaded', kind: 'info', action: { kind: 'command', label: 'Open', run: () => undefined } },
  { id: 'A', title: 'New comment' },
];

/**
 * `?surface`: the measured shell of the stack → Island model under
 * container width, font size, theme, mount and dispose changes. Mutations go through
 * the public controller; open/collapse go through the pill and Escape like a user.
 */
export function SurfaceFixture() {
  const controller = useCloudlet();
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  const [attached, setAttached] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const [largeFont, setLargeFont] = useState(false);
  const [disposed, setDisposed] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const state = islandState(controller);

  useEffect(() => keepIslandOnLabControls(window), []);
  useEffect(() => {
    let finish: ((success: boolean) => void) | undefined;
    const host = () => document.querySelector('.cloudlet-host');
    const handle = (id: string): NotificationHandle => {
      const found = controller.getHandle(id);
      if (!found) throw new Error(`Missing fixture notification: ${id}`);
      return found;
    };
    const api: SurfaceFixtureApi = {
      reset: (records = [{ id: 'A', title: 'Saved', description: { kind: 'text', text: longDescription } }]) => {
        controller.clear();
        controller.acknowledgeOverflow();
        // Oldest first: the last record is the top pill.
        for (const record of records) controller.show({ duration: null, attention: 'stack', ...record });
      },
      update: (id, patch) => { controller.update(handle(id), patch); },
      dismiss: id => { controller.dismiss(handle(id)); },
      open: () => openIsland(host()),
      collapse: () => collapseIsland(host()),
      closeCurrent: () => closeCurrent(host()),
      loading: () => {
        controller.clear();
        const promise = new Promise<void>((resolve, reject) => { finish = success => { if (success) resolve(); else reject(new Error('Fixture failure')); }; });
        const operation = controller.track(promise, {
          id: 'operation',
          pending: { title: 'Uploading document', description: { kind: 'text', text: longDescription }, progress: { kind: 'indeterminate' }, attention: 'stack' },
          success: { title: 'Document ready', description: { kind: 'text', text: 'The upload finished without recreating the shell.' }, duration: null },
          error: { title: 'Upload error', description: { kind: 'text', text: 'The connection dropped.' }, duration: null },
        });
        void operation.result.catch(() => undefined);
      },
      complete: (outcome = 'success') => { finish?.(outcome === 'success'); finish = undefined; },
      snapshot: () => ({ ...islandState(controller), ids: controller.getSnapshot().notifications.map(item => item.handle.id) }),
    };
    window.surfaceFixture = api;
    api.reset();
    return () => { if (window.surfaceFixture === api) delete window.surfaceFixture; };
  }, [controller]);

  useEffect(() => {
    document.body.dataset['surfaceNarrow'] = String(narrow);
    document.body.dataset['surfaceFont'] = largeFont ? 'large' : 'normal';
    return () => {
      delete document.body.dataset['surfaceNarrow'];
      delete document.body.dataset['surfaceFont'];
    };
  }, [narrow, largeFont]);

  return <>
    <main>
      <p className="eyebrow">Shell check</p>
      <h1>Cloudlet surface</h1>
      <p>The pill, the morph into the Island, content and progress changes while the width, font, theme and mounting change. The page keeps the default browser margin and uses no global reset.</p>
      <div className="controls" data-lab-keep-island="">
        <button type="button" onClick={() => window.surfaceFixture?.reset()}>Short title</button>
        <button type="button" onClick={() => window.surfaceFixture?.reset([{ id: 'long', title: longTitle, description: { kind: 'text', text: longDescription }, action: { kind: 'command', label: 'Confirm', run: () => Promise.resolve() } }])}>Long text</button>
        <button type="button" onClick={() => window.surfaceFixture?.reset(three)}>Three records</button>
        <button type="button" onClick={() => window.surfaceFixture?.open()} disabled={state.state === 'island' || !state.stack.length}>Open Island</button>
        <button type="button" onClick={() => window.surfaceFixture?.collapse()} disabled={state.state !== 'island'}>Collapse</button>
        <button type="button" onClick={() => window.surfaceFixture?.loading()}>Loading</button>
        <button type="button" onClick={() => window.surfaceFixture?.complete('success')}>→ success</button>
        <button type="button" onClick={() => window.surfaceFixture?.complete('error')}>→ error</button>
      </div>
      <div className="controls">
        <button type="button" onClick={() => setNarrow(value => !value)}>Container size</button>
        <button type="button" onClick={() => setLargeFont(value => !value)}>Font size</button>
        <button type="button" onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}>Surface theme</button>
        <button type="button" onClick={() => setAttached(value => !value)} disabled={disposed}>{attached ? 'Unmount' : 'Mount'}</button>
        <button type="button" onClick={() => { controller.dispose(); setDisposed(true); }}>Dispose</button>
      </div>
      <output data-testid="fixture-state">{JSON.stringify({
        records: snapshot.notifications.length, state: state.state, current: state.current, readable: state.readable, disposed: snapshot.disposed,
      })}</output>
    </main>
    {attached && <Toaster theme={theme} position="top-center" {...(nonce() ? { nonce: nonce()! } : {})}
      offsets={{ gutter: { top: 16, right: 16, bottom: 16, left: 16 } }} labels={fixtureLabels} />}
  </>;
}
