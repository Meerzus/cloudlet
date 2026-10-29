import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CloudletProvider, createCloudlet } from '@cloudlet/toast';
import '@cloudlet/toast/styles.css';

const element = document.getElementById('root');
if (!element) throw new Error('Lab mount point is missing');
const root = createRoot(element);
let cleanup = () => {};
let active = true;

async function mount() {
  const params = new URLSearchParams(location.search);
  const fixture = params.get('fixture');
  if (['no-reset', 'hostile', 'long-text', 'zoom', 'portal', 'inset'].includes(fixture ?? '')) {
    const { EnvironmentFixture, isEnvironmentFixtureRoute } = await import('./environment-fixture.js');
    if (!active) return;
    if (isEnvironmentFixtureRoute(fixture)) root.render(<StrictMode><EnvironmentFixture fixture={fixture} /></StrictMode>);
  } else if (fixture === 'visual') {
    await import('./visual-fixture.css');
    const { createVisualFixture } = await import('./visual-fixture.js');
    if (!active) return;
    const visual = createVisualFixture(params);
    cleanup = () => visual.controller.dispose();
    root.render(<StrictMode>{visual.element}</StrictMode>);
  } else if (fixture === 'attention' || fixture === 'slider') {
    await import('./fixture-styles.css');
    const { createAttentionFixture, createSliderFixture } = await import('./scenario-fixtures.js');
    if (!active) return;
    const scenario = (fixture === 'attention' ? createAttentionFixture : createSliderFixture)(params);
    cleanup = () => scenario.controller.dispose();
    root.render(<StrictMode>{scenario.element}</StrictMode>);
  } else if (fixture === 'mobile' || fixture === 'accessibility' || params.has('surface')) {
    await import('./fixture-styles.css');
    if (!active) return;
    const controller = createCloudlet(fixture === 'accessibility' ? { autoDismiss: false, messages: { cancellationRequested: 'Отмена запрошена' } } : undefined);
    cleanup = () => controller.dispose();
    const Fixture = fixture === 'mobile' ? (await import('./mobile-fixture.js')).MobileFixture
      : fixture === 'accessibility' ? (await import('./accessibility-fixture.js')).AccessibilityFixture
        : (await import('./surface-fixture.js')).SurfaceFixture;
    if (active) root.render(<StrictMode><CloudletProvider controller={controller}><Fixture /></CloudletProvider></StrictMode>);
  } else {
    const { LaboratoryShell } = await import('./laboratory.js');
    if (!active) return;
    root.render(<StrictMode><LaboratoryShell /></StrictMode>);
  }
}
void mount();
if (import.meta.hot) import.meta.hot.dispose(() => { active = false; root.unmount(); cleanup(); });
