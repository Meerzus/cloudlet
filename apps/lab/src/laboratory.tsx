import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { CloudletProvider, Toaster } from '@cloudlet/toast';
import type { CloudletMotionOverrides, ToasterProps } from '@cloudlet/toast';
import { LabSession } from './lab-session.js';
import type { Attention } from './lab-session.js';
import { installMotionPreference, type MotionPreference } from './motion-preference.js';
import { MotionPanel, timeScales, useMotionOverrides } from './motion-panel.js';
import { closeCurrent, collapseIsland, keepIslandOnLabControls, openIsland } from './pilot.js';
import { Choice } from './choice.js';
import { observeHostInput } from './debug-log.js';
import './styles.css';

export const labels: NonNullable<ToasterProps['labels']> = {
  region: 'Notifications', island: 'Current notifications', carousel: 'carousel', slide: 'slide', close: 'Close notification', collapse: 'Escape to collapse',
  retry: 'Retry', cancel: 'Request cancellation', cancellationRequested: 'Cancellation requested', acknowledgeOverflow: 'Acknowledge missed',
  stackSummary: (title, count, missed) => [title, ...(count > 1 ? [`notifications: ${count}`] : []), ...(missed ? [`missed: ${missed}`] : [])].join(', '),
  page: (index, total) => `${index} of ${total}`,
  overflowCount: count => `Not accepted: ${count}`,
};
const nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;
const mainHost = () => document.querySelector('.lab-main-host');

type Position = NonNullable<ToasterProps['position']>;
type Theme = NonNullable<ToasterProps['theme']>;
type Motion = { timeScale: number; overrides: CloudletMotionOverrides };

function useInputJournal() { useEffect(() => observeHostInput(), []); }

function useSession(autoDismiss: boolean, epoch: number) {
  const [session, setSession] = useState<LabSession>();
  useEffect(() => {
    const next = new LabSession(autoDismiss); setSession(next);
    return () => next.dispose();
  }, [autoDismiss, epoch]);
  return session;
}

function Settings({ position, setPosition, theme, setTheme, dir, setDir, motion, setMotion, inset, setInset, long, setLong, auto, setAuto }: {
  position: Position; setPosition: (value: Position) => void; theme: Theme; setTheme: (value: Theme) => void;
  dir: 'ltr' | 'rtl'; setDir: (value: 'ltr' | 'rtl') => void; motion: MotionPreference; setMotion: (value: MotionPreference) => void;
  inset: boolean; setInset: (value: boolean) => void; long: boolean; setLong: (value: boolean) => void; auto: boolean; setAuto: (value: boolean) => void;
}) {
  return <section className="lab-settings" aria-labelledby="settings-title">
    <h2 id="settings-title">Display</h2>
    <div className="lab-fields">
      <Choice label="Position" value={position} onChange={setPosition} options={[['auto', 'Auto · by width'], ['top-center', 'Top'], ['bottom-center', 'Bottom']]} />
      <Choice label="Theme" value={theme} onChange={setTheme} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} />
      <Choice label="Direction" value={dir} onChange={setDir} options={[['ltr', 'LTR'], ['rtl', 'RTL']]} />
      <Choice label="Motion" value={motion} onChange={setMotion} options={[['system', 'As the system'], ['reduce', 'Reduce · emulated'], ['full', 'Full · explicit']]} />
    </div>
    <div className="lab-checks">
      <label><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />Auto-dismiss after reset</label>
      <label><input type="checkbox" checked={inset} onChange={e => setInset(e.target.checked)} />Bottom bar · 72px</label>
      <label><input type="checkbox" checked={long} onChange={e => setLong(e.target.checked)} />Long description</label>
    </div>
    <p className="lab-hint">Auto-dismiss applies on “Recreate main”. Motion emulates the media preference inside the laboratory only. Speed (timeScale) is in the header and in “Motion tuning” (reachable there while the Island is open); springs are in “Motion tuning”.</p>
  </section>;
}

/** Live `data-state` / `data-island-reason` of the main host, read from the DOM. */
function useHostState() {
  const [state, setState] = useState('—');
  useEffect(() => {
    let observed: Element | null = null;
    const read = () => {
      const host = mainHost();
      setState(host ? `${host.getAttribute('data-state') ?? '—'}${host.hasAttribute('data-island-reason') ? ` · ${host.getAttribute('data-island-reason')}` : ''}` : 'no host');
      if (host && host !== observed) { observed = host; attributes.disconnect(); attributes.observe(host, { attributes: true, attributeFilter: ['data-state', 'data-island-reason'] }); }
    };
    const attributes = new MutationObserver(read);
    // The host mounts and remounts with the Toaster: watch the document for it.
    const tree = new MutationObserver(() => { if (mainHost() !== observed) read(); });
    tree.observe(document.body, { childList: true, subtree: true });
    read();
    return () => { attributes.disconnect(); tree.disconnect(); };
  }, []);
  return state;
}

function Scenario({ session, disabled }: { session: LabSession; disabled: boolean }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const snapshot = useSyncExternalStore(session.controller.subscribe, session.controller.getSnapshot, session.controller.getServerSnapshot);
  const dom = useHostState();
  const report = (done: boolean, missing: string) => { if (!done) session.note(missing); };
  return <section aria-labelledby="scenario-title" data-lab-keep-island="">
    <h2 id="scenario-title">Scenario: 3 → open → close current</h2>
    <p>Three different notifications without auto-open: one with a description, one with an action and a plain one. Open the Island, close the current one (it slides to the older one), collapse. Buttons and fields of the workspace never collapse the Island; a click on the page background, on “Display” or Escape does.</p>
    <div className="lab-buttons">
      <button disabled={disabled} className="lab-primary" onClick={() => session.threeScenario()}>3 notifications</button>
      <button disabled={disabled || snapshot.island.open || !snapshot.stack.length} onClick={() => report(openIsland(mainHost()), 'No pill: the stack is empty or the Toaster is detached.')}>Open Island</button>
      <button disabled={disabled || !snapshot.island.open} onClick={() => report(closeCurrent(mainHost()), 'Island closed.')}>Close current</button>
      <button disabled={disabled || !snapshot.island.open} onClick={() => report(collapseIsland(mainHost()), 'Island closed.')}>Collapse</button>
    </div>
    <p className="lab-mono" data-testid="island-state">DOM data-state: <b>{dom}</b> · stack {snapshot.stack.length}</p>
    <ol data-testid="transition-log" className="lab-log lab-transitions" tabIndex={0} aria-label="Stack and Island transitions">
      {state.transitions.length === 0 ? <li className="lab-empty">No transitions yet.</li> : state.transitions.map(entry => <li key={entry.sequence}>{entry.text}</li>)}
    </ol>
  </section>;
}

function Generators({ session, disabled, long }: { session: LabSession; disabled: boolean; long: boolean }) {
  const [attention, setAttention] = useState<Attention>('auto');
  return <section aria-labelledby="generators-title" data-lab-keep-island="">
    <h2 id="generators-title">Notification generators</h2>
    <p><code>auto</code> opens the Island after 600 ms for a notification with a description, an action or a retry; <code>open</code> always does, <code>stack</code> never. While the pointer is over the notifications or focus is inside, the auto-open waits.</p>
    <div className="lab-fields lab-fields-inline"><Choice label="attention" value={attention} onChange={setAttention} options={[['auto', 'auto'], ['open', 'open'], ['stack', 'stack']]} /></div>
    <div className="lab-buttons">
      <button disabled={disabled} onClick={() => session.generate('description', attention, long)}>With description</button>
      <button disabled={disabled} onClick={() => session.generate('action', attention)}>With action</button>
      <button disabled={disabled} onClick={() => session.generateRetry(attention)}>With retry</button>
      <button disabled={disabled} onClick={() => session.generateProgress(attention)}>With progress</button>
      <button disabled={disabled} onClick={() => session.generate('plain', attention)}>Plain</button>
      <button disabled={disabled} onClick={() => session.generateForm('reply', attention)}>With form</button>
      <button disabled={disabled} onClick={() => session.generateForm('note', attention)}>With form · note</button>
    </div>
    <div className="lab-buttons">
      <button disabled={disabled} onClick={() => session.loadingTo('success', attention)}>Loading → success</button>
      <button disabled={disabled} onClick={() => session.loadingTo('error', attention)}>Loading → error</button>
      <button disabled={disabled} onClick={() => session.overflow()}>Overflow · 101</button>
      <button disabled={disabled} onClick={() => session.controller.acknowledgeOverflow()}>Acknowledge missed</button>
    </div>
  </section>;
}

function Workspace({ session, position, theme, dir, inset, long, motion, recreate, studio }: {
  session: LabSession; position: Position; theme: Theme; dir: 'ltr' | 'rtl'; inset: boolean; long: boolean; motion: Motion;
  recreate: () => void; studio: ReactNode;
}) {
  const controller = session.controller;
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  const [attached, setAttached] = useState(true);
  const disabled = snapshot.disposed;
  const startABC = () => { for (const name of ['A', 'B', 'C']) session.start(name); };
  const reverse = (reject: boolean) => { for (const name of ['C', 'B', 'A']) session.settle(name, reject); };
  return <>
    <div className="lab-status" data-testid="lab-summary" data-count={snapshot.notifications.length} data-overflow={snapshot.overflow.count} data-disposed={snapshot.disposed}
      data-state={snapshot.island.open ? 'island' : 'stack'}>
      <span><b>{snapshot.notifications.length}</b> accepted</span><span><b>{snapshot.stack.length}</b> in stack</span><span><b>{snapshot.overflow.count}</b> missed</span>
      <span>{snapshot.island.open ? `island · ${snapshot.island.reason}` : 'stack'} · {disabled ? 'disposed' : attached ? 'attached' : 'no renderer'}</span>
    </div>
    <div className="lab-studio" data-lab-keep-island="">
      <div className="lab-scenarios">
        <Scenario session={session} disabled={disabled} />
        <Generators session={session} disabled={disabled} long={long} />
      </div>
      {studio}
    </div>
    <div className="lab-workspace" data-lab-keep-island="">
      <div className="lab-scenarios">
        <section aria-labelledby="basic-title"><h2 id="basic-title">Identity and time</h2><p>“Show notification” is a success with a description and the default time: it auto-opens (attention auto) and closes by TTL while there is no hover or focus. A shared ID does not link the two controllers. The link closes its record by navigation.</p>
          <div className="lab-buttons"><button disabled={disabled} onClick={() => controller.show({ title: 'Changes saved', kind: 'success', description: { kind: 'text', text: long ? 'The workspace was updated. '.repeat(35) + 'تم حفظ التغييرات بنجاح. '.repeat(12) : 'The workspace was updated. You can keep working.' } })}>Show notification</button>
            <button disabled={disabled} onClick={() => controller.show({ id: 'shared', title: 'Main controller', duration: null, attention: 'stack' })}>Shared ID in main</button>
            <button disabled={disabled} onClick={() => controller.show({ title: 'Cloudlet documentation', action: { kind: 'link', label: 'Open README', href: 'https://github.com/Meerzus/cloudlet', target: '_blank' } })}>Link</button>
            <button disabled={disabled} onClick={() => session.dedupe()}>Dedupe ×3</button>
          </div>
        </section>
        <section aria-labelledby="promise-title"><h2 id="promise-title">Three independent operations</h2><p>Start A/B/C, then settle them in any order. The Promise outcome and its application to the UI are shown apart; the stack shows each operation as its own record.</p>
          <div className="lab-buttons"><button disabled={disabled} onClick={startABC}>Start A/B/C</button><button disabled={disabled} onClick={() => reverse(false)}>Resolve C → B → A</button><button disabled={disabled} onClick={() => reverse(true)}>Reject C → B → A</button></div>
          <div className="lab-task-controls">{['A', 'B', 'C'].map(name => <div key={name}><strong>{name}</strong><button disabled={disabled} onClick={() => session.settle(name)}>Resolve {name}</button><button disabled={disabled} onClick={() => session.settle(name, true)}>Reject {name}</button><button disabled={disabled} onClick={() => session.retry(name)}>Retry {name}</button></div>)}</div>
        </section>
        <section aria-labelledby="error-title"><h2 id="error-title">Errors and action retry</h2><p>Sync throw keeps the rejection. A mapper error leaves the operation fulfilled. Open “Action with retry” in the Island, press “Publish”, then settle it by hand.</p>
          <div className="lab-buttons"><button disabled={disabled} onClick={() => session.errors(false)}>Sync throw</button><button disabled={disabled} onClick={() => session.errors(true)}>Mapper error</button><button disabled={disabled} onClick={() => session.showAction()}>Action with retry</button><button disabled={disabled} onClick={() => session.settleAction(true)}>Reject action</button><button disabled={disabled} onClick={() => session.settleAction(false)}>Settle action</button></div>
        </section>
        <section aria-labelledby="cancel-title"><h2 id="cancel-title">Cancellation, late result, reused ID</h2><p>Cooperative cancel rejects the Promise with an AbortError. Ignored abort stays pending until Resolve. Dismiss frees the UI and keeps the business operation.</p>
          <div className="lab-buttons"><button disabled={disabled} onClick={() => session.start('cancel', 'cooperative')}>Cooperative cancel</button><button disabled={disabled} onClick={() => session.cancel('cancel')}>Cancel cancel</button><button disabled={disabled} onClick={() => session.start('ignore', 'ignore')}>Ignored abort</button><button disabled={disabled} onClick={() => session.cancel('ignore')}>Cancel ignore</button><button disabled={disabled} onClick={() => session.settle('ignore')}>Resolve ignore</button><button disabled={disabled} onClick={() => session.reuse()}>Reuse ID</button><button disabled={disabled} onClick={() => session.resolveOld()}>Resolve old</button></div>
        </section>
        <section aria-labelledby="stress-title"><h2 id="stress-title">Load with a switch</h2><p>120 events test the cap of 100. Stress reserves a progress record and sends 30 updates/s from one interval; the log keeps the last 80 lines of each kind.</p>
          <div className="lab-buttons"><button disabled={disabled} onClick={() => session.burst()}>Burst 120</button><button disabled={disabled} onClick={() => session.capacityTask()}>Task at capacity</button><button disabled={disabled || state.running} onClick={() => session.startStress()}>Start stress</button><button disabled={!state.running} onClick={() => session.stopStress()}>Stop stress</button></div>
          <p className="lab-mono">progress updates: <span data-testid="stress-updates">{state.updates}</span> · {state.running ? '30/s · running' : 'stopped'}</p>
        </section>
      </div>
      <aside className="lab-diagnostics" aria-label="Main controller diagnostics">
        <div className="lab-diagnostic-head"><h2>Observation</h2><span className="lab-mono">public snapshot</span></div>
        <div className="lab-buttons"><button disabled={disabled} onClick={() => { session.stopStress(); setAttached(value => !value); }}>{attached ? 'Detach Toaster' : 'Attach Toaster'}</button><button disabled={disabled || !attached} onClick={() => controller.requestFocus()}>Focus notifications</button><button disabled={disabled} onClick={() => session.clear()}>Clear</button><button disabled={disabled} onClick={() => { setAttached(false); session.dispose(); }}>Dispose main</button><button onClick={recreate}>Recreate main</button></div>
        <p className="lab-mono" data-testid="lab-resources">intervals={state.intervals} pending={state.pending} listeners={state.listeners}</p>
        <p className="lab-hint" role="status">{state.message}</p>
        <h3>Stack records</h3>
        <div className="lab-records" data-testid="lab-notifications">{snapshot.notifications.length === 0 ? <p className="lab-empty">No accepted events.</p> : snapshot.notifications.map(notification => <article key={notification.handle.generation} data-notification-id={notification.handle.id} data-current={notification.location === 'current'} data-occurrences={notification.occurrences} data-operation={notification.operation?.status} data-cancel-requested={notification.operation?.cancelRequested}>
          <div><strong>{notification.content.title}</strong><span>{notification.location} · #{snapshot.stack.indexOf(notification.handle) + 1} · {notification.kind} · ×{notification.occurrences}</span></div><code>{notification.handle.id}<br />{notification.handle.generation}</code>
          <small>{notification.remainingMs === null ? 'persistent' : `${Math.round(notification.remainingMs)}ms`} · {notification.pauseReasons.join(', ') || 'readable'}</small>
          <div className="lab-buttons"><button disabled={disabled} aria-label={`Dismiss ${notification.handle.id}`} onClick={() => controller.dismiss(notification.handle)}>Dismiss</button></div>
        </article>)}</div>
        <h3>Operation outcomes</h3><div className="lab-outcomes">{state.tasks.length === 0 ? <p className="lab-empty">No operations started yet.</p> : state.tasks.map(task => <div key={task.name} data-testid={`task-${task.name}`} data-status={task.status}><strong>{task.name} · {task.status}</strong><span>admission={task.admission} · attempt={task.attempt}</span><code>{task.outcome}</code></div>)}</div>
        <details open><summary>Logical events · last 80</summary><ol data-testid="logical-log" className="lab-log" tabIndex={0} aria-label="Logical events of the main controller">{state.logical.map(entry => <li key={entry.sequence}>{entry.text}</li>)}</ol></details>
        <details><summary>Presentation / diagnostics · last 80</summary><p className="lab-hint">Confirmed readable presentations and diagnostics. This is not the Promise outcome; animation frames are not logged.</p><ol data-testid="presentation-log" className="lab-log" tabIndex={0} aria-label="Presentation of the main controller">{state.presentation.map(entry => <li key={entry.sequence}>{entry.text}</li>)}</ol></details>
      </aside>
    </div>
    <CloudletProvider controller={controller}>{attached && !disabled && <Toaster position={position} theme={theme} dir={dir} offsets={inset ? { obstruction: { bottom: 72 } } : {}} labels={labels}
      motion={motion} classNames={{ host: 'lab-main-host' }} {...(nonce ? { nonce } : {})} />}</CloudletProvider>
  </>;
}

function Secondary({ session, reset, position, inset, motion }: { session: LabSession; reset: () => void; position: Position; inset: boolean; motion: Motion }) {
  const snapshot = useSyncExternalStore(session.controller.subscribe, session.controller.getSnapshot, session.controller.getServerSnapshot);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [attached, setAttached] = useState(true);
  const disabled = snapshot.disposed;
  return <section className="lab-secondary" aria-labelledby="secondary-title"><h2 id="secondary-title">Second independent controller</h2><p>Dark theme, the opposite edge of the window, its own shared ID. Reset and dispose of the main one leave this instance alone.</p><div className="lab-buttons"><button disabled={disabled} onClick={() => session.controller.show({ id: 'shared', title: 'Second controller', duration: null })}>Show in second</button><button disabled={disabled} onClick={() => session.controller.clear()}>Clear second</button><button disabled={disabled} onClick={() => setAttached(value => !value)}>{attached ? 'Detach second Toaster' : 'Attach second Toaster'}</button><button disabled={disabled} onClick={() => { setAttached(false); session.dispose(); }}>Dispose second</button><button onClick={reset}>Reset second</button></div><p data-testid="secondary-summary" data-count={snapshot.notifications.length} data-disposed={snapshot.disposed}>{snapshot.notifications.length} accepted · {disabled ? 'disposed' : attached ? 'active' : 'no renderer'}</p>
    <details className="lab-secondary-diagnostics"><summary>Second controller diagnostics</summary>{snapshot.notifications.map(item => <p key={item.handle.generation}><code>{item.handle.id} · {item.handle.generation}</code></p>)}<h3>Logical · last 80</h3><ol className="lab-log" tabIndex={0} aria-label="Logical events of the second controller">{state.logical.map(entry => <li key={entry.sequence}>{entry.text}</li>)}</ol><h3>Presentation / diagnostics · last 80</h3><ol className="lab-log" tabIndex={0} aria-label="Presentation of the second controller">{state.presentation.map(entry => <li key={entry.sequence}>{entry.text}</li>)}</ol></details>
    <CloudletProvider controller={session.controller}>{attached && !disabled && <Toaster position={position} theme="dark" offsets={inset ? { obstruction: { bottom: 72 } } : {}} labels={{ ...labels, region: 'Independent notifications' }} motion={motion} {...(nonce ? { nonce } : {})} />}</CloudletProvider></section>;
}

const fixtures = [
  ['attention', 'Auto-open'], ['slider', 'Open slider'], ['no-reset', 'No CSS reset'], ['hostile', 'Hostile CSS'], ['long-text', 'Long texts / RTL'],
  ['zoom', 'Large text'], ['portal', 'Own portal'], ['inset', 'Mobile bar'], ['visual', 'Look'],
] as const;

function Laboratory() {
  useInputJournal();
  const [epoch, setEpoch] = useState(0); const [secondaryEpoch, setSecondaryEpoch] = useState(0);
  const [auto, setAuto] = useState(true); const [activeAuto, setActiveAuto] = useState(true);
  const session = useSession(activeAuto, epoch); const secondary = useSession(false, secondaryEpoch);
  useEffect(() => {
    const pageHide = () => session?.stopStress();
    const visibility = () => { if (document.hidden) pageHide(); };
    window.addEventListener('pagehide', pageHide);
    document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('pagehide', pageHide); document.removeEventListener('visibilitychange', visibility); };
  }, [session]);
  useEffect(() => keepIslandOnLabControls(window), []);
  const [position, setPosition] = useState<Position>('auto');
  const [theme, setTheme] = useState<Theme>('system');
  const [dir, setDir] = useState<'ltr' | 'rtl'>('ltr'); const [motionPreference, setMotionPreference] = useState<MotionPreference>('system');
  const [inset, setInset] = useState(false); const [long, setLong] = useState(false);
  const [timeScale, setTimeScale] = useState<string>('1');
  const [overrides, setOverrides] = useMotionOverrides();
  const [desktop, setDesktop] = useState(true);
  const [preference, setPreference] = useState<ReturnType<typeof installMotionPreference>>();
  useEffect(() => { const adapter = installMotionPreference(); setPreference(adapter); return () => adapter.dispose(); }, []);
  useEffect(() => { preference?.set(motionPreference); }, [preference, motionPreference]);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 48rem)');
    const update = () => setDesktop(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const motion: Motion = { timeScale: Number(timeScale), overrides };
  const secondaryPosition = position === 'top-center' || (position === 'auto' && desktop) ? 'bottom-center' : 'top-center';
  const slowed = timeScale !== '1';
  return <div className="lab" data-theme={theme} data-time-scale={timeScale}>
    <a className="lab-skip" href="#scenarios">Skip to scenarios</a>
    <header className="lab-header" data-lab-keep-island="">
      <a href="/" className="lab-brand">Cloudlet<span>Laboratory · stack → Island</span></a>
      <div className="lab-speed">
        <Choice label="timeScale" value={timeScale} onChange={setTimeScale} options={timeScales.map(value => [value, value] as const)} />
        <output data-testid="lab-timescale" data-slowed={slowed} aria-live="polite">{slowed ? `Slowed ×${timeScale}` : 'Speed ×1'}</output>
      </div>
      <nav aria-label="Sections"><a href="#scenarios">Scenarios</a><a href="#motion">Motion</a><a href="#fixtures">Environments</a><a href="#notes">Reading the results</a></nav>
    </header>
    <main><div className="lab-intro"><p className="lab-kicker">Stack → Island</p><h1>One stack.<br /><span>One Island.</span></h1><p>Build a stack, open it into the Island, page through notifications and close them. Slow time down to look at the morph, the blur swap and the slide, and tune the springs without a rebuild.</p></div>
      <Settings {...{ position, setPosition, theme, setTheme, dir, setDir, motion: motionPreference, setMotion: setMotionPreference, inset, setInset, long, setLong, auto, setAuto }} />
      <div id="scenarios" tabIndex={-1}>{session && preference && <Workspace key={epoch + ':' + String(activeAuto)} {...{ session, position, theme, dir, inset, long, motion }}
        recreate={() => { setActiveAuto(auto); setEpoch(value => value + 1); }}
        studio={<MotionPanel overrides={overrides} setOverrides={setOverrides} timeScale={timeScale} setTimeScale={setTimeScale} />} />}</div>
      {secondary && preference && <Secondary key={secondaryEpoch} session={secondary} reset={() => setSecondaryEpoch(value => value + 1)} position={secondaryPosition} inset={inset} motion={motion} />}
      <section id="fixtures" className="lab-fixtures"><h2>Separate pages</h2><p>Each page loads only its own styles and the package CSS. The main page’s reset does not reach them.</p><div>{fixtures.map(([route, title]) => <a key={route} href={`?fixture=${route}`}>{title}<span aria-hidden="true">↗</span></a>)}</div>
        <p className="lab-hint">QA pages: <a href="?surface">surface</a> · <a href="?fixture=accessibility">accessibility</a> · <a href="?fixture=mobile">mobile gestures</a>.</p></section>
      <section id="notes" className="lab-notes"><h2>Reading the results</h2><p>Cloudlet works inside the browser window and PWAs. The hardware Island and system notifications are not part of this page.</p><p>timeScale stretches the time of every transition; 0.1 is ten times slower. The motion panel writes into the debug <code>motion.overrides</code>: new values apply to the next transition, a running one finishes with the old ones. “Copy JSON” gives the full set of values.</p><p>Dismiss and clear remove the UI, and cancellation is cooperative. At capacity=100 the business operation still runs: admission and result are independent.</p><p>Reset releases intervals, timers and abort listeners, settles the deferred promises this page owns and recreates both controllers. The logs are local and bounded; nothing is sent to a server.</p><p>Automated checks do not replace VoiceOver/NVDA, a physical Safari/PWA, pinch zoom and the on-screen keyboard.</p></section>
    </main><footer>Cloudlet · local laboratory</footer>{inset && <div className="lab-bottom-nav" aria-label="Simulated bottom navigation">Workspace · Files · Settings</div>}
  </div>;
}

export function LaboratoryShell() {
  const [mounted, setMounted] = useState(true); const [generation, setGeneration] = useState(0);
  return <><div className="lab-owner-controls"><button onClick={() => setGeneration(value => value + 1)}>Full reset</button><button onClick={() => setMounted(value => !value)}>{mounted ? 'Unmount laboratory' : 'Mount laboratory'}</button></div>{mounted ? <Laboratory key={generation} /> : <main className="lab-unmounted"><h1>Laboratory unmounted</h1><p>Both controllers are disposed. The page’s resources are released.</p></main>}</>;
}
