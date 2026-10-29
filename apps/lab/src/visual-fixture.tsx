import { CloudletProvider, Toaster, createCloudlet } from '@cloudlet/toast';
import type { ReactCloudletController, ToasterProps } from '@cloudlet/toast';

/**
 * `?fixture=visual`: a bare page for screenshots, contrast and axe checks of the look
 * (task 15). Query: `theme`, `page` (light|dark page background), `dir`, `position` and
 * `scenario` (`mix`, `progress`, `kinds`, `overflow`); scripts may add more through `window.cloudletVisual`.
 */
declare global {
  interface Window { cloudletVisual?: ReactCloudletController }
}

const pick = <T extends string>(value: string | null, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? value as T : fallback;

export function createVisualFixture(params: URLSearchParams) {
  const controller = createCloudlet({ autoDismiss: false });
  window.cloudletVisual = controller;
  const theme = pick(params.get('theme'), ['system', 'light', 'dark'] as const, 'system');
  const page = pick(params.get('page'), ['light', 'dark'] as const, 'light');
  const dir = pick(params.get('dir'), ['ltr', 'rtl'] as const, 'ltr');
  const position = pick(params.get('position'), ['auto', 'top-center', 'bottom-center'] as const, 'top-center');
  document.documentElement.dataset.visualPage = page;
  const run = () => {};
  const scenario = params.get('scenario') ?? 'mix';
  const show = (spec: Parameters<ReactCloudletController['show']>[0]) => controller.show({ duration: null, attention: 'stack', ...spec });
  if (scenario === 'mix') {
    show({ title: 'File uploaded', kind: 'info' });
    show({ title: 'Could not sync', kind: 'error', description: { kind: 'text', text: 'Check the connection and retry.' } });
    show({ title: 'Changes saved', kind: 'success', description: { kind: 'text', text: 'The document is saved to the shared “Reports” folder.' },
      action: { kind: 'command', label: 'Undo', run } });
  } else if (scenario === 'progress') {
    show({ title: 'Waiting for the server', kind: 'loading', progress: { kind: 'indeterminate' } });
    show({ title: 'Downloading report', kind: 'loading', progress: { kind: 'determinate', value: 0.62 },
      description: { kind: 'text', text: '12 of 19 files' }, action: { kind: 'command', label: 'Hide', run } });
  } else if (scenario === 'kinds') {
    for (const kind of ['loading', 'info', 'warning', 'error', 'success'] as const) {
      show({ title: { loading: 'Syncing', info: 'Update available', warning: 'Low disk space', error: 'Payment error', success: 'Payment accepted' }[kind],
        kind, description: { kind: 'text', text: 'The notification’s description on a second line.' }, action: { kind: 'command', label: 'Details', run } });
    }
  } else if (scenario === 'overflow') {
    for (let index = 0; index < 101; index++) show({ title: `Event ${index + 1}`, kind: 'info' });
  }
  const options: ToasterProps = { theme, dir, position, labels: { region: 'Notifications', island: 'Current notifications', carousel: 'carousel', slide: 'slide', close: 'Close',
    stackSummary: (title, count, missed) => [title, ...(count > 1 ? [`${count} notifications`] : []), ...(missed ? [`missed: ${missed}`] : [])].join(', '),
    page: (index, total) => `${index} of ${total}`, overflowCount: count => `Not accepted: ${count}`, acknowledgeOverflow: 'Acknowledge missed' } };
  const element = <CloudletProvider controller={controller}>
    <main className="visual-page">
      <h1>Cloudlet · look</h1>
      <p>The page is {page === 'dark' ? 'dark' : 'light'}, the toaster theme is {theme}.</p>
    </main>
    <Toaster {...options} />
  </CloudletProvider>;
  return { controller, element };
}
