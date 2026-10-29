import { mkdir, writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { designMotion } from '../../apps/lab/src/design-motion.js';

interface LabAudit {
  errors: string[];
  violations: { directive: string; blocked: string }[];
  intervals: number;
  resizeTargets: number;
  rafPending: number;
  viewportListeners: number;
  mediaListeners: number;
  lifecycleListeners: number;
  fullUnmount?: { intervals: number; resizeTargets: number; rafPending: number; viewportListeners: number; mediaListeners: number; lifecycleListeners: number };
}

declare global {
  interface Window { __labAudit: LabAudit; }
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const rows = (page: Page) => page.getByTestId('lab-notifications').locator('[data-notification-id]');
const currentRow = (page: Page) => page.getByTestId('lab-notifications').locator('[data-notification-id][data-current="true"]');
const host = (page: Page) => page.locator('.lab-main-host');
const pill = (page: Page) => host(page).locator('.cloudlet-pill');
const island = (page: Page) => host(page).getByRole('region', { name: 'Текущие уведомления', exact: true });

async function installAudit(page: Page) {
  await page.addInitScript(() => {
    const audit: LabAudit = { errors: [], violations: [], intervals: 0, resizeTargets: 0, rafPending: 0, viewportListeners: 0, mediaListeners: 0, lifecycleListeners: 0 };
    window.__labAudit = audit;
    document.addEventListener('securitypolicyviolation', event => audit.violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
    window.addEventListener('error', event => { if (event.message) audit.errors.push(event.message); });
    window.addEventListener('unhandledrejection', event => audit.errors.push(String(event.reason)));

    // Observe actual browser resources, independently from the lab's own counters.
    function observeLifecycle(target: Window | Document, types: readonly string[]) {
      const callbacks = new Map<string, Set<EventListenerOrEventListenerObject>>();
      const add = target.addEventListener.bind(target);
      const remove = target.removeEventListener.bind(target);
      target.addEventListener = ((type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
        if (callback) {
          if (types.includes(type)) {
            const entries = callbacks.get(type) ?? new Set<EventListenerOrEventListenerObject>();
            if (!entries.has(callback)) { entries.add(callback); audit.lifecycleListeners += 1; }
            callbacks.set(type, entries);
          }
          add(type, callback, options);
        }
      }) as typeof target.addEventListener;
      target.removeEventListener = ((type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) => {
        if (callback) {
          if (callbacks.get(type)?.delete(callback)) audit.lifecycleListeners -= 1;
          remove(type, callback, options);
        }
      }) as typeof target.removeEventListener;
    }
    observeLifecycle(window, ['pagehide']);
    observeLifecycle(document, ['visibilitychange']);
    const interval = window.setInterval.bind(window);
    const clearInterval = window.clearInterval.bind(window);
    const intervals = new Set<number>();
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const id = interval(handler, timeout, ...args);
      intervals.add(id); audit.intervals = intervals.size;
      return id;
    }) as typeof window.setInterval;
    window.clearInterval = id => {
      if (typeof id === 'number') intervals.delete(id);
      audit.intervals = intervals.size;
      clearInterval(id);
    };
    const Resize = window.ResizeObserver;
    window.ResizeObserver = class extends Resize {
      private observed = new Set<Element>();
      override observe(target: Element, options?: ResizeObserverOptions) {
        if (!this.observed.has(target)) { this.observed.add(target); audit.resizeTargets += 1; }
        super.observe(target, options);
      }
      override unobserve(target: Element) {
        if (this.observed.delete(target)) audit.resizeTargets -= 1;
        super.unobserve(target);
      }
      override disconnect() { audit.resizeTargets -= this.observed.size; this.observed.clear(); super.disconnect(); }
    };
    const raf = requestAnimationFrame.bind(window);
    const cancel = cancelAnimationFrame.bind(window);
    const pending = new Set<number>();
    window.requestAnimationFrame = callback => {
      const id = raf(time => { pending.delete(id); audit.rafPending = pending.size; callback(time); });
      pending.add(id); audit.rafPending = pending.size;
      return id;
    };
    window.cancelAnimationFrame = id => { pending.delete(id); audit.rafPending = pending.size; cancel(id); };
    const matchMedia = window.matchMedia.bind(window);
    const instrumented = new WeakSet<MediaQueryList>();
    window.matchMedia = value => {
      const media = matchMedia(value);
      if (instrumented.has(media)) return media;
      instrumented.add(media);
      const callbacks = new Set<EventListenerOrEventListenerObject>();
      const add = media.addEventListener.bind(media);
      const remove = media.removeEventListener.bind(media);
      media.addEventListener = ((type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
        if (callback) {
          if (!callbacks.has(callback)) { callbacks.add(callback); audit.mediaListeners += 1; }
          add(type, callback, options);
        }
      }) as typeof media.addEventListener;
      media.removeEventListener = ((type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) => {
        if (callback) {
          if (callbacks.delete(callback)) audit.mediaListeners -= 1;
          remove(type, callback, options);
        }
      }) as typeof media.removeEventListener;
      return media;
    };
    const viewport = window.visualViewport;
    if (viewport) {
      const add = viewport.addEventListener.bind(viewport);
      const remove = viewport.removeEventListener.bind(viewport);
      const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
      viewport.addEventListener = ((type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
        if (callback) {
          const callbacks = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
          callbacks.add(callback); listeners.set(type, callbacks);
          audit.viewportListeners = [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0);
        }
        if (callback) add(type, callback, options);
      }) as typeof viewport.addEventListener;
      viewport.removeEventListener = ((type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) => {
        if (callback) listeners.get(type)?.delete(callback);
        audit.viewportListeners = [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0);
        if (callback) remove(type, callback, options);
      }) as typeof viewport.removeEventListener;
    }
  });
}

async function openLab(page: Page) {
  await installAudit(page);
  const response = await page.goto('/');
  expect(response?.headers()['content-security-policy']).toContain("style-src-attr 'none'");
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Один Island');
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByTestId('lab-resources')).toContainText('intervals=0 pending=0 listeners=0');
}

async function reset(page: Page) {
  await button(page, 'Полный reset').click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByTestId('lab-resources')).toContainText('intervals=0 pending=0 listeners=0');
}


/** Waits until no animation frame is pending (an idle host never keeps a RAF loop). */
async function idle(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__labAudit.rafPending), { timeout: 10_000 }).toBe(0);
}
async function currentIds(page: Page) {
  return currentRow(page).evaluateAll(elements => elements.map(element => element.getAttribute('data-notification-id')));
}
/** Share of the opening morph done `ms` after a click on the pill: 0 = pill width, 1 = Island width. */
async function openProgress(page: Page, ms: number) {
  return page.evaluate(async delay => {
    const root = document.querySelector('.lab-main-host')!;
    const svg = root.querySelector('.cloudlet-bg')!;
    const from = Number(svg.getAttribute('width'));
    root.querySelector<HTMLButtonElement>('.cloudlet-pill')!.click();
    await new Promise(resolve => setTimeout(resolve, delay));
    const target = root.querySelector('.cloudlet-stack > .cloudlet-shell')!.getBoundingClientRect().width;
    return (Number(svg.getAttribute('width')) - from) / (target - from);
  }, ms);
}

test.afterEach(async ({ page, browser }, info) => {
  const audit = await page.evaluate(() => window.__labAudit).catch(() => undefined);
  if (!audit) return;
  await info.attach('lab-runtime-audit', {
    body: JSON.stringify({ browserVersion: browser.version(), project: info.project.name, audit }, null, 2),
    contentType: 'application/json',
  });
  expect(audit.errors).toEqual([]);
  expect(audit.violations).toEqual([]);
  await mkdir('artifacts/task16/audits', { recursive: true });
  const name = info.title.replace(/[^a-z0-9]+/giu, '-').slice(0, 120);
  await writeFile(`artifacts/task16/audits/${info.project.name}-${name}.json`, JSON.stringify({
    project: info.project.name, browserVersion: browser.version(), title: info.title, status: info.status, audit,
  }, null, 2));
});

test('3 notifications → open → close current → collapse, with the transition log and DOM state', async ({ page }) => {
  await openLab(page);
  const log = page.getByTestId('transition-log');
  await button(page, '3 уведомления').click();
  await expect(pill(page)).toHaveAccessibleName('Новый комментарий, уведомлений: 3');
  await expect(page.getByTestId('island-state')).toContainText('data-state: stack · стопка 3');
  await expect(log.locator('li').last()).toHaveText('stack · current=Новый комментарий (1/3)');
  await button(page, 'Открыть Island').click();
  await expect(host(page)).toHaveAttribute('data-state', 'island');
  await expect(page.getByTestId('island-state')).toContainText('data-state: island · user');
  await expect(log.locator('li').last()).toHaveText('island · user · current=Новый комментарий (1/3)');
  // Lab controls never collapse the Island: the record closes inside it and the slider moves to the older one.
  await button(page, 'Закрыть текущее').click();
  await expect(island(page).getByRole('group', { name: '1 из 2', exact: true })).toBeVisible();
  await expect(island(page).getByRole('heading', { name: 'Файл загружен', exact: true })).toBeVisible();
  await expect(log.locator('li').last()).toHaveText('island · user · current=Файл загружен (1/2)');
  await expect(page.getByTestId('logical-log')).toContainText('closed comment');
  await expect(page.getByTestId('logical-log')).toContainText('close-button');
  await button(page, 'Свернуть').click();
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  await expect(log.locator('li').last()).toHaveText('stack · current=Файл загружен (1/2)');
  // A press on the page itself is outside the Island and collapses it.
  await button(page, 'Открыть Island').click();
  await expect(host(page)).toHaveAttribute('data-state', 'island');
  await page.getByRole('heading', { level: 1 }).click();
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  await expect(page.getByTestId('lab-summary')).toHaveAttribute('data-state', 'stack');
});

test('timeScale switch slows the morph and is indicated in the lab header', async ({ page }) => {
  await openLab(page);
  await expect(page.getByTestId('lab-timescale')).toHaveText('Скорость ×1');
  await button(page, '3 уведомления').click();
  await idle(page);
  const normal = await openProgress(page, 400);
  expect(normal).toBeGreaterThan(0.9);
  await button(page, 'Свернуть').click();
  await idle(page);
  await page.getByRole('group', { name: 'timeScale', exact: true }).getByRole('radio', { name: '0.1', exact: true }).check();
  await expect(page.getByTestId('lab-timescale')).toHaveText('Замедление ×0.1');
  await expect(page.locator('.lab')).toHaveAttribute('data-time-scale', '0.1');
  // At 1× the open spring is visually done by ~400 ms; at 0.1× it has barely started.
  const slowed = await openProgress(page, 400);
  expect(slowed).toBeLessThan(0.5);
  // The tuning panel repeats the switch: the open Island may cover the header at the top centre.
  const speed = page.getByRole('group', { name: 'Скорость переходов', exact: true });
  await expect(speed.getByRole('button', { name: '×0.1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await speed.getByRole('button', { name: '×0.5', exact: true }).click();
  await expect(page.getByTestId('lab-timescale')).toHaveText('Замедление ×0.5');
  await expect(page.getByRole('radio', { name: '0.5', exact: true })).toBeChecked();
  for (const value of ['0.25', '1']) await page.getByRole('radio', { name: value, exact: true }).check();
  await expect(page.getByTestId('lab-timescale')).toHaveText('Скорость ×1');
  await expect(speed.getByRole('button', { name: '×1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await idle(page);
});

test('motion panel applies springs live, resets to DESIGN, persists, copies and applies JSON', async ({ page, context, browserName }) => {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openLab(page);
  const panel = page.getByTestId('motion-panel');
  const stiffness = panel.locator('input[name="shapeOpen.stiffness"]');
  await expect(panel).toHaveAttribute('data-changed', '0');
  await expect(stiffness).toHaveValue(String(designMotion.shapeOpen.stiffness));
  await button(page, '3 уведомления').click();
  await idle(page);
  const before = await openProgress(page, 150);
  await button(page, 'Свернуть').click();
  await idle(page);
  // A soft, critically damped spring: the same 150 ms covers far less of the morph, without a rebuild.
  await stiffness.fill('30');
  await panel.locator('input[name="shapeOpen.damping"]').fill('11');
  await expect(panel).toHaveAttribute('data-changed', '2');
  await expect(stiffness.locator('xpath=..')).toHaveAttribute('data-changed', 'true');
  await expect(stiffness.locator('xpath=..')).toContainText(`DESIGN: ${designMotion.shapeOpen.stiffness}`);
  const after = await openProgress(page, 150);
  expect(after).toBeLessThan(before * 0.6);
  await button(page, 'Свернуть').click();

  await panel.getByText('JSON настроек').click();
  const json = JSON.parse(await page.getByTestId('motion-json').inputValue()) as { timeScale: number; motion: { shapeOpen: unknown; blur: number }; changed: unknown };
  expect(json.timeScale).toBe(1);
  expect(json.motion.shapeOpen).toEqual({ ...designMotion.shapeOpen, stiffness: 30, damping: 11 });
  expect(json.motion.blur).toBe(6);
  expect(json.changed).toEqual({ shapeOpen: { stiffness: 30, damping: 11 } });
  await button(page, 'Скопировать JSON').click();
  await expect(page.getByTestId('motion-status')).toContainText(/JSON (скопирован|выделен)/u);
  if (browserName === 'chromium') expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(json);

  // Overrides survive a reload of this browser.
  await page.reload();
  await expect(panel).toHaveAttribute('data-changed', '2');
  await expect(stiffness).toHaveValue('30');

  await panel.getByText('JSON настроек').click();
  await page.getByTestId('motion-json').fill('{"motion":{"blurr":1}}');
  await button(page, 'Применить JSON').click();
  await expect(page.getByTestId('motion-status')).toContainText('Неизвестный ключ «blurr»');
  await expect(panel).toHaveAttribute('data-changed', '2');
  await page.getByTestId('motion-json').fill('{"timeScale":0.25,"motion":{"blur":9}}');
  await button(page, 'Применить JSON').click();
  await expect(page.getByTestId('motion-status')).toHaveText('JSON применён.');
  await expect(panel).toHaveAttribute('data-changed', '1');
  await expect(panel.locator('input[name="blur"]')).toHaveValue('9');
  await expect(page.getByTestId('lab-timescale')).toHaveText('Замедление ×0.25');

  await button(page, 'Сбросить к DESIGN').click();
  await expect(panel).toHaveAttribute('data-changed', '0');
  await expect(panel.locator('input[name="blur"]')).toHaveValue(String(designMotion.blur));
  await expect(stiffness).toHaveValue(String(designMotion.shapeOpen.stiffness));
  await page.reload();
  await expect(panel).toHaveAttribute('data-changed', '0');
});

test('generators follow attention, retry and loading → success/error through track, overflow and acknowledge', async ({ page }) => {
  await openLab(page);
  const attention = page.getByRole('group', { name: 'attention', exact: true });
  await attention.getByRole('radio', { name: 'stack', exact: true }).check();
  await button(page, 'С описанием').click();
  await button(page, 'С действием').click();
  await page.waitForTimeout(1200);
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  await attention.getByRole('radio', { name: 'auto', exact: true }).check();
  await button(page, 'Без ничего').click();
  await page.waitForTimeout(1200);
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  await button(page, 'С описанием').click();
  await expect(host(page)).toHaveAttribute('data-island-reason', 'attention');
  await expect(island(page).getByRole('heading', { name: /^Документ обновлён · 4$/u })).toBeVisible();
  await button(page, 'Свернуть').click();
  await expect(host(page)).toHaveAttribute('data-state', 'stack');

  // A failed attempt becomes an attention candidate with retry; the retry succeeds.
  await button(page, 'С retry').click();
  const retry = island(page).locator('[data-cloudlet-control="retry"]');
  await expect(retry).toBeVisible({ timeout: 5000 });
  await expect(island(page).getByRole('heading', { name: /^Не удалось отправить/u })).toBeVisible();
  await retry.click();
  await expect(island(page).getByRole('heading', { name: /^Отчёт отправлен/u })).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-testid^="task-retry-"]')).toHaveAttribute('data-status', 'fulfilled');

  await button(page, 'Loading → error').click();
  await expect(rows(page).filter({ hasText: /^Сохраняем изменения/u })).toHaveCount(1);
  await expect(page.locator('[data-testid^="task-error-"]')).toHaveAttribute('data-status', 'rejected', { timeout: 5000 });
  await expect(rows(page).filter({ hasText: /^Сохранение не удалось/u })).toHaveCount(1);
  await button(page, 'Loading → success').click();
  await expect(page.locator('[data-testid^="task-success-"]')).toHaveAttribute('data-status', 'fulfilled', { timeout: 5000 });
  await expect(rows(page).filter({ hasText: /^Изменения сохранены/u })).toHaveCount(1);

  await button(page, 'Очистить').click();
  await button(page, 'С прогрессом').click();
  await expect(page.getByTestId('lab-resources')).toContainText('intervals=1');
  const bar = island(page).getByRole('progressbar');
  await expect(bar).toBeVisible();
  await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  await expect(island(page).getByRole('heading', { name: /^Архив загружен/u })).toBeVisible({ timeout: 6000 });
  await expect(page.getByTestId('lab-resources')).toContainText('intervals=0');

  await button(page, 'Очистить').click();
  await button(page, 'Переполнить · 101').click();
  await expect(rows(page)).toHaveCount(100);
  await expect(page.getByTestId('lab-summary')).toHaveAttribute('data-overflow', '1');
  await expect(pill(page)).toHaveAccessibleName('Файл 100 обработан, уведомлений: 100, пропущено: 1');
  await button(page, 'Подтвердить пропущенные').click();
  await expect(pill(page)).toHaveAccessibleName('Файл 100 обработан, уведомлений: 100');
  await reset(page);
});

test('independent A/B/C tasks settle backwards without reordering the stack', async ({ page }) => {
  await openLab(page);
  await button(page, 'Начать A/B/C').click();
  await expect(rows(page)).toHaveCount(3);
  for (const id of ['A', 'B', 'C']) await expect(page.getByTestId(`task-${id}`)).toHaveAttribute('data-status', 'pending');
  expect(await currentIds(page)).toEqual(['task-C']);
  await button(page, 'Resolve C → B → A').click();
  for (const id of ['A', 'B', 'C']) await expect(page.getByTestId(`task-${id}`)).toHaveAttribute('data-status', 'fulfilled');
  await expect(rows(page)).toHaveCount(3);
  expect(await currentIds(page)).toEqual(['task-C']);
  await expect(page.getByTestId('logical-log')).toContainText('operation');
  await expect(page.getByTestId('presentation-log')).toContainText('present');
  const settledOrder = (await page.getByTestId('logical-log').locator('li').allTextContents())
    .filter(text => text.includes('operation-settled')).map(text => text.match(/task-([ABC])/u)?.[1]);
  expect(settledOrder).toEqual(['C', 'B', 'A']);
  await expect(page.getByTestId('presentation-log')).not.toContainText('operation-settled');
  await reset(page);
  await button(page, 'Начать A/B/C').click();
  await button(page, 'Reject C → B → A').click();
  for (const id of ['A', 'B', 'C']) await expect(page.getByTestId(`task-${id}`)).toHaveAttribute('data-status', 'rejected');
  await expect(rows(page)).toHaveCount(3);
  await button(page, 'Retry A').click();
  await expect(page.getByTestId('task-A')).toHaveAttribute('data-status', 'pending');
  await expect(page.getByTestId('task-A')).toContainText('attempt=2');
  await expect(page.getByTestId('task-B')).toHaveAttribute('data-status', 'rejected');
  await button(page, 'Resolve A').click();
  await expect(page.getByTestId('task-A')).toHaveAttribute('data-status', 'fulfilled');
  await expect(rows(page)).toHaveCount(3);
});

test('sync throw and mapper failure expose operation outcomes without unhandled rejections', async ({ page }) => {
  await openLab(page);
  await button(page, 'Sync throw').click();
  await expect(page.getByTestId('task-sync')).toHaveAttribute('data-status', 'rejected');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute('data-operation', 'rejected');
  await button(page, 'Mapper error').click();
  await expect(page.getByTestId('task-mapper')).toHaveAttribute('data-status', 'fulfilled');
  await expect(page.getByTestId('task-mapper')).toContainText('business value preserved');
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByTestId('presentation-log')).toContainText('mapper-error');
});

test('command failure keeps its record in the Island, blocks duplicate activation and permits retry', async ({ page }) => {
  await openLab(page);
  await button(page, 'Действие с повтором').click();
  // Description + action: attention `auto` opens the Island by itself.
  await expect(host(page)).toHaveAttribute('data-island-reason', 'attention');
  const action = island(page).locator('[data-cloudlet-control="action"]');
  await expect(action).toHaveText('Опубликовать');
  await action.focus(); await page.keyboard.press('Enter');
  await expect(action).toHaveAttribute('aria-disabled', 'true');
  await action.press('Enter');
  await button(page, 'Отклонить действие').click();
  await expect(action).toHaveAttribute('aria-disabled', 'false');
  await expect(island(page)).toContainText(/не удалась/iu);
  await expect(rows(page)).toHaveCount(1);
  await action.focus(); await page.keyboard.press('Enter');
  await expect(action).toHaveAttribute('aria-disabled', 'true');
  await button(page, 'Завершить действие').click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByTestId('lab-resources')).toContainText('pending=0');
  await expect(page.getByTestId('logical-log')).toContainText('action-success');
});

test('cancellation reports the real outcome and stale completion cannot mutate a reused ID', async ({ page }) => {
  await openLab(page);
  await button(page, 'Cooperative cancel').click();
  await expect(page.getByTestId('task-cancel')).toHaveAttribute('data-status', 'pending');
  await button(page, 'Отменить cancel').click();
  await expect(page.getByTestId('task-cancel')).toHaveAttribute('data-status', 'cancelled');
  await expect(page.getByTestId('lab-resources')).toContainText('pending=0');
  await reset(page);
  await button(page, 'Ignored abort').click();
  await button(page, 'Отменить ignore').click();
  await expect(page.getByTestId('task-ignore')).toHaveAttribute('data-status', 'pending');
  await button(page, 'Resolve ignore').click();
  await expect(page.getByTestId('task-ignore')).toHaveAttribute('data-status', 'fulfilled');
  await expect(rows(page)).toHaveCount(1);
  await reset(page);
  await button(page, 'Reuse ID').click();
  const recreated = page.getByTestId('lab-notifications').locator('[data-notification-id="reused"]');
  await expect(recreated).toHaveCount(1);
  const title = await recreated.locator('strong').innerText();
  const generation = (await recreated.locator('code').textContent())!;
  await button(page, 'Resolve old').click();
  await expect(page.getByTestId('task-old')).toHaveAttribute('data-status', 'fulfilled');
  await expect(recreated.locator('strong')).toHaveText(title);
  await expect(recreated.locator('code')).toHaveText(generation);
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId('lab-resources')).toContainText('pending=0');
});

test('dedupe and capacity admission are observable outcomes with bounded logs', async ({ page }) => {
  await openLab(page);
  await button(page, 'Dedupe ×3').click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute('data-occurrences', '3');
  await reset(page);
  await button(page, 'Burst 120').click();
  await expect(rows(page)).toHaveCount(100);
  await expect(page.getByTestId('lab-summary')).toHaveAttribute('data-overflow', '20');
  await expect(pill(page)).toHaveAccessibleName('Файл 100 обработан, уведомлений: 100, пропущено: 20');
  await button(page, 'Task при capacity').click();
  await expect(page.getByTestId('task-capacity')).toHaveAttribute('data-status', 'fulfilled');
  await expect(page.getByTestId('task-capacity')).toContainText('capacity');
  await expect(rows(page)).toHaveCount(100);
  await expect(page.getByTestId('logical-log').locator('li')).toHaveCount(80);
  expect(await page.getByTestId('presentation-log').locator('li').count()).toBeLessThanOrEqual(80);
  await button(page, 'Очистить').click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByTestId('lab-summary')).toHaveAttribute('data-overflow', '21');
});

test('two controllers retain independent shared IDs and one can be disposed without touching the other', async ({ page }) => {
  await openLab(page);
  const second = page.getByRole('region', { name: 'Независимые уведомления', exact: true });
  await button(page, 'Общий ID в основном').click();
  await button(page, 'Показать во втором').click();
  await expect(rows(page)).toHaveCount(1);
  await expect(pill(page)).toHaveAccessibleName('Основной контроллер');
  await expect(second.locator('.cloudlet-pill')).toHaveAccessibleName('Второй контроллер');
  await button(page, 'Отключить второй Toaster').click();
  await expect(second).toHaveCount(0);
  await expect(page.getByTestId('secondary-summary')).toHaveAttribute('data-count', '1');
  await expect(rows(page)).toHaveCount(1);
  await button(page, 'Подключить второй Toaster').click();
  await expect(second.locator('.cloudlet-pill')).toHaveAccessibleName('Второй контроллер');
  await button(page, 'Dispose основного').click();
  await expect(host(page)).toHaveCount(0);
  await expect(second.locator('.cloudlet-pill')).toHaveAccessibleName('Второй контроллер');
  await button(page, 'Пересоздать основной').click();
  await button(page, 'Общий ID в основном').click();
  await expect(rows(page)).toHaveCount(1);
  await button(page, 'Dispose второго').click();
  await expect(second).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
  await button(page, 'Reset второго').click();
  await expect(rows(page)).toHaveCount(1);
  await reset(page);
});

test('stress schedules 30 progress updates per second and stop freezes the counter', async ({ page }) => {
  await openLab(page);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await button(page, 'Старт stress').click();
  await page.clock.runFor(1000);
  const updates = Number(await page.getByTestId('stress-updates').innerText());
  expect(updates).toBeGreaterThanOrEqual(29);
  expect(updates).toBeLessThanOrEqual(31);
  await button(page, 'Стоп stress').click();
  await page.clock.runFor(1000);
  await expect(page.getByTestId('stress-updates')).toHaveText(String(updates));
  await button(page, 'Старт stress').click();
  await page.clock.runFor(1000);
  const resumed = Number(await page.getByTestId('stress-updates').innerText());
  expect(resumed - updates).toBeGreaterThanOrEqual(29);
  expect(resumed - updates).toBeLessThanOrEqual(31);
  await expect(rows(page)).toHaveCount(100);
  await button(page, 'Стоп stress').click();
  await reset(page);
});

test('stress stop, reset and unmount release actual timers, observers, frames and viewport listeners', async ({ page }) => {
  await openLab(page);
  await button(page, 'Старт stress').click();
  await expect(rows(page)).toHaveCount(100);
  await expect.poll(async () => Number(await page.getByTestId('stress-updates').innerText())).toBeGreaterThanOrEqual(6);
  await expect.poll(() => page.evaluate(() => window.__labAudit.intervals)).toBe(1);
  await button(page, 'Стоп stress').click();
  await expect.poll(() => page.evaluate(() => window.__labAudit.intervals)).toBe(0);
  await expect(page.getByTestId('lab-resources')).toContainText('intervals=0 pending=0 listeners=0');
  await button(page, 'Старт stress').click();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(() => page.evaluate(() => window.__labAudit.intervals)).toBe(0);
  await expect(page.getByTestId('lab-resources')).toContainText('intervals=0 pending=0 listeners=0');
  await reset(page);
  await button(page, 'Cooperative cancel').click();
  await button(page, 'Ignored abort').click();
  await button(page, 'С прогрессом').click();
  await button(page, 'Loading → success').click();
  await button(page, 'Старт stress').click();
  await reset(page);
  await expect.poll(() => page.evaluate(() => window.__labAudit.intervals)).toBe(0);
  await expect(page.getByTestId('secondary-summary')).toContainText('0');
  await button(page, 'Старт stress').click();
  await button(page, 'Отключить Toaster').click();
  await expect.poll(() => page.evaluate(() => window.__labAudit.intervals)).toBe(0);
  await button(page, 'Подключить Toaster').click();
  await reset(page);
  await button(page, 'Старт stress').click();
  await button(page, 'Cooperative cancel').click();
  await button(page, 'Ignored abort').click();
  await expect(page.getByTestId('lab-resources')).toContainText('pending=2 listeners=1');
  await button(page, 'Размонтировать лабораторию').click();
  await expect(page.locator('.cloudlet-host')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({ intervals: window.__labAudit.intervals, observers: window.__labAudit.resizeTargets,
    frames: window.__labAudit.rafPending, viewportListeners: window.__labAudit.viewportListeners, mediaListeners: window.__labAudit.mediaListeners, lifecycleListeners: window.__labAudit.lifecycleListeners }))).toEqual({ intervals: 0, observers: 0, frames: 0, viewportListeners: 0, mediaListeners: 0, lifecycleListeners: 0 });
  await page.evaluate(() => {
    const { intervals, resizeTargets, rafPending, viewportListeners, mediaListeners, lifecycleListeners } = window.__labAudit;
    window.__labAudit.fullUnmount = { intervals, resizeTargets, rafPending, viewportListeners, mediaListeners, lifecycleListeners };
  });
  await button(page, 'Смонтировать лабораторию').click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByTestId('lab-resources')).toContainText('intervals=0 pending=0 listeners=0');
});

test('auto-dismiss preference applies to a recreated controller and complete reset restores its baseline', async ({ page }) => {
  await openLab(page);
  await page.getByRole('checkbox', { name: 'Автозакрытие после reset', exact: true }).uncheck();
  await button(page, 'Пересоздать основной').click();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await button(page, 'Показать уведомление').click();
  await page.clock.runFor(7500);
  await expect(rows(page)).toHaveCount(1);
  await reset(page);
  await expect(page.getByRole('checkbox', { name: 'Автозакрытие после reset', exact: true })).toBeChecked();
  await button(page, 'Показать уведомление').click();
  // Auto-opened only for its description: the slide's TTL keeps running in the Island (DESIGN §6).
  await page.clock.runFor(1000);
  await expect(host(page)).toHaveAttribute('data-island-reason', 'attention');
  await page.mouse.move(0, 0);
  await page.clock.runFor(7500);
  await expect(rows(page)).toHaveCount(0);
});

test('settings, keyboard Island and narrow layout preserve readable user controls', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLab(page);
  await page.getByRole('group', { name: 'Позиция', exact: true }).getByRole('radio', { name: 'Снизу', exact: true }).check();
  await page.getByRole('group', { name: 'Тема', exact: true }).getByRole('radio', { name: 'Тёмная', exact: true }).check();
  const direction = page.getByRole('group', { name: 'Направление', exact: true });
  await direction.getByRole('radio', { name: 'LTR', exact: true }).check();
  await direction.getByRole('radio', { name: 'LTR', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(direction.getByRole('radio', { name: 'RTL', exact: true })).toBeChecked();
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await page.getByRole('group', { name: 'Движение', exact: true }).getByRole('radio', { name: 'Полное · явно', exact: true }).check();
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
  await page.getByRole('group', { name: 'Движение', exact: true }).getByRole('radio', { name: 'Reduce · эмуляция', exact: true }).check();
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await expect(host(page)).toHaveAttribute('data-reduced-motion', 'true');
  await page.getByRole('group', { name: 'Движение', exact: true }).getByRole('radio', { name: 'Как в системе', exact: true }).check();
  await button(page, '3 уведомления').focus();
  await page.keyboard.press('Enter');
  await expect(host(page)).toHaveAttribute('dir', 'rtl');
  await expect(host(page)).toHaveAttribute('data-edge', 'bottom');
  await pill(page).focus();
  await page.keyboard.press('Enter');
  await expect(island(page).locator('[data-cloudlet-title]')).toBeFocused();
  await page.keyboard.press('End');
  await expect(island(page).getByRole('group', { name: '3 из 3', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  await expect(pill(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(host(page)).toHaveAttribute('data-state', 'island');
  const viewport = page.viewportSize()!;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await idle(page);
  for (const control of await island(page).locator('[data-cloudlet-control]').all()) {
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // Playwright screenshots inject an inline style in WebKit, which this CSP rightly blocks.
  if (info.project.name !== 'webkit') {
    await mkdir('artifacts/task16', { recursive: true });
    await info.attach('lab-mobile-dark-rtl', { body: await page.screenshot({ path: `artifacts/task16/${info.project.name}-lab-mobile-dark-rtl.png`, caret: 'initial' }), contentType: 'image/png' });
  }
});

test('attention fixture opens deterministically after the delay, newest candidate wins', async ({ page }) => {
  await installAudit(page);
  const response = await page.goto('/?fixture=attention&delay=300');
  expect(response?.headers()['content-security-policy']).toContain("style-src-attr 'none'");
  await expect(page.getByTestId('attention-delay')).toHaveText('300');
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const state = page.getByTestId('attention-state');
  for (const name of ['auto без ничего', 'stack + действие']) {
    await button(page, name).click();
    await page.clock.runFor(1000);
    await expect(state).toHaveAttribute('data-state', 'stack');
  }
  await button(page, 'auto + описание').click();
  await page.clock.runFor(290);
  await expect(state).toHaveAttribute('data-state', 'stack');
  await page.clock.runFor(20);
  await expect(state).toHaveAttribute('data-state', 'island');
  await expect(state).toHaveAttribute('data-reason', 'attention');
  await expect(state).toHaveAttribute('data-current', 'auto-description-3');
  const line = await page.getByTestId('attention-log').locator('li').last().innerText();
  expect(line).toContain('island · attention · current=auto-description-3');
  expect(Number(line.match(/^\+(\d+)/u)?.[1])).toBeGreaterThanOrEqual(300);
  await button(page, 'Очистить').click();
  await button(page, 'Два кандидата').click();
  await page.clock.runFor(400);
  await expect(state).toHaveAttribute('data-current', 'auto-action-5');
  await button(page, 'Очистить').click();
  await button(page, 'open без ничего').click();
  await page.clock.runFor(400);
  await expect(state).toHaveAttribute('data-state', 'island');
  // axe schedules its own timers: run it on real time.
  await page.clock.resume();
  expect((await new AxeBuilder({ page }).include('.cloudlet-host').analyze()).violations).toEqual([]);
});

test('slider fixture opens the Island over three records and follows close/add/collapse', async ({ page }) => {
  await installAudit(page);
  await page.goto('/?fixture=slider');
  const state = page.getByTestId('slider-state');
  const region = page.getByRole('region', { name: 'Текущие уведомления', exact: true });
  await expect(state).toHaveAttribute('data-state', 'island');
  await expect(state).toHaveAttribute('data-current', 'slide-3');
  await expect(region.getByRole('group', { name: '1 из 3', exact: true })).toBeVisible();
  await expect(region.locator('.cloudlet-dot-button')).toHaveCount(3);
  await button(page, 'Закрыть текущее').click();
  await expect(state).toHaveAttribute('data-current', 'slide-2');
  await button(page, 'Добавить сверху').click();
  // A new record lands at index 0; the current slide stays.
  await expect(region.getByRole('group', { name: '2 из 3', exact: true })).toBeVisible();
  await expect(state).toHaveAttribute('data-current', 'slide-2');
  await button(page, 'Свернуть').click();
  await expect(state).toHaveAttribute('data-state', 'stack');
  await button(page, 'Открыть').click();
  await expect(state).toHaveAttribute('data-current', 'added-1');
  expect((await new AxeBuilder({ page }).include('.cloudlet-host').analyze()).violations).toEqual([]);
  await page.goto('/?fixture=slider&count=7&dir=rtl');
  await expect(page.getByTestId('slider-state')).toHaveAttribute('data-state', 'island');
  await expect(page.locator('.cloudlet-host')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.cloudlet-host .cloudlet-page-value')).toHaveText('1 из 7');
});

for (const route of ['?surface', '?fixture=mobile', '?fixture=accessibility'] as const) {
  test(`QA fixture ${route} drives the stack → Island model through its public API`, async ({ page }) => {
    await installAudit(page);
    const response = await page.goto(`/${route}`);
    expect(response?.headers()['content-security-policy']).toContain("style-src-attr 'none'");
    const name = route === '?surface' ? 'surfaceFixture' : route === '?fixture=mobile' ? 'mobileFixture' : 'accessibilityFixture';
    await page.waitForFunction(api => Boolean((window as unknown as Record<string, unknown>)[api]), name);
    await page.evaluate(api => {
      const fixture = (window as unknown as Record<string, { reset: (records: unknown[]) => void }>)[api]!;
      fixture.reset([{ id: 'one', title: 'Первое' }, { id: 'two', title: 'Второе' }, { id: 'three', title: 'Третье' }]);
    }, name);
    const root = page.locator('.cloudlet-host');
    await expect(root.locator('.cloudlet-pill')).toHaveAccessibleName(/^Третье, уведомлений: 3/u);
    await expect.poll(() => page.evaluate(api => (window as unknown as Record<string, { open: () => boolean }>)[api]!.open(), name)).toBe(true);
    await expect(root).toHaveAttribute('data-state', 'island');
    const snapshot = await page.evaluate(api => (window as unknown as Record<string, { snapshot: () => { state: string; reason: string; current: string; stack: string[] } }>)[api]!.snapshot(), name);
    expect(snapshot).toMatchObject({ state: 'island', reason: 'user', current: 'three', stack: ['three', 'two', 'one'] });
    await page.evaluate(api => (window as unknown as Record<string, { collapse: () => boolean }>)[api]!.collapse(), name);
    await expect(root).toHaveAttribute('data-state', 'stack');
    expect((await new AxeBuilder({ page }).include('.cloudlet-host').analyze()).violations).toEqual([]);
  });
}

for (const fixture of ['no-reset', 'hostile', 'long-text', 'zoom', 'portal', 'inset'] as const) {
  test(`isolated ${fixture} fixture keeps the stack, Island keyboard and cleanup in its own CSS environment`, async ({ page }, info) => {
    await page.setViewportSize({ width: fixture === 'zoom' ? 640 : 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installAudit(page);
    const response = await page.goto(`/?fixture=${fixture}`);
    expect(response?.headers()['content-security-policy']).toContain("style-src-attr 'none'");
    await expect(page.getByTestId('environment-fixture')).toHaveAttribute('data-fixture', fixture);
    const root = page.locator('.cloudlet-host');
    const stackPill = root.locator('.cloudlet-pill');
    const region = page.getByRole('region', { name: 'Текущие уведомления', exact: true });
    const initial = fixture === 'long-text' ? 3 : 1;
    await expect(page.getByTestId('environment-count')).toContainText(`Принято: ${initial};`);
    await expect(stackPill).toHaveCount(1);
    if (fixture === 'no-reset') expect(await page.locator('body').evaluate(element => getComputedStyle(element).margin)).toBe('8px');
    if (fixture === 'hostile') {
      expect(await button(page, 'Добавить событие').evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('5px');
      expect(await stackPill.evaluate(element => getComputedStyle(element).borderTopWidth)).not.toBe('5px');
    }
    if (fixture === 'portal') await expect(page.locator('#environment-custom-portal > .cloudlet-host')).toHaveCount(1);
    if (fixture === 'zoom') expect(await page.locator('html').evaluate(element => getComputedStyle(element).fontSize)).toBe('32px');
    if (fixture === 'inset') {
      await expect.poll(async () => {
        const navigation = (await page.getByRole('navigation', { name: 'Образец нижней навигации' }).boundingBox())!;
        const box = (await root.locator('.cloudlet-stack > .cloudlet-shell').boundingBox())!;
        return box.y + box.height <= navigation.y;
      }).toBe(true);
    }
    await button(page, 'Добавить событие').click();
    await expect(page.getByTestId('environment-count')).toContainText(`Принято: ${initial + 1};`);
    if (fixture === 'long-text') {
      await page.getByRole('group', { name: 'Направление', exact: true }).getByRole('radio', { name: 'RTL', exact: true }).check();
      await button(page, 'Открыть Island').click();
      await region.getByRole('button', { name: '3 из 4', exact: true }).click();
      await expect(region.getByRole('heading', { name: 'تم حفظ التغييرات بنجاح', exact: true })).toBeVisible();
      await expect(root).toHaveAttribute('dir', 'rtl');
      await button(page, 'Свернуть').click();
    }
    // Keyboard: Enter on the pill opens the Island on its title, Escape returns to the pill.
    await stackPill.focus(); await page.keyboard.press('Enter');
    await expect(region.locator('[data-cloudlet-title]')).toBeFocused();
    if (fixture === 'hostile') expect(await region.locator('.cloudlet-close').evaluate(element => getComputedStyle(element).borderTopWidth)).not.toBe('5px');
    await page.keyboard.press('Escape');
    await expect(stackPill).toBeFocused();
    await button(page, 'Отключить Toaster').click();
    await expect(root).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => ({ observers: window.__labAudit.resizeTargets, frames: window.__labAudit.rafPending,
      viewportListeners: window.__labAudit.viewportListeners }))).toEqual({ observers: 0, frames: 0, viewportListeners: 0 });
    await expect(page.getByTestId('environment-count')).toContainText(`Принято: ${initial + 1};`);
    await button(page, 'Подключить Toaster').click();
    await expect(stackPill).toHaveCount(1);
    await stackPill.focus(); await page.keyboard.press('Enter');
    await region.locator('[data-cloudlet-control="close"]').focus(); await page.keyboard.press('Enter');
    await expect(page.getByTestId('environment-count')).toContainText(`Принято: ${initial};`);
    await button(page, 'Очистить уведомления').click();
    await expect(page.getByTestId('environment-count')).toContainText('Принято: 0;');
    await button(page, 'Сбросить fixture').click();
    await expect(page.getByTestId('environment-count')).toContainText(`Принято: ${initial};`);
    await expect(stackPill).toHaveCount(1);
    if (info.project.name !== 'webkit') {
      await expect.poll(() => root.locator('.cloudlet-stack > .cloudlet-shell').evaluate(element => Number(getComputedStyle(element).opacity))).toBe(1);
      await mkdir('artifacts/task16', { recursive: true });
      await info.attach(`fixture-${fixture}`, { body: await page.screenshot({ path: `artifacts/task16/${info.project.name}-fixture-${fixture}.png`, caret: 'initial' }), contentType: 'image/png' });
    }
  });
}
