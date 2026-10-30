import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Toaster, useCloudlet } from '@cloudlet/toast';
import type { NotificationHandle, ReactNotificationPatch, ReactNotificationSpec, ToasterOffsets, ToasterProps } from '@cloudlet/toast';
import { fixtureLabels, islandState, nonce } from './fixture-kit.js';
import type { IslandState } from './fixture-kit.js';
import { collapseIsland, keepIslandOnLabControls, openIsland } from './pilot.js';

export interface MobileFixtureApi {
  reset: (records?: readonly ReactNotificationSpec[]) => void;
  show: (record: ReactNotificationSpec) => void;
  update: (id: string, patch: ReactNotificationPatch) => void;
  dismiss: (id: string) => void;
  open: () => boolean;
  collapse: () => boolean;
  position: (position: NonNullable<ToasterProps['position']>) => void;
  offsets: (offsets: ToasterOffsets) => void;
  attach: (attached: boolean) => void;
  portal: (portal: 'body' | 'custom' | 'dialog') => void;
  command: () => void;
  link: () => void;
  /** A record with a reply form (or a name and a note); each send waits for `settleForm`. */
  form: (fields?: 'reply' | 'note') => void;
  settleForm: (ok: boolean) => void;
  snapshot: () => IslandState & {
    records: readonly { id: string; remaining: number | null; pauses: readonly string[]; draft: boolean }[];
    actionAttempts: number;
    closes: readonly { id: string; reason: string }[];
    sent: readonly Readonly<Record<string, string>>[];
  };
}

declare global {
  interface Window { mobileFixture?: MobileFixtureApi; }
}

const description = 'Scrollable mobile context stays readable while the viewport changes. '.repeat(35);

/**
 * `?fixture=mobile`: viewport, safe area, portals and swipes of the stack → Island model.
 * Swipe the pill sideways to dismiss the top record; in the Island swipe to navigate and
 * swipe the header towards the edge to collapse. Controller mutations use its public API.
 */
export function MobileFixture() {
  const controller = useCloudlet();
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  const [position, setPosition] = useState<NonNullable<ToasterProps['position']>>('auto');
  const [offsets, setOffsets] = useState<ToasterOffsets>({});
  const [attached, setAttached] = useState(true);
  const [portal, setPortal] = useState<'body' | 'custom' | 'dialog'>('body');
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => keepIslandOnLabControls(window), []);
  useEffect(() => {
    let actionAttempts = 0;
    const closes: { id: string; reason: string }[] = [];
    const sent: Readonly<Record<string, string>>[] = [];
    let settle: ((ok: boolean) => void) | null = null;
    const host = () => document.querySelector('.cloudlet-host');
    const handle = (id: string): NotificationHandle => {
      const found = controller.getHandle(id);
      if (!found) throw new Error(`Missing mobile notification: ${id}`);
      return found;
    };
    const show = (record: ReactNotificationSpec) => {
      controller.show({ duration: null, attention: 'stack', ...record, onClose: notice => {
        closes.push({ id: notice.handle.id, reason: notice.reason });
        record.onClose?.(notice);
      } });
    };
    const reset = (records: readonly ReactNotificationSpec[] = [
      { id: 'A', title: 'Mobile A', description: { kind: 'text', text: description } },
      { id: 'B', title: 'Mobile B' },
      { id: 'C', title: 'Mobile C', kind: 'success' },
    ]) => {
      controller.clear();
      controller.acknowledgeOverflow();
      closes.length = 0;
      for (const record of records) show(record);
    };
    const api: MobileFixtureApi = {
      reset, show,
      update: (id, patch) => { controller.update(handle(id), patch); },
      dismiss: id => { controller.dismiss(handle(id)); },
      open: () => openIsland(host()),
      collapse: () => collapseIsland(host()),
      position: setPosition, offsets: setOffsets, attach: setAttached, portal: setPortal,
      command: () => {
        actionAttempts = 0;
        reset([{ id: 'successor', title: 'After command' }, { id: 'action', title: 'Mobile command', description: { kind: 'text', text: description },
          action: { kind: 'command', label: 'Execute action', run: () => {
            actionAttempts += 1;
            return new Promise<void>(() => undefined);
          } } }]);
      },
      link: () => reset([{ id: 'successor', title: 'After link' }, { id: 'link', title: 'Mobile link', action: {
        kind: 'link', label: 'Open destination', href: '#mobile-destination',
      } }]),
      form: (fields = 'reply') => {
        sent.length = 0;
        reset([{ id: 'successor', title: 'After form' }, { id: 'form', title: 'Anna: are you coming?', description: { kind: 'text', text: 'Dinner at eight.' },
          action: { kind: 'form', label: 'Send', errorMessage: () => 'Could not send',
            fields: fields === 'reply' ? [{ name: 'reply', kind: 'text', label: 'Reply', required: true }]
              : [{ name: 'name', kind: 'text', label: 'Name' }, { name: 'note', kind: 'textarea', label: 'Note', required: true }],
            validate: values => fields === 'reply' || (values.note ?? '').trim().length >= 3 || { note: 'Write at least three characters' },
            run: ({ values }) => {
              sent.push(values);
              return new Promise<void>((resolve, reject) => { settle = ok => (ok ? resolve() : reject(new Error('offline'))); });
            } } }]);
      },
      settleForm: ok => { settle?.(ok); settle = null; },
      snapshot: () => ({ ...islandState(controller),
        records: controller.getSnapshot().notifications.map(item => ({ id: item.handle.id, remaining: item.remainingMs, pauses: item.pauseReasons, draft: item.draft })),
        actionAttempts, closes: [...closes], sent: [...sent] }),
    };
    window.mobileFixture = api;
    reset();
    return () => { if (window.mobileFixture === api) delete window.mobileFixture; };
  }, [controller]);

  useEffect(() => {
    const element = dialog.current;
    if (portal === 'dialog') element?.showModal();
    return () => { if (element?.open) element.close(); };
  }, [portal]);

  return <>
    <main>
      <p className="eyebrow">Mobile acceptance</p>
      <h1>Viewport and gestures</h1>
      <p>Swipe the pill sideways to dismiss the top record. Open the Island, swipe between records, swipe its header towards the screen edge to collapse. Page scrolling and a real text input remain native.</p>
      <div className="controls" data-lab-keep-island="">
        <button id="mobile-origin" type="button" onClick={() => controller.requestFocus()}>Focus notifications</button>
        <button type="button" onClick={() => window.mobileFixture?.reset()}>Reset mobile records</button>
        <button type="button" onClick={() => window.mobileFixture?.open()} disabled={snapshot.island.open || !snapshot.stack.length}>Open Island</button>
        <button type="button" onClick={() => window.mobileFixture?.collapse()} disabled={!snapshot.island.open}>Collapse</button>
        <label>Keyboard input<input id="mobile-input" type="text" autoComplete="off" /></label>
      </div>
      <output data-testid="mobile-state">{snapshot.notifications.length} notifications; {snapshot.island.open ? `island · ${snapshot.island.reason}` : 'stack'}</output>
      {Array.from({ length: 24 }, (_, index) => <p key={index}>Page scroll paragraph {index + 1}. Native vertical gestures belong to the browser.</p>)}
      <p id="mobile-destination" tabIndex={-1}>Native link destination</p>
    </main>
    <div id="mobile-custom-portal" />
    <dialog id="mobile-dialog-portal" ref={dialog}><p>Application top layer</p></dialog>
    {attached && <Toaster key={portal} position={position} offsets={offsets} theme="light" labels={fixtureLabels}
      {...(portal === 'body' ? {} : { container: () => document.getElementById(`mobile-${portal === 'custom' ? 'custom' : 'dialog'}-portal`) })}
      {...(nonce() ? { nonce: nonce()! } : {})} />}
  </>;
}
