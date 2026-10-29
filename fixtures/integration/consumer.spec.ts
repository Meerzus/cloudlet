import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { IntegrationApi } from './shared/consumer';

// Installed-tarball consumers (Vite React 18.2/19, Next App/Pages) under strict production CSP:
// the stack → Island model of 1.0.0-rc.1 driven only through the public API and the rendered DOM.

type Audit = { violations: unknown[]; errors: string[]; rejections: string[]; resizeTargets: number; rafScheduled: number; rafPending: number; globalListeners: number; timeouts: number; intervals: number };
declare global { interface Window { integration?: IntegrationApi; __integrationAudit: Audit; } }
const auditCode = readFileSync('fixtures/integration/shared/audit.js', 'utf8');
const matrix = [ ['Vite React 18.2', 'http://127.0.0.1:4280/'], ['Vite React 19', 'http://127.0.0.1:4281/'], ['Next App Router', 'http://127.0.0.1:4282/'], ['Next Pages', 'http://127.0.0.1:4282/pages-smoke'] ];
const primary = (page: Page) => page.getByRole('region', { name: 'Primary notifications', exact: true });
const pill = (page: Page) => primary(page).locator('.cloudlet-pill');
const shell = (page: Page) => primary(page).locator('.cloudlet-stack > .cloudlet-shell');
const island = (page: Page) => primary(page).getByRole('region', { name: 'Current notifications', exact: true });
/** The presented record (pill or current slide) has acknowledged its readable presentation. */
const readable = async (page: Page) => expect.poll(() => page.evaluate(() => {
  const current = window.integration!.first.getSnapshot().notifications.find(item => item.location === 'current');
  return current ? !current.pauseReasons.includes('presentation-pending') : null;
})).toBe(true);
async function settle(target: Locator) {
  await expect.poll(async () => {
    const first = await target.boundingBox();
    await target.page().waitForTimeout(120);
    const second = await target.boundingBox();
    return !!first && !!second && Math.abs(first.width - second.width) < 0.05 && Math.abs(first.height - second.height) < 0.05;
  }).toBe(true);
}
const pathFill = (page: Page) => shell(page).locator('.cloudlet-bg path').evaluate(element => getComputedStyle(element).fill);

for (const [label, url] of matrix) test(`${label}: production tarball SSR, stack, Island, slide, swipe, action, ownership and CSP`, async ({ page, request, browser }, info) => {
  const consoleErrors: string[] = [], pageErrors: string[] = [];
  page.on('console', event => { if (event.type() === 'error') consoleErrors.push(event.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(auditCode);
  if (label.startsWith('Next')) {
    const raw = await request.get(url);
    const html = await raw.text();
    expect(raw.status()).toBe(200);
    expect(html).toContain('Tarball consumer SSR marker');
    expect(html).not.toContain('class="cloudlet-host"');
    expect(html).toContain('.css');
  }
  const response = await page.goto(url);
  expect(response!.headers()['content-security-policy']).toContain("style-src-attr 'none'");
  expect(response!.headers()['content-security-policy']).not.toContain('unsafe-inline');
  await expect.poll(() => page.evaluate(() => Boolean(window.integration))).toBe(true);
  await readable(page); await settle(shell(page));
  await expect(primary(page)).toHaveCount(1);
  await expect(page.locator('#consumer-portal > .cloudlet-host')).toHaveCount(1);
  await expect(pill(page)).toHaveAccessibleName('Pre-mount notification');
  await expect(page.getByRole('region', { name: 'Secondary notifications' }).locator('.cloudlet-pill')).toHaveAccessibleName('Independent notification');
  expect(await primary(page).evaluate(element => getComputedStyle(element).getPropertyValue('--cloudlet-background').trim())).toBe('#f2faf5');
  expect(await pathFill(page)).toBe('rgb(242, 250, 245)');
  expect(await primary(page).evaluate(element => getComputedStyle(element).color)).toBe('rgb(16, 37, 26)');
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle direction', exact: true }).click();
  await expect(primary(page)).toHaveAttribute('data-theme', 'dark');
  await expect(primary(page)).toHaveAttribute('dir', 'rtl');
  expect(await primary(page).evaluate(element => getComputedStyle(element).getPropertyValue('--cloudlet-background').trim())).toBe('#10251a');
  expect(await pathFill(page)).toBe('rgb(16, 37, 26)');
  expect(await primary(page).evaluate(element => getComputedStyle(element).color)).toBe('rgb(242, 250, 245)');

  // Pill → Island morph on the same shell; the current slide survives an arrival on top.
  const compact = (await shell(page).boundingBox())!;
  await pill(page).click();
  await expect(primary(page)).toHaveAttribute('data-island-reason', 'user');
  await expect(island(page).getByRole('heading', { name: 'Pre-mount notification', exact: true })).toBeVisible();
  await settle(shell(page));
  expect((await shell(page).boundingBox())!.height).toBeGreaterThan(compact.height);
  if (info.project.name === 'chromium') await info.attach('packed-island-theme', { body: await page.screenshot({ caret: 'initial' }), contentType: 'image/png' });
  await page.evaluate(() => { const api = window.integration!, handle = api.first.getHandle('pre-mount')!; api.first.update(handle, { progress: { kind: 'determinate', value: 0.76, label: 'Transfer' } }); api.show({ id: 'queued', title: 'Queued notification', duration: null, attention: 'stack' }); });
  await expect(island(page).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '76');
  await expect.poll(() => island(page).locator('.cloudlet-progress-fill').getAttribute('stroke-dasharray')).toBe('76 100');
  await expect(island(page).getByRole('group', { name: '2 of 2', exact: true })).toBeVisible();
  await expect(island(page).locator('.cloudlet-dot-button')).toHaveCount(2);
  // RTL: ArrowRight moves to the newer slide (physically right), the heading blur-swaps in place.
  await island(page).locator('[data-cloudlet-title]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(island(page).getByRole('heading', { name: 'Queued notification', exact: true })).toBeVisible();
  await readable(page); await settle(shell(page));
  await page.keyboard.press('Escape');
  await expect(primary(page)).toHaveAttribute('data-state', 'stack');
  await expect(pill(page)).toHaveAccessibleName('Queued notification, 2 notifications');
  await settle(shell(page));

  // A sideways swipe on the pill dismisses the top record with real pointer capture.
  const box = (await pill(page).boundingBox())!;
  const start = box.x + box.width / 2;
  await page.mouse.move(start, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(start + 24, box.y + box.height / 2, { steps: 2 });
  await expect(primary(page)).toHaveAttribute('data-dragging', 'x');
  await page.mouse.move(start + 210, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => Boolean(window.integration!.first.getHandle('queued')))).toBe(false);
  await readable(page);
  await expect(pill(page)).toHaveAccessibleName('Pre-mount notification');

  // An action is an attention candidate: the Island opens by itself; success closes the record.
  await page.evaluate(() => window.integration!.first.clear());
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await expect(primary(page)).toHaveAttribute('data-island-reason', 'attention');
  await island(page).getByRole('button', { name: 'Run command', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.integration!.actionCount())).toBe(1);
  await expect.poll(() => page.evaluate(() => window.integration!.first.getSnapshot().notifications.length)).toBe(0);
  expect(await page.evaluate(() => window.integration!.second.getSnapshot().notifications.length)).toBe(1);

  // Detach keeps the records; remount presents the arrival; depth shows as tails and badge.
  await page.getByRole('button', { name: 'Toggle mount', exact: true }).click();
  await expect(page.locator('.cloudlet-host')).toHaveCount(0);
  await page.evaluate(() => window.integration!.show({ id: 'detached', title: 'Detached arrival', duration: null, attention: 'stack' }));
  await page.getByRole('button', { name: 'Toggle mount', exact: true }).click();
  await readable(page);
  await expect(pill(page)).toHaveAccessibleName('Detached arrival');
  await page.evaluate(() => { for (let index = 0; index < 3; index++) window.integration!.show({ id: `stack-${index}`, title: `Stack ${index}`, duration: null, attention: 'stack' }); });
  await expect(pill(page)).toHaveAccessibleName('Stack 2, 4 notifications');
  await expect(primary(page).locator('.cloudlet-tail')).toHaveCount(2);
  await expect(shell(page).locator('.cloudlet-badge > .cloudlet-badge-value')).toHaveText('4');
  expect(await page.evaluate(() => window.integration!.first.getSnapshot().stack.map(handle => handle.id))).toEqual(['stack-2', 'stack-1', 'stack-0', 'detached']);
  expect(await primary(page).locator('style').evaluateAll(styles => styles.length > 0 && styles.every(style => (style as HTMLStyleElement).nonce.length > 0))).toBe(true);
  await expect(page.locator('.cloudlet-host [style]')).toHaveCount(0);
  const audit = await page.evaluate(() => window.__integrationAudit);
  await info.attach('tarball-runtime-audit', { body: JSON.stringify({ url, browser: info.project.name, browserVersion: browser.version(), reactVersion: await page.evaluate(() => window.integration!.reactVersion), audit, consoleErrors, pageErrors }), contentType: 'application/json' });
  expect(audit.violations).toEqual([]); expect(audit.errors).toEqual([]); expect(audit.rejections).toEqual([]);
  expect(consoleErrors).toEqual([]); expect(pageErrors).toEqual([]);
});

test('React19 tarball: 100 Toaster detach/remount cycles, idle RAF and timed100 arrivals +30 progress/s', async ({ page, browser }, info) => {
  await page.addInitScript(auditCode);
  await page.goto('http://127.0.0.1:4281/');
  await expect.poll(() => page.evaluate(() => Boolean(window.integration))).toBe(true);
  await readable(page);
  let listenerBaseline: number | undefined;
  for (let index = 0; index < 100; index++) {
    await page.evaluate(() => window.integration!.setMounted(false));
    await expect(page.locator('.cloudlet-host')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__integrationAudit.resizeTargets)).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__integrationAudit.timeouts)).toBe(0);
    expect(await page.evaluate(() => window.__integrationAudit.intervals)).toBe(0);
    const listeners = await page.evaluate(() => window.__integrationAudit.globalListeners);
    if (listenerBaseline === undefined) listenerBaseline = listeners;
    expect(listeners).toBe(listenerBaseline);
    await page.evaluate(() => window.integration!.setMounted(true));
    await expect(page.locator('.cloudlet-host')).toHaveCount(2);
  }
  await page.evaluate(() => { window.integration!.first.clear(); window.integration!.second.clear(); });
  await expect.poll(() => page.evaluate(() => window.__integrationAudit.rafPending)).toBe(0);
  const idleBefore = await page.evaluate(() => window.__integrationAudit.rafScheduled);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__integrationAudit.rafScheduled)).toBe(idleBefore);
  const load = await page.evaluate(async () => {
    const api = window.integration!;
    const handle = api.show({ id: 'progress-load', title: 'Load progress', duration: null, attention: 'stack', progress: { kind: 'determinate', value: 0 } });
    let progress = 0, arrivals = 0;
    const started = performance.now();
    await new Promise<void>(resolve => {
      const timer = setInterval(() => {
        api.first.update(handle, { progress: { kind: 'determinate', value: ++progress / 30 } });
        const target = Math.floor(progress * 99 / 30);
        while (arrivals < target) api.show({ id: `load-${arrivals++}`, title: `Event ${arrivals}`, duration: null, attention: 'stack' });
        if (progress === 30) { clearInterval(timer); resolve(); }
      }, 1000 / 30);
    });
    return { elapsedMs: performance.now() - started, progress, notifications: api.first.getSnapshot().notifications.length, arrivals: arrivals + 1 };
  });
  expect(load.arrivals).toBe(100); expect(load.progress).toBe(30); expect(load.notifications).toBe(100); expect(load.elapsedMs).toBeGreaterThanOrEqual(900);
  await readable(page);
  await expect(pill(page)).toHaveAccessibleName('Event 99, 100 notifications');
  expect(await page.evaluate(() => { const item = window.integration!.first.getSnapshot().notifications.find(item => item.handle.id === 'progress-load')!; return item.content.progress?.kind === 'determinate' ? item.content.progress.value : null; })).toBe(1);
  await page.evaluate(() => { window.integration!.first.dispose(); window.integration!.second.dispose(); window.integration!.setMounted(false); });
  await expect(page.locator('.cloudlet-host')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__integrationAudit.resizeTargets)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__integrationAudit.rafPending)).toBe(0);
  expect(await page.evaluate(() => [window.integration!.first.getSnapshot().disposed, window.integration!.second.getSnapshot().disposed])).toEqual([true, true]);
  const audit = await page.evaluate(() => window.__integrationAudit);
  await info.attach('tarball-stress-audit', { body: JSON.stringify({ browser: info.project.name, browserVersion: browser.version(), load, cycles: 100, idleBefore, listenerBaseline, audit }), contentType: 'application/json' });
  expect(audit.violations).toEqual([]); expect(audit.errors).toEqual([]); expect(audit.rejections).toEqual([]);
});

// Real development React replay is separate from production CSP/SSR assertions above.
for (const [react, url] of [['React19', 'http://127.0.0.1:4283/'], ['React18.2', 'http://127.0.0.1:4284/']]) test(`installed ${react} tarball survives actual development StrictMode effect replay`, async ({ page, browser }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => window.integration?.strictEffects())).toEqual({ setups: 2, cleanups: 1 });
  await readable(page);
  await expect(pill(page)).toHaveAccessibleName('Pre-mount notification');
  await expect(page.locator('.cloudlet-host')).toHaveCount(2);
  await page.getByRole('button', { name: 'Toggle mount', exact: true }).click();
  await expect(page.locator('.cloudlet-host')).toHaveCount(0);
  expect(await page.evaluate(() => window.integration!.first.getSnapshot().disposed)).toBe(false);
  await page.getByRole('button', { name: 'Toggle mount', exact: true }).click();
  await readable(page);
  await expect(page.locator('.cloudlet-host')).toHaveCount(2);
  const evidence = await page.evaluate(() => ({ effects: window.integration!.strictEffects(), react: window.integration!.reactVersion, notifications: window.integration!.first.getSnapshot().notifications.length }));
  expect(evidence.notifications).toBe(1);
  expect(errors).toEqual([]);
  await info.attach('tarball-strict-mode-audit', { body: JSON.stringify({ ...evidence, browser: info.project.name, browserVersion: browser.version(), errors }), contentType: 'application/json' });
  await page.evaluate(() => { window.integration!.first.dispose(); window.integration!.second.dispose(); });
});
