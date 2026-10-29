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
    title: 'Без CSS reset',
    description: 'На этой странице сохранены стандартные шрифты, отступы и controls браузера. Стили Cloudlet ограничены собственным host. Основной CSS лаборатории здесь не загружается.',
  },
  hostile: {
    title: 'Агрессивный глобальный CSS',
    description: 'Окружение меняет кнопки, заголовки, списки, SVG, отступы и box-sizing глобальными element selectors. Сравните образцы страницы с уведомлением. Намеренные !important overrides не входят в этот пример.',
  },
  'long-text': {
    title: 'Русский, العربية и длинный URL',
    description: 'Три независимых записи в одной стопке: русский текст, арабский с RTL и длинный неразрывный URL. Откройте Island, листайте слайды и проверьте двухстрочный заголовок, прокрутку описания, перенос и доступность controls.',
  },
  zoom: {
    title: 'Увеличенный текст и reflow',
    description: 'Размер корневого текста увеличен до 200%. Это проверка rem и reflow, а не эмуляция browser zoom. Дополнительно задайте настоящий масштаб браузера 200% или 250% и проверьте Tab, открытие Island, Escape и закрытие.',
  },
  portal: {
    title: 'Собственный portal',
    description: 'Toaster монтируется в отдельный подключённый HTML-контейнер этой страницы. Отключение и подключение создаёт новое attachment; контроллер и принятые уведомления сохраняются.',
  },
  inset: {
    title: 'Нижняя навигация и inset',
    description: 'Фиксированная навигация высотой 76 CSS px передана как дополнительная obstruction.bottom. Safe area добавляется библиотекой отдельно. Поле ввода и вертикальная прокрутка остаются нативными.',
  },
};

const russianText = 'Изменения сохранены. В рабочем пространстве появилась новая версия документа с заметками команды, уточнённым планом и материалами для следующей встречи. Коллеги увидят обновления при следующем открытии документа. Предыдущая версия остаётся доступной в истории изменений. '.repeat(5);
const arabicText = 'تم حفظ التغييرات بنجاح. يظل هذا الوصف الطويل مقروءًا عند تكبير النص وفي النافذة الضيقة. يمكنك فتح الإشعار وإغلاقه باستخدام لوحة المفاتيح مع الحفاظ على اتجاه القراءة الصحيح. '.repeat(5);
const longUrl = `https://example.test/collections/${'cloudlet_readable_notifications_'.repeat(12)}?language=ru&direction=rtl`;

const labels: NonNullable<ToasterProps['labels']> = { ...fixtureLabels, region: 'Уведомления fixture' };

function records(fixture: EnvironmentFixtureKind): readonly ReactNotificationSpec[] {
  if (fixture === 'long-text') return [
    { id: 'fixture-russian', title: 'Документ обновлён: новая версия плана с заметками команды и материалами к встрече', description: { kind: 'text', text: russianText }, duration: null, attention: 'stack' },
    { id: 'fixture-arabic', title: 'تم حفظ التغييرات بنجاح', description: { kind: 'text', text: arabicText }, duration: null, attention: 'stack' },
    { id: 'fixture-url', title: 'Ссылка на коллекцию', description: { kind: 'text', text: longUrl }, duration: null, attention: 'stack' },
  ];
  return [{
    id: 'fixture-notice', title: 'Изменения сохранены', kind: 'success',
    description: { kind: 'text', text: fixture === 'zoom' ? russianText : 'Новая версия документа сохранена в рабочем пространстве. Все заметки и вложения доступны команде.' },
    duration: null, attention: 'stack',
    action: { kind: 'link', label: 'Открыть документ', href: '#environment-destination' },
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

  if (!session || session.fixture !== fixture || session.revision !== revision) return <p>Подготовка окружения…</p>;
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
    controller.show({ id: `fixture-extra-${serial.current}`, title: `Независимое событие ${serial.current}`, duration: null, attention: 'stack' });
  }

  return <>
    <main className="environment-fixture" data-fixture={fixture} data-testid="environment-fixture">
      <p className="environment-eyebrow">Cloudlet · изолированное окружение</p>
      <h1>{copy.title}</h1>
      <p>{copy.description}</p>
      <p><a href="./">Вернуться в лабораторию</a></p>
      <section aria-labelledby="environment-controls-title">
        <h2 id="environment-controls-title">Управление</h2>
        <div className="environment-controls" data-lab-keep-island="">
          <button type="button" onClick={refill}>Показать образцы</button>
          <button type="button" onClick={showAnother}>Добавить событие</button>
          <button type="button" onClick={() => openIsland(host())} disabled={!attached || snapshot.island.open || snapshot.stack.length === 0}>Открыть Island</button>
          <button type="button" onClick={() => collapseIsland(host())} disabled={!snapshot.island.open}>Свернуть</button>
          <button type="button" onClick={() => controller.clear()}>Очистить уведомления</button>
          <button type="button" onClick={onReset}>Сбросить fixture</button>
          <button type="button" onClick={() => setAttached(value => !value)}>{attached ? 'Отключить Toaster' : 'Подключить Toaster'}</button>
          <button type="button" onClick={() => controller.requestFocus()} disabled={!attached || snapshot.notifications.length === 0}>Фокус на уведомления</button>
          <Choice label="Направление" value={dir} onChange={setDir} options={[["ltr", "LTR"], ["rtl", "RTL"]]} />
          {fixture === 'inset' && <label><input type="checkbox" checked={inset} onChange={event => setInset(event.target.checked)} /> Учитывать навигацию</label>}
        </div>
        <p><output data-testid="environment-count" data-state={snapshot.island.open ? 'island' : 'stack'}>Принято: {snapshot.notifications.length}; в стопке: {snapshot.stack.length}; {snapshot.island.open ? 'Island открыт' : 'стопка свёрнута'}.</output> Auto-dismiss отключён.</p>
      </section>
      {fixture === 'hostile' && <section aria-labelledby="hostile-samples-title">
        <h2 id="hostile-samples-title">Образцы глобальных стилей</h2>
        <p>Этот текст, список, SVG и кнопки намеренно наследуют агрессивное окружение.</p>
        <ol><li>Обычный список страницы</li><li>Второй элемент списка</li></ol>
        <svg viewBox="0 0 24 24" role="img" aria-label="Геометрический образец"><circle cx="12" cy="12" r="8" /></svg>
      </section>}
      {fixture === 'long-text' && <section aria-labelledby="language-samples-title">
        <h2 id="language-samples-title">Исходный материал</h2>
        <p lang="ru">{russianText.slice(0, 225)}</p>
        <p lang="ar" dir="rtl">{arabicText.slice(0, 220)}</p>
        <p className="environment-long-url">{longUrl}</p>
        <p>Для арабской записи выберите RTL: слайдер и бэйдж зеркалятся. Каждый язык сохранён отдельным событием; Cloudlet не объединяет независимые записи.</p>
      </section>}
      {fixture === 'portal' && <section aria-labelledby="portal-title">
        <h2 id="portal-title">Портал приложения</h2>
        <p>Контейнер находится после main, за пределами React-разметки controls, без transform или clipping. Host остаётся фиксированным к viewport.</p>
        <p><code>#environment-custom-portal</code></p>
      </section>}
      {fixture === 'inset' && <section aria-labelledby="inset-content-title">
        <h2 id="inset-content-title">Содержимое мобильной страницы</h2>
        <label>Нативное текстовое поле <input type="text" autoComplete="off" placeholder="Проверка клавиатуры" /></label>
        {Array.from({ length: 10 }, (_, index) => <p key={index}>Раздел {index + 1}. Страница прокручивается вертикально. Bottom navigation остаётся на месте, а уведомление учитывает дополнительный нижний отступ.</p>)}
      </section>}
      {fixture === 'zoom' && <section aria-labelledby="reflow-title">
        <h2 id="reflow-title">Проверка reflow</h2>
        <p>Controls переносятся на следующую строку. В Island описание прокручивается внутри доступной высоты; размер текста не уменьшается для размещения в viewport.</p>
      </section>}
      <p id="environment-destination" tabIndex={-1}>Образец назначения нативной ссылки. После перехода клавиатурная навигация продолжается на странице.</p>
    </main>
    {fixture === 'portal' && <div id="environment-custom-portal" data-testid="environment-custom-portal" />}
    {fixture === 'inset' && <nav className="environment-bottom-nav" aria-label="Образец нижней навигации"><a href="#environment-controls-title">Управление</a><a href="#environment-destination">Назначение</a></nav>}
    {attached && <Toaster dir={dir} theme="light" labels={labels}
      position={fixture === 'inset' ? 'bottom-center' : 'auto'}
      {...(fixture === 'portal' ? { container: () => document.getElementById('environment-custom-portal') } : {})}
      {...(fixture === 'inset' ? { offsets: { obstruction: { bottom: inset ? 76 : 0 } } } : {})}
      {...(nonce ? { nonce } : {})} />}
  </>;
}
