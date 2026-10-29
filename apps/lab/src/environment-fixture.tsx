import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CloudletProvider, createCloudlet, Toaster } from '@cloudlet/toast';
import type { ReactCloudletController, ReactNotificationSpec, ToasterProps } from '@cloudlet/toast';
import { Choice } from './choice.js';
import { fixtureLabels } from './fixture-kit.js';
import { collapseIsland, keepIslandOnLabControls, openIsland } from './pilot.js';
import './environment-fixture.css';

export type EnvironmentFixtureKind = 'no-reset' | 'hostile' | 'long-text' | 'zoom' | 'portal' | 'inset';

export function isEnvironmentFixtureRoute(value: string | null): value is EnvironmentFixtureKind {
  return value === 'no-reset' || value === 'hostile' || value === 'long-text'
    || value === 'zoom' || value === 'portal' || value === 'inset';
}

const fixtureCopy: Record<EnvironmentFixtureKind, { title: string; description: string }> = {
  'no-reset': {
    title: 'No CSS reset',
    description: 'This page keeps the browser’s default fonts, margins and controls. Cloudlet’s styles stay inside its own host. The laboratory’s main CSS is not loaded here.',
  },
  hostile: {
    title: 'Hostile global CSS',
    description: 'The environment restyles buttons, headings, lists, SVG, margins and box-sizing with global element selectors. Compare the page samples with the notification. Deliberate !important overrides are not part of this example.',
  },
  'long-text': {
    title: 'Cyrillic, العربية and a long URL',
    description: 'Three independent records in one stack: Russian text, Arabic with RTL and a long unbroken URL. Open the Island, page through the slides and check the two-line title, the description scroll, wrapping and the controls.',
  },
  zoom: {
    title: 'Enlarged text and reflow',
    description: 'The root text size is raised to 200%. This checks rem and reflow; it does not emulate browser zoom. Also set a real browser zoom of 200% or 250% and check Tab, opening the Island, Escape and closing.',
  },
  portal: {
    title: 'Own portal',
    description: 'The Toaster mounts into a separate, connected HTML container of this page. Detaching and attaching creates a new attachment; the controller and the accepted notifications stay.',
  },
  inset: {
    title: 'Bottom navigation and inset',
    description: 'A fixed navigation 76 CSS px high is passed as an extra obstruction.bottom. The library adds the safe area on its own. The text field and vertical scrolling stay native.',
  },
};

const englishText = 'Changes saved. The workspace has a new version of the document with the team’s notes, a refined plan and the material for the next meeting. Colleagues see the update the next time they open the document. The previous version stays in the change history. '.repeat(5);
/** A Cyrillic language sample beside the Arabic one: the long-text page checks scripts, not English. */
const russianText = 'Изменения сохранены. В рабочем пространстве появилась новая версия документа с заметками команды, уточнённым планом и материалами для следующей встречи. Коллеги увидят обновления при следующем открытии документа. Предыдущая версия остаётся доступной в истории изменений. '.repeat(5);
const arabicText = 'تم حفظ التغييرات بنجاح. يظل هذا الوصف الطويل مقروءًا عند تكبير النص وفي النافذة الضيقة. يمكنك فتح الإشعار وإغلاقه باستخدام لوحة المفاتيح مع الحفاظ على اتجاه القراءة الصحيح. '.repeat(5);
const longUrl = `https://example.test/collections/${'cloudlet_readable_notifications_'.repeat(12)}?language=ru&direction=rtl`;

const labels: NonNullable<ToasterProps['labels']> = { ...fixtureLabels, region: 'Fixture notifications' };

function records(fixture: EnvironmentFixtureKind): readonly ReactNotificationSpec[] {
  if (fixture === 'long-text') return [
    { id: 'fixture-russian', title: 'Документ обновлён: новая версия плана с заметками команды и материалами к встрече', description: { kind: 'text', text: russianText }, duration: null, attention: 'stack' },
    { id: 'fixture-arabic', title: 'تم حفظ التغييرات بنجاح', description: { kind: 'text', text: arabicText }, duration: null, attention: 'stack' },
    { id: 'fixture-url', title: 'Link to the collection', description: { kind: 'text', text: longUrl }, duration: null, attention: 'stack' },
  ];
  return [{
    id: 'fixture-notice', title: 'Changes saved', kind: 'success',
    description: { kind: 'text', text: fixture === 'zoom' ? englishText : 'The new version of the document is saved in the workspace. Every note and attachment is available to the team.' },
    duration: null, attention: 'stack',
    action: { kind: 'link', label: 'Open document', href: '#environment-destination' },
  }];
}

/** Each route owns one controller and is loaded before the main lab stylesheet. */
export function EnvironmentFixture({ fixture }: { fixture: EnvironmentFixtureKind }) {
  const [session, setSession] = useState<{ controller: ReactCloudletController; fixture: EnvironmentFixtureKind; revision: number } | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const element = document.documentElement;
    const previous = element.getAttribute('data-cloudlet-environment');
    element.setAttribute('data-cloudlet-environment', fixture);
    const owner = createCloudlet({ autoDismiss: false });
    for (const record of records(fixture)) owner.show(record);
    setSession({ controller: owner, fixture, revision });
    return () => {
      // Provider/Toaster only detach. The fixture, as owner, releases its controller.
      owner.dispose();
      if (previous === null) element.removeAttribute('data-cloudlet-environment');
      else element.setAttribute('data-cloudlet-environment', previous);
    };
  }, [fixture, revision]);

  if (!session || session.fixture !== fixture || session.revision !== revision) return <p>Preparing the environment…</p>;
  return <CloudletProvider controller={session.controller}>
    <FixtureContents key={revision} controller={session.controller} fixture={fixture} onReset={() => setRevision(value => value + 1)} />
  </CloudletProvider>;
}

function FixtureContents({ controller, fixture, onReset }: { controller: ReactCloudletController; fixture: EnvironmentFixtureKind; onReset: () => void }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  const [attached, setAttached] = useState(true);
  const [dir, setDir] = useState<'ltr' | 'rtl'>('ltr');
  const [inset, setInset] = useState(true);
  const serial = useRef(0);
  const nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;
  const copy = fixtureCopy[fixture];
  useEffect(() => keepIslandOnLabControls(window), []);
  const host = () => document.querySelector('.cloudlet-host');

  function refill() {
    controller.clear();
    controller.acknowledgeOverflow();
    for (const record of records(fixture)) controller.show(record);
  }

  function showAnother() {
    serial.current += 1;
    controller.show({ id: `fixture-extra-${serial.current}`, title: `Independent event ${serial.current}`, duration: null, attention: 'stack' });
  }

  return <>
    <main className="environment-fixture" data-fixture={fixture} data-testid="environment-fixture">
      <p className="environment-eyebrow">Cloudlet · isolated environment</p>
      <h1>{copy.title}</h1>
      <p>{copy.description}</p>
      <p><a href="./">Back to the laboratory</a></p>
      <section aria-labelledby="environment-controls-title">
        <h2 id="environment-controls-title">Controls</h2>
        <div className="environment-controls" data-lab-keep-island="">
          <button type="button" onClick={refill}>Show samples</button>
          <button type="button" onClick={showAnother}>Add event</button>
          <button type="button" onClick={() => openIsland(host())} disabled={!attached || snapshot.island.open || snapshot.stack.length === 0}>Open Island</button>
          <button type="button" onClick={() => collapseIsland(host())} disabled={!snapshot.island.open}>Collapse</button>
          <button type="button" onClick={() => controller.clear()}>Clear notifications</button>
          <button type="button" onClick={onReset}>Reset fixture</button>
          <button type="button" onClick={() => setAttached(value => !value)}>{attached ? 'Detach Toaster' : 'Attach Toaster'}</button>
          <button type="button" onClick={() => controller.requestFocus()} disabled={!attached || snapshot.notifications.length === 0}>Focus notifications</button>
          <Choice label="Direction" value={dir} onChange={setDir} options={[["ltr", "LTR"], ["rtl", "RTL"]]} />
          {fixture === 'inset' && <label><input type="checkbox" checked={inset} onChange={event => setInset(event.target.checked)} /> Account for the navigation</label>}
        </div>
        <p><output data-testid="environment-count" data-state={snapshot.island.open ? 'island' : 'stack'}>Accepted: {snapshot.notifications.length}; in stack: {snapshot.stack.length}; {snapshot.island.open ? 'Island open' : 'stack collapsed'}.</output> Auto-dismiss is off.</p>
      </section>
      {fixture === 'hostile' && <section aria-labelledby="hostile-samples-title">
        <h2 id="hostile-samples-title">Global style samples</h2>
        <p>This text, list, SVG and buttons inherit the hostile environment on purpose.</p>
        <ol><li>A plain page list</li><li>The second list item</li></ol>
        <svg viewBox="0 0 24 24" role="img" aria-label="Geometric sample"><circle cx="12" cy="12" r="8" /></svg>
      </section>}
      {fixture === 'long-text' && <section aria-labelledby="language-samples-title">
        <h2 id="language-samples-title">Source material</h2>
        <p lang="ru">{russianText.slice(0, 225)}</p>
        <p lang="ar" dir="rtl">{arabicText.slice(0, 220)}</p>
        <p className="environment-long-url">{longUrl}</p>
        <p>Choose RTL for the Arabic record: the slider and the badge mirror. Each language is its own event; Cloudlet does not merge independent records.</p>
      </section>}
      {fixture === 'portal' && <section aria-labelledby="portal-title">
        <h2 id="portal-title">Application portal</h2>
        <p>The container sits after main, outside the React markup of the controls, with no transform or clipping. The host stays fixed to the viewport.</p>
        <p><code>#environment-custom-portal</code></p>
      </section>}
      {fixture === 'inset' && <section aria-labelledby="inset-content-title">
        <h2 id="inset-content-title">Mobile page content</h2>
        <label>Native text field <input type="text" autoComplete="off" placeholder="Keyboard check" /></label>
        {Array.from({ length: 10 }, (_, index) => <p key={index}>Section {index + 1}. The page scrolls vertically. The bottom navigation stays put, and the notification accounts for the extra bottom inset.</p>)}
      </section>}
      {fixture === 'zoom' && <section aria-labelledby="reflow-title">
        <h2 id="reflow-title">Reflow check</h2>
        <p>Controls wrap to the next line. In the Island the description scrolls within the available height; the text never shrinks to fit the viewport.</p>
      </section>}
      <p id="environment-destination" tabIndex={-1}>Sample target of a native link. After the jump, keyboard navigation continues on the page.</p>
    </main>
    {fixture === 'portal' && <div id="environment-custom-portal" data-testid="environment-custom-portal" />}
    {fixture === 'inset' && <nav className="environment-bottom-nav" aria-label="Sample bottom navigation"><a href="#environment-controls-title">Controls</a><a href="#environment-destination">Target</a></nav>}
    {attached && <Toaster dir={dir} theme="light" labels={labels}
      position={fixture === 'inset' ? 'bottom-center' : 'auto'}
      {...(fixture === 'portal' ? { container: () => document.getElementById('environment-custom-portal') } : {})}
      {...(fixture === 'inset' ? { offsets: { obstruction: { bottom: inset ? 76 : 0 } } } : {})}
      {...(nonce ? { nonce } : {})} />}
  </>;
}
