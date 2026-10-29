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
  region: 'Уведомления', island: 'Текущие уведомления', carousel: 'карусель', slide: 'слайд', close: 'Закрыть уведомление', collapse: 'Escape — свернуть',
  retry: 'Повторить', cancel: 'Запросить отмену', cancellationRequested: 'Отмена запрошена', acknowledgeOverflow: 'Подтвердить пропущенные',
  stackSummary: (title, count, missed) => [title, ...(count > 1 ? [`уведомлений: ${count}`] : []), ...(missed ? [`пропущено: ${missed}`] : [])].join(', '),
  page: (index, total) => `${index} из ${total}`,
  overflowCount: count => `Не принято: ${count}`,
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
    <h2 id="settings-title">Среда показа</h2>
    <div className="lab-fields">
      <Choice label="Позиция" value={position} onChange={setPosition} options={[['auto', 'Auto · по ширине'], ['top-center', 'Сверху'], ['bottom-center', 'Снизу']]} />
      <Choice label="Тема" value={theme} onChange={setTheme} options={[['system', 'Системная'], ['light', 'Светлая'], ['dark', 'Тёмная']]} />
      <Choice label="Направление" value={dir} onChange={setDir} options={[['ltr', 'LTR'], ['rtl', 'RTL']]} />
      <Choice label="Движение" value={motion} onChange={setMotion} options={[['system', 'Как в системе'], ['reduce', 'Reduce · эмуляция'], ['full', 'Полное · явно']]} />
    </div>
    <div className="lab-checks">
      <label><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />Автозакрытие после reset</label>
      <label><input type="checkbox" checked={inset} onChange={e => setInset(e.target.checked)} />Нижняя панель · 72px</label>
      <label><input type="checkbox" checked={long} onChange={e => setLong(e.target.checked)} />Длинное описание</label>
    </div>
    <p className="lab-hint">Автозакрытие применяется кнопкой «Пересоздать основной». Движение эмулирует media preference только в лаборатории. Скорость (timeScale) — в шапке стенда и в «Настройке движения» (там она доступна и при открытом Island), пружины — в «Настройке движения».</p>
  </section>;
}

/** Live `data-state` / `data-island-reason` of the main host, read from the DOM. */
function useHostState() {
  const [state, setState] = useState('—');
  useEffect(() => {
    let observed: Element | null = null;
    const read = () => {
      const host = mainHost();
      setState(host ? `${host.getAttribute('data-state') ?? '—'}${host.hasAttribute('data-island-reason') ? ` · ${host.getAttribute('data-island-reason')}` : ''}` : 'нет host');
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
    <h2 id="scenario-title">Сценарий: 3 → открыть → закрыть текущее</h2>
    <p>Три разных уведомления без автооткрытия: с описанием, с действием и простое. Откройте Island, закройте текущее (слайд к более старому), сверните. Кнопки и поля рабочей области не сворачивают Island; клик по фону страницы, «Среде показа» или Escape — сворачивает.</p>
    <div className="lab-buttons">
      <button disabled={disabled} className="lab-primary" onClick={() => session.threeScenario()}>3 уведомления</button>
      <button disabled={disabled || snapshot.island.open || !snapshot.stack.length} onClick={() => report(openIsland(mainHost()), 'Нет пилюли: стопка пуста или Toaster отключён.')}>Открыть Island</button>
      <button disabled={disabled || !snapshot.island.open} onClick={() => report(closeCurrent(mainHost()), 'Island закрыт.')}>Закрыть текущее</button>
      <button disabled={disabled || !snapshot.island.open} onClick={() => report(collapseIsland(mainHost()), 'Island закрыт.')}>Свернуть</button>
    </div>
    <p className="lab-mono" data-testid="island-state">DOM data-state: <b>{dom}</b> · стопка {snapshot.stack.length}</p>
    <ol data-testid="transition-log" className="lab-log lab-transitions" tabIndex={0} aria-label="Переходы стопки и Island">
      {state.transitions.length === 0 ? <li className="lab-empty">Переходов ещё нет.</li> : state.transitions.map(entry => <li key={entry.sequence}>{entry.text}</li>)}
    </ol>
  </section>;
}

function Generators({ session, disabled, long }: { session: LabSession; disabled: boolean; long: boolean }) {
  const [attention, setAttention] = useState<Attention>('auto');
  return <section aria-labelledby="generators-title" data-lab-keep-island="">
    <h2 id="generators-title">Генераторы уведомлений</h2>
    <p>По DESIGN §5 <code>auto</code> автооткрывает Island через 600 мс у уведомлений с описанием, действием или retry; <code>open</code> — всегда, <code>stack</code> — никогда. Пока курсор над уведомлениями или фокус внутри, автооткрытие ждёт.</p>
    <div className="lab-fields lab-fields-inline"><Choice label="attention" value={attention} onChange={setAttention} options={[['auto', 'auto'], ['open', 'open'], ['stack', 'stack']]} /></div>
    <div className="lab-buttons">
      <button disabled={disabled} onClick={() => session.generate('description', attention, long)}>С описанием</button>
      <button disabled={disabled} onClick={() => session.generate('action', attention)}>С действием</button>
      <button disabled={disabled} onClick={() => session.generateRetry(attention)}>С retry</button>
      <button disabled={disabled} onClick={() => session.generateProgress(attention)}>С прогрессом</button>
      <button disabled={disabled} onClick={() => session.generate('plain', attention)}>Без ничего</button>
    </div>
    <div className="lab-buttons">
      <button disabled={disabled} onClick={() => session.loadingTo('success', attention)}>Loading → success</button>
      <button disabled={disabled} onClick={() => session.loadingTo('error', attention)}>Loading → error</button>
      <button disabled={disabled} onClick={() => session.overflow()}>Переполнить · 101</button>
      <button disabled={disabled} onClick={() => session.controller.acknowledgeOverflow()}>Подтвердить пропущенные</button>
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
      <span><b>{snapshot.notifications.length}</b> принято</span><span><b>{snapshot.stack.length}</b> в стопке</span><span><b>{snapshot.overflow.count}</b> пропущено</span>
      <span>{snapshot.island.open ? `island · ${snapshot.island.reason}` : 'stack'} · {disabled ? 'disposed' : attached ? 'подключён' : 'без renderer'}</span>
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
        <section aria-labelledby="basic-title"><h2 id="basic-title">Идентичность и время</h2><p>«Показать уведомление» — success с описанием и временем по умолчанию: автооткрывается (attention auto) и закрывается по TTL, пока нет hover/фокуса. Общий ID не связывает два контроллера. Ссылка закрывает запись навигацией.</p>
          <div className="lab-buttons"><button disabled={disabled} onClick={() => controller.show({ title: 'Изменения сохранены', kind: 'success', description: { kind: 'text', text: long ? 'Рабочее пространство обновлено. '.repeat(35) + 'تم حفظ التغييرات بنجاح. '.repeat(12) : 'Рабочее пространство обновлено. Можно продолжать работу.' } })}>Показать уведомление</button>
            <button disabled={disabled} onClick={() => controller.show({ id: 'shared', title: 'Основной контроллер', duration: null, attention: 'stack' })}>Общий ID в основном</button>
            <button disabled={disabled} onClick={() => controller.show({ title: 'Документация Cloudlet', action: { kind: 'link', label: 'Открыть README', href: 'https://github.com/Meerzus/cloudlet', target: '_blank' } })}>Ссылка</button>
            <button disabled={disabled} onClick={() => session.dedupe()}>Dedupe ×3</button>
          </div>
        </section>
        <section aria-labelledby="promise-title"><h2 id="promise-title">Три независимые операции</h2><p>Начните A/B/C, затем завершайте в любом порядке. Исход Promise и применение к UI показаны отдельно; стопка показывает каждую операцию своей записью.</p>
          <div className="lab-buttons"><button disabled={disabled} onClick={startABC}>Начать A/B/C</button><button disabled={disabled} onClick={() => reverse(false)}>Resolve C → B → A</button><button disabled={disabled} onClick={() => reverse(true)}>Reject C → B → A</button></div>
          <div className="lab-task-controls">{['A', 'B', 'C'].map(name => <div key={name}><strong>{name}</strong><button disabled={disabled} onClick={() => session.settle(name)}>Resolve {name}</button><button disabled={disabled} onClick={() => session.settle(name, true)}>Reject {name}</button><button disabled={disabled} onClick={() => session.retry(name)}>Retry {name}</button></div>)}</div>
        </section>
        <section aria-labelledby="error-title"><h2 id="error-title">Ошибки и повтор действия</h2><p>Sync throw сохраняет rejection. Ошибка mapper оставляет исход операции fulfilled. «Действие с повтором» откройте в Island, нажмите «Опубликовать», затем завершите вручную.</p>
          <div className="lab-buttons"><button disabled={disabled} onClick={() => session.errors(false)}>Sync throw</button><button disabled={disabled} onClick={() => session.errors(true)}>Mapper error</button><button disabled={disabled} onClick={() => session.showAction()}>Действие с повтором</button><button disabled={disabled} onClick={() => session.settleAction(true)}>Отклонить действие</button><button disabled={disabled} onClick={() => session.settleAction(false)}>Завершить действие</button></div>
        </section>
        <section aria-labelledby="cancel-title"><h2 id="cancel-title">Отмена, поздний результат, reuse ID</h2><p>Cooperative cancel отклоняет Promise с AbortError. Ignored abort остаётся pending до Resolve. Dismiss освобождает UI, сохраняя бизнес-операцию.</p>
          <div className="lab-buttons"><button disabled={disabled} onClick={() => session.start('cancel', 'cooperative')}>Cooperative cancel</button><button disabled={disabled} onClick={() => session.cancel('cancel')}>Отменить cancel</button><button disabled={disabled} onClick={() => session.start('ignore', 'ignore')}>Ignored abort</button><button disabled={disabled} onClick={() => session.cancel('ignore')}>Отменить ignore</button><button disabled={disabled} onClick={() => session.settle('ignore')}>Resolve ignore</button><button disabled={disabled} onClick={() => session.reuse()}>Reuse ID</button><button disabled={disabled} onClick={() => session.resolveOld()}>Resolve old</button></div>
        </section>
        <section aria-labelledby="stress-title"><h2 id="stress-title">Нагрузка с выключателем</h2><p>120 событий проверяют cap 100. Stress резервирует progress и подаёт 30 updates/s одним интервалом; журнал хранит последние 80 строк каждого типа.</p>
          <div className="lab-buttons"><button disabled={disabled} onClick={() => session.burst()}>Burst 120</button><button disabled={disabled} onClick={() => session.capacityTask()}>Task при capacity</button><button disabled={disabled || state.running} onClick={() => session.startStress()}>Старт stress</button><button disabled={!state.running} onClick={() => session.stopStress()}>Стоп stress</button></div>
          <p className="lab-mono">progress updates: <span data-testid="stress-updates">{state.updates}</span> · {state.running ? '30/s · running' : 'stopped'}</p>
        </section>
      </div>
      <aside className="lab-diagnostics" aria-label="Диагностика основного контроллера">
        <div className="lab-diagnostic-head"><h2>Наблюдение</h2><span className="lab-mono">public snapshot</span></div>
        <div className="lab-buttons"><button disabled={disabled} onClick={() => { session.stopStress(); setAttached(value => !value); }}>{attached ? 'Отключить Toaster' : 'Подключить Toaster'}</button><button disabled={disabled || !attached} onClick={() => controller.requestFocus()}>Фокус на уведомления</button><button disabled={disabled} onClick={() => session.clear()}>Очистить</button><button disabled={disabled} onClick={() => { setAttached(false); session.dispose(); }}>Dispose основного</button><button onClick={recreate}>Пересоздать основной</button></div>
        <p className="lab-mono" data-testid="lab-resources">intervals={state.intervals} pending={state.pending} listeners={state.listeners}</p>
        <p className="lab-hint" role="status">{state.message}</p>
        <h3>Записи стопки</h3>
        <div className="lab-records" data-testid="lab-notifications">{snapshot.notifications.length === 0 ? <p className="lab-empty">Нет принятых событий.</p> : snapshot.notifications.map(notification => <article key={notification.handle.generation} data-notification-id={notification.handle.id} data-current={notification.location === 'current'} data-occurrences={notification.occurrences} data-operation={notification.operation?.status} data-cancel-requested={notification.operation?.cancelRequested}>
          <div><strong>{notification.content.title}</strong><span>{notification.location} · #{snapshot.stack.indexOf(notification.handle) + 1} · {notification.kind} · ×{notification.occurrences}</span></div><code>{notification.handle.id}<br />{notification.handle.generation}</code>
          <small>{notification.remainingMs === null ? 'persistent' : `${Math.round(notification.remainingMs)}ms`} · {notification.pauseReasons.join(', ') || 'readable'}</small>
          <div className="lab-buttons"><button disabled={disabled} aria-label={`Dismiss ${notification.handle.id}`} onClick={() => controller.dismiss(notification.handle)}>Dismiss</button></div>
        </article>)}</div>
        <h3>Исходы операций</h3><div className="lab-outcomes">{state.tasks.length === 0 ? <p className="lab-empty">Операции ещё не запущены.</p> : state.tasks.map(task => <div key={task.name} data-testid={`task-${task.name}`} data-status={task.status}><strong>{task.name} · {task.status}</strong><span>admission={task.admission} · attempt={task.attempt}</span><code>{task.outcome}</code></div>)}</div>
        <details open><summary>Logical events · последние 80</summary><ol data-testid="logical-log" className="lab-log" tabIndex={0} aria-label="Logical events основного контроллера">{state.logical.map(entry => <li key={entry.sequence}>{entry.text}</li>)}</ol></details>
        <details><summary>Presentation / diagnostics · последние 80</summary><p className="lab-hint">Подтверждённый readable показ и diagnostics. Это не исход Promise; кадры анимации не журналируются.</p><ol data-testid="presentation-log" className="lab-log" tabIndex={0} aria-label="Presentation основного контроллера">{state.presentation.map(entry => <li key={entry.sequence}>{entry.text}</li>)}</ol></details>
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
  return <section className="lab-secondary" aria-labelledby="secondary-title"><h2 id="secondary-title">Второй независимый контроллер</h2><p>Тёмная тема, противоположный край окна, собственный ID shared. Reset и dispose основного не изменяют этот экземпляр.</p><div className="lab-buttons"><button disabled={disabled} onClick={() => session.controller.show({ id: 'shared', title: 'Второй контроллер', duration: null })}>Показать во втором</button><button disabled={disabled} onClick={() => session.controller.clear()}>Очистить второй</button><button disabled={disabled} onClick={() => setAttached(value => !value)}>{attached ? 'Отключить второй Toaster' : 'Подключить второй Toaster'}</button><button disabled={disabled} onClick={() => { setAttached(false); session.dispose(); }}>Dispose второго</button><button onClick={reset}>Reset второго</button></div><p data-testid="secondary-summary" data-count={snapshot.notifications.length} data-disposed={snapshot.disposed}>{snapshot.notifications.length} принято · {disabled ? 'disposed' : attached ? 'active' : 'без renderer'}</p>
    <details className="lab-secondary-diagnostics"><summary>Диагностика второго контроллера</summary>{snapshot.notifications.map(item => <p key={item.handle.generation}><code>{item.handle.id} · {item.handle.generation}</code></p>)}<h3>Logical · последние 80</h3><ol className="lab-log" tabIndex={0} aria-label="Logical events второго контроллера">{state.logical.map(entry => <li key={entry.sequence}>{entry.text}</li>)}</ol><h3>Presentation / diagnostics · последние 80</h3><ol className="lab-log" tabIndex={0} aria-label="Presentation второго контроллера">{state.presentation.map(entry => <li key={entry.sequence}>{entry.text}</li>)}</ol></details>
    <CloudletProvider controller={session.controller}>{attached && !disabled && <Toaster position={position} theme="dark" offsets={inset ? { obstruction: { bottom: 72 } } : {}} labels={{ ...labels, region: 'Независимые уведомления' }} motion={motion} {...(nonce ? { nonce } : {})} />}</CloudletProvider></section>;
}

const fixtures = [
  ['attention', 'Автооткрытие'], ['slider', 'Слайдер открыт'], ['no-reset', 'Без CSS reset'], ['hostile', 'Агрессивный CSS'], ['long-text', 'Длинные тексты / RTL'],
  ['zoom', 'Крупный текст'], ['portal', 'Свой portal'], ['inset', 'Мобильная панель'], ['visual', 'Облик'],
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
    <a className="lab-skip" href="#scenarios">К сценариям</a>
    <header className="lab-header" data-lab-keep-island="">
      <a href="/" className="lab-brand">Cloudlet<span>Лаборатория · стопка → Island</span></a>
      <div className="lab-speed">
        <Choice label="timeScale" value={timeScale} onChange={setTimeScale} options={timeScales.map(value => [value, value] as const)} />
        <output data-testid="lab-timescale" data-slowed={slowed} aria-live="polite">{slowed ? `Замедление ×${timeScale}` : 'Скорость ×1'}</output>
      </div>
      <nav aria-label="Разделы"><a href="#scenarios">Сценарии</a><a href="#motion">Движение</a><a href="#fixtures">Окружения</a><a href="#notes">Как читать стенд</a></nav>
    </header>
    <main><div className="lab-intro"><p className="lab-kicker">Стопка → Island · DESIGN §1–§7</p><h1>Одна стопка.<br /><span>Один Island.</span></h1><p>Соберите стопку, раскройте её в Island, листайте и закрывайте уведомления. Замедлите время, чтобы рассмотреть морфинг, блюр-смену и слайд, и подберите пружины без пересборки.</p></div>
      <Settings {...{ position, setPosition, theme, setTheme, dir, setDir, motion: motionPreference, setMotion: setMotionPreference, inset, setInset, long, setLong, auto, setAuto }} />
      <div id="scenarios" tabIndex={-1}>{session && preference && <Workspace key={epoch + ':' + String(activeAuto)} {...{ session, position, theme, dir, inset, long, motion }}
        recreate={() => { setActiveAuto(auto); setEpoch(value => value + 1); }}
        studio={<MotionPanel overrides={overrides} setOverrides={setOverrides} timeScale={timeScale} setTimeScale={setTimeScale} />} />}</div>
      {secondary && preference && <Secondary key={secondaryEpoch} session={secondary} reset={() => setSecondaryEpoch(value => value + 1)} position={secondaryPosition} inset={inset} motion={motion} />}
      <section id="fixtures" className="lab-fixtures"><h2>Отдельные страницы</h2><p>Каждая страница загружает только собственные стили и CSS пакета. Reset основного стенда туда не попадает.</p><div>{fixtures.map(([route, title]) => <a key={route} href={`?fixture=${route}`}>{title}<span aria-hidden="true">↗</span></a>)}</div>
        <p className="lab-hint">QA-стенды: <a href="?surface">поверхность</a> · <a href="?fixture=accessibility">доступность</a> · <a href="?fixture=mobile">мобильные жесты</a>.</p></section>
      <section id="notes" className="lab-notes"><h2>Как читать результаты</h2><p>Cloudlet работает внутри окна браузера и PWA. Аппаратный Island и системные уведомления в этот стенд не входят.</p><p>timeScale растягивает время всех переходов; 0.1 — в десять раз медленнее. Панель движения пишет значения в отладочный <code>motion.overrides</code>: новые значения действуют на следующий переход, идущий доигрывает со старыми. «Скопировать JSON» даёт полный набор значений для задачи 17.</p><p>Dismiss и clear удаляют UI, а отмена кооперативна. При capacity=100 бизнес-операция всё равно запускается: admission и result независимы.</p><p>Reset освобождает интервалы, таймеры и abort listeners, завершает принадлежащие стенду deferred promises и пересоздаёт оба контроллера. Журналы локальны и ограничены; содержимое не отправляется на сервер.</p><p>Автоматические проверки не заменяют VoiceOver/NVDA, физический Safari/PWA, pinch zoom и экранную клавиатуру.</p></section>
    </main><footer>Cloudlet · локальный интерактивный стенд</footer>{inset && <div className="lab-bottom-nav" aria-label="Имитация нижней навигации">Рабочее пространство · Файлы · Настройки</div>}
  </div>;
}

export function LaboratoryShell() {
  const [mounted, setMounted] = useState(true); const [generation, setGeneration] = useState(0);
  return <><div className="lab-owner-controls"><button onClick={() => setGeneration(value => value + 1)}>Полный reset</button><button onClick={() => setMounted(value => !value)}>{mounted ? 'Размонтировать лабораторию' : 'Смонтировать лабораторию'}</button></div>{mounted ? <Laboratory key={generation} /> : <main className="lab-unmounted"><h1>Лаборатория размонтирована</h1><p>Оба контроллера disposed. Ресурсы стенда освобождены.</p></main>}</>;
}
