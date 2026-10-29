import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { SurfaceFixtureApi } from '../../apps/lab/src/surface-fixture.js';
import { finishAudit, geometry, idle, openRoute, screenshot } from './shell-audit.js';

// The measured shell on `?surface` under a narrow viewport without a CSS
// reset, long text, font/container changes, loading → terminal updates, themes and resource release.

declare global { interface Window { surfaceFixture?: SurfaceFixtureApi } }

const host = (page: Page) => page.locator('.cloudlet-host');
const shell = (page: Page) => host(page).locator('.cloudlet-stack > .cloudlet-shell');
const island = (page: Page) => page.getByRole('region', { name: 'Current notifications', exact: true });
const title = (page: Page) => shell(page).locator('.cloudlet-clip > .cloudlet-slide [data-cloudlet-title]');
const body = (page: Page) => island(page).locator('.cloudlet-clip > .cloudlet-slide > .cloudlet-body');
const state = (page: Page) => page.evaluate(() => window.surfaceFixture!.snapshot());

async function openFixture(page: Page) {
  await openRoute(page, '/?surface');
  await expect.poll(() => page.evaluate(() => Boolean(window.surfaceFixture))).toBe(true);
  await readable(page);
}
async function readable(page: Page) {
  await expect.poll(async () => (await state(page)).readable).toBe(true);
}
async function expectUnscaledText(page: Page) {
  const scales = await title(page).evaluate(element => {
    const result: number[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) {
      const transform = getComputedStyle(current).transform;
      if (transform !== 'none') { const matrix = new DOMMatrix(transform); result.push(matrix.a, matrix.d); }
    }
    return result;
  });
  expect(scales.every(value => Math.abs(value - 1) < 0.0001)).toBe(true);
}

test.afterEach(async ({ page }, info) => finishAudit(page, info, 'surface-audit'));

test('320 px without a CSS reset: the long title and URL stay inside the viewport, the Island body scrolls and text is never scaled', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openFixture(page);
  expect(await page.locator('body').evaluate(element => getComputedStyle(element).margin)).toBe('8px');
  await page.getByRole('button', { name: 'Long text', exact: true }).click();
  await readable(page);
  await idle(page);
  const pill = await geometry(shell(page));
  expect(pill.svgHeight).toBeCloseTo(44, 0);
  expect(pill.x).toBeGreaterThanOrEqual(0);
  expect(pill.x + pill.width).toBeLessThanOrEqual(320.5);
  expect(await title(page).evaluate(element => ({ overflow: getComputedStyle(element).textOverflow, wrap: getComputedStyle(element).whiteSpace, clipped: element.scrollWidth > element.clientWidth })))
    .toEqual({ overflow: 'ellipsis', wrap: 'nowrap', clipped: true });
  expect(await page.evaluate(() => window.surfaceFixture!.open())).toBe(true);
  await expect(island(page)).toBeVisible();
  await idle(page);
  await expectUnscaledText(page);
  const opened = await geometry(shell(page));
  expect(opened.x).toBeGreaterThanOrEqual(0);
  expect(opened.x + opened.width).toBeLessThanOrEqual(320.5);
  expect(opened.height).toBeGreaterThan(pill.height);
  expect(opened.y + opened.height).toBeLessThanOrEqual(640.5);
  expect(Math.abs(opened.svgWidth - opened.width)).toBeLessThan(1);
  expect(await title(page).evaluate(element => getComputedStyle(element).whiteSpace)).toBe('normal');
  expect(await body(page).evaluate(element => element.scrollHeight > element.clientHeight && element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  // The scrolling body is a tab stop named by the title; End scrolls it instead of switching slides.
  await expect(body(page)).toHaveAttribute('tabindex', '0');
  await expect(body(page)).toHaveAttribute('role', 'group');
  await expect(body(page)).toHaveAccessibleName(await title(page).innerText());
  await body(page).focus();
  await page.keyboard.press('End');
  await expect.poll(() => body(page).evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(island(page)).toBeVisible();
  await expect(body(page)).toBeFocused();
  await screenshot(page, info, 'surface-320-island');
  await page.getByRole('button', { name: 'Font size', exact: true }).dispatchEvent('click');
  await page.getByRole('button', { name: 'Container size', exact: true }).dispatchEvent('click');
  await expect.poll(() => host(page).evaluate(element => getComputedStyle(element).fontSize)).toBe('20px');
  await idle(page);
  const resized = await geometry(shell(page));
  expect(resized.width).toBeLessThanOrEqual(248.5);
  expect(Math.abs(resized.svgWidth - resized.width)).toBeLessThan(1);
  await expectUnscaledText(page);
  expect(await host(page).locator('[style]').count()).toBe(0);
});

test('loading → success keeps the shell node, blur-swaps the heading and crossfades the body once; progress updates coalesce into one ring value', async ({ page }, info) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'Loading', exact: true }).dispatchEvent('click');
  await readable(page);
  const shellHandle = await shell(page).elementHandle();
  await expect(shell(page)).toHaveAttribute('data-kind', 'loading');
  await expect(shell(page).locator('.cloudlet-clip > .cloudlet-slide .cloudlet-ring[data-progress="indeterminate"]')).toHaveCount(1);
  await page.evaluate(() => {
    for (let index = 0; index <= 100; index += 1) window.surfaceFixture!.update('operation', { progress: { kind: 'determinate', value: index / 100 } });
  });
  expect(await page.evaluate(() => window.surfaceFixture!.open())).toBe(true);
  await expect(island(page).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  await idle(page);
  await expect.poll(() => island(page).locator('.cloudlet-progress-fill').getAttribute('stroke-dasharray')).toBe('100 100');
  await page.evaluate(() => window.surfaceFixture!.complete('success'));
  await expect(title(page)).toHaveText('Document ready');
  await expect(shell(page)).toHaveAttribute('data-kind', 'success');
  expect(await shell(page).evaluate((element, previous) => element === previous, shellHandle)).toBe(true);
  await idle(page);
  await expect(host(page).locator('.cloudlet-heading-out > *, .cloudlet-body-out > *, .cloudlet-exit > *')).toHaveCount(0);
  const snapshots = await page.evaluate(() => window.__shellAudit.maxSnapshots);
  expect(snapshots['cloudlet-heading-out']).toBe(1);
  expect(snapshots['cloudlet-body-out']).toBe(1);
  await screenshot(page, info, 'surface-terminal');

  await page.getByRole('button', { name: 'Loading', exact: true }).dispatchEvent('click');
  await readable(page);
  await page.evaluate(() => window.surfaceFixture!.complete('error'));
  await expect(shell(page)).toHaveAttribute('data-kind', 'error');
  await expect(title(page)).toHaveText('Upload error');
  expect(await shell(page).evaluate((element, previous) => element === previous, shellHandle)).toBe(true);
});

test('reduced motion mount, idle and unmount/dispose release observers and frames', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFixture(page);
  await expect(host(page)).toHaveAttribute('data-reduced-motion', 'true');
  await idle(page);
  const idleFrames = await page.evaluate(() => window.__shellAudit.rafScheduled);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__shellAudit.rafScheduled)).toBe(idleFrames);
  await page.getByRole('button', { name: 'Font size', exact: true }).dispatchEvent('click');
  await page.getByRole('button', { name: 'Unmount', exact: true }).dispatchEvent('click');
  await expect(host(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({ observers: window.__shellAudit.resizeTargets, frames: window.__shellAudit.rafPending }))).toEqual({ observers: 0, frames: 0 });
  expect((await state(page)).ids).toEqual(['A']);
  await page.getByRole('button', { name: 'Mount', exact: true }).dispatchEvent('click');
  await readable(page);
  await page.getByRole('button', { name: 'Dispose', exact: true }).dispatchEvent('click');
  await expect(host(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({ observers: window.__shellAudit.resizeTargets, frames: window.__shellAudit.rafPending }))).toEqual({ observers: 0, frames: 0 });
  expect(await page.evaluate(() => JSON.parse(document.querySelector('[data-testid="fixture-state"]')!.textContent!).disposed)).toBe(true);
});

test('dark theme follows the tokens on the shell path; a dismissed pill leaves through one exit snapshot and the host goes idle', async ({ page }, info) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'Surface theme', exact: true }).dispatchEvent('click');
  await expect(host(page)).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => window.surfaceFixture!.reset([{ id: 'dark', title: 'Changes saved', kind: 'success',
    description: { kind: 'text', text: 'Every document is synced. You can keep working on another device.' } }]));
  await readable(page);
  await idle(page);
  expect(await shell(page).locator('.cloudlet-bg path').evaluate(element => getComputedStyle(element).fill)).toBe('rgb(28, 28, 30)');
  expect(await shell(page).evaluate(element => getComputedStyle(element).color)).toBe('rgb(245, 245, 247)');
  await screenshot(page, info, 'surface-dark-pill');
  expect(await page.evaluate(() => window.surfaceFixture!.open())).toBe(true);
  await expect(island(page)).toBeVisible();
  await idle(page);
  await expectUnscaledText(page);
  await screenshot(page, info, 'surface-dark-island');
  await page.evaluate(() => window.surfaceFixture!.dismiss('dark'));
  await expect(host(page).locator('.cloudlet-exit > *')).toHaveCount(1);
  await expect(shell(page)).toBeHidden();
  await idle(page);
  await expect(host(page).locator('.cloudlet-exit > *')).toHaveCount(0);
  expect((await state(page)).ids).toEqual([]);
  const frames = await page.evaluate(() => window.__shellAudit.rafScheduled);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__shellAudit.rafScheduled)).toBe(frames);
});
