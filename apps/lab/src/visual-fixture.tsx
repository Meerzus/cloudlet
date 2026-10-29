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
    show({ title: 'Файл загружен', kind: 'info' });
    show({ title: 'Не удалось синхронизировать', kind: 'error', description: { kind: 'text', text: 'Проверьте соединение и повторите.' } });
    show({ title: 'Изменения сохранены', kind: 'success', description: { kind: 'text', text: 'Документ сохранён в общей папке «Отчёты».' },
      action: { kind: 'command', label: 'Отменить', run } });
  } else if (scenario === 'progress') {
    show({ title: 'Ожидание сервера', kind: 'loading', progress: { kind: 'indeterminate' } });
    show({ title: 'Загрузка отчёта', kind: 'loading', progress: { kind: 'determinate', value: 0.62 },
      description: { kind: 'text', text: '12 из 19 файлов' }, action: { kind: 'command', label: 'Скрыть', run } });
  } else if (scenario === 'kinds') {
    for (const kind of ['loading', 'info', 'warning', 'error', 'success'] as const) {
      show({ title: { loading: 'Синхронизация', info: 'Доступно обновление', warning: 'Мало места на диске', error: 'Ошибка оплаты', success: 'Платёж принят' }[kind],
        kind, description: { kind: 'text', text: 'Описание уведомления второй строкой.' }, action: { kind: 'command', label: 'Подробнее', run } });
    }
  } else if (scenario === 'overflow') {
    for (let index = 0; index < 101; index++) show({ title: `Событие ${index + 1}`, kind: 'info' });
  }
  const options: ToasterProps = { theme, dir, position, labels: { region: 'Уведомления', island: 'Текущие уведомления', carousel: 'карусель', slide: 'слайд', close: 'Закрыть',
    stackSummary: (title, count, missed) => [title, ...(count > 1 ? [`${count} уведомления`] : []), ...(missed ? [`пропущено: ${missed}`] : [])].join(', '),
    page: (index, total) => `${index} из ${total}`, overflowCount: count => `Не принято: ${count}`, acknowledgeOverflow: 'Подтвердить пропущенные' } };
  const element = <CloudletProvider controller={controller}>
    <main className="visual-page">
      <h1>Cloudlet · облик</h1>
      <p>Страница {page === 'dark' ? 'тёмная' : 'светлая'}, тема тостера — {theme}.</p>
    </main>
    <Toaster {...options} />
  </CloudletProvider>;
  return { controller, element };
}
