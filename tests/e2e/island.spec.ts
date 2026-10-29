import { mkdir } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { finishAudit, geometry, idle, openRoute, snapshotLayers as layers } from './shell-audit.js';

// Task 13 (kept in task 18): the shell, morph and slide of the stack → Island model on the production
// laboratory with `style-src-attr 'none'`: geometry continuity, snapshot bounds, idle frames,
// `timeScale` and reduced motion. The scenario specs of task 18 live beside it (tests/README.md).

const open = (page: Page, query = '/') => openRoute(page, query);

test.afterEach(async ({ page }, info) => finishAudit(page, info, 'island-audit'));

const host = (page: Page) => page.locator('.cloudlet-host[aria-label="Notifications"]');
const pill = (page: Page) => host(page).locator('[data-cloudlet-pill]');
const shell = (page: Page) => host(page).locator('.cloudlet-stack > .cloudlet-shell');
const island = (page: Page) => page.getByRole('region', { name: 'Current notifications' });

/** Keyboard focus inside the Island; WebKit does not focus buttons on click. */
async function focusTitle(page: Page) {
  await island(page).locator('[data-cloudlet-title]').focus();
}

test('3 notifications → open → navigate → close current → Escape → close the last', async ({ page }, info) => {
  await open(page);
  await page.getByRole('button', { name: '3 notifications', exact: true }).click();
  await expect(pill(page)).toHaveAccessibleName('New comment, notifications: 3');
  await expect(pill(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(host(page).locator('[data-cloudlet-tail]')).toHaveCount(2);
  await idle(page);
  expect((await new AxeBuilder({ page }).include('.cloudlet-host').analyze()).violations).toEqual([]);
  // Playwright screenshots inject an inline style in WebKit, which this CSP rightly blocks.
  const shoot = info.project.name === 'chromium';
  if (shoot) {
    await mkdir('artifacts/task18', { recursive: true });
    await page.screenshot({ path: `artifacts/task18/e2e-${info.project.name}-stack.png`, clip: { x: 300, y: 0, width: 680, height: 160 }, caret: 'initial' });
  }
  const titleNode = await host(page).locator('[data-cloudlet-title]').elementHandle();

  await pill(page).click();
  await expect(host(page)).toHaveAttribute('data-state', 'island');
  await expect(island(page)).toHaveAttribute('aria-roledescription', 'carousel');
  // The title and icon are the same DOM nodes in the pill and in the Island.
  expect(await titleNode!.evaluate(node => node.isConnected && node.closest('[role="region"]') !== null)).toBe(true);
  await expect(host(page).locator('[data-cloudlet-tail]')).toHaveCount(0);
  await idle(page);
  const opened = await geometry(shell(page));
  expect(Math.abs(opened.svgWidth - opened.width)).toBeLessThan(1);
  expect((await new AxeBuilder({ page }).include('.cloudlet-host').analyze()).violations).toEqual([]);
  if (shoot) await page.screenshot({ path: `artifacts/task18/e2e-${info.project.name}-island.png`, clip: { x: 300, y: 0, width: 680, height: 220 }, caret: 'initial' });

  await focusTitle(page);
  await page.keyboard.press('ArrowRight');
  await expect(island(page).getByRole('group', { name: '2 of 3' })).toHaveAttribute('aria-roledescription', 'slide');
  // The shell never moves or changes width while the content slides.
  const sliding = await geometry(shell(page));
  expect(sliding.x).toBe(opened.x);
  expect(sliding.width).toBe(opened.width);
  await expect(host(page).locator('.cloudlet-slide-out > *')).toHaveCount(1);
  await idle(page);
  await expect(host(page).locator('.cloudlet-slide-out > *')).toHaveCount(0);

  const close = island(page).getByRole('button', { name: 'Close notification' });
  await close.focus();
  await page.keyboard.press('Enter');
  await expect(island(page).getByRole('group', { name: '2 of 2' })).toBeVisible();
  await expect(island(page).getByRole('heading', { name: 'Draft saved' })).toBeVisible();
  // Close stays the same element during the slide: focus does not drop.
  await expect(close).toBeFocused();
  const closed = await geometry(shell(page));
  expect(closed.x).toBe(opened.x);
  expect(closed.width).toBe(opened.width);
  await idle(page);

  await page.keyboard.press('Escape');
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  await expect(pill(page)).toBeFocused();
  await expect(pill(page)).toHaveAccessibleName('New comment, notifications: 2');
  await idle(page);
  const collapsed = await geometry(shell(page));
  expect(Math.abs(collapsed.svgWidth - collapsed.width)).toBeLessThan(1);
  expect(collapsed.svgHeight).toBeCloseTo(44, 0);

  await page.keyboard.press('Enter');
  await expect(island(page).locator('[data-cloudlet-title]')).toBeFocused();
  for (const _ of [0, 1]) {
    await island(page).getByRole('button', { name: 'Close notification' }).focus();
    await page.keyboard.press('Enter');
  }
  await expect(shell(page)).toBeHidden();
  await expect(host(page).locator('.cloudlet-exit > *')).toHaveCount(1);
  await idle(page);
  await expect(host(page).locator('.cloudlet-exit > *')).toHaveCount(0);
  await expect(page.getByTestId('lab-summary')).toHaveAttribute('data-count', '0');
  // Idle: no frame is scheduled after the exit.
  const scheduled = await page.evaluate(() => window.__shellAudit.rafScheduled);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__shellAudit.rafScheduled)).toBe(scheduled);
});

test('rapid navigation during the morph keeps one snapshot per layer and settles on the measured shape', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '3 notifications', exact: true }).click();
  await idle(page);
  await pill(page).click();
  await focusTitle(page);
  for (const key of ['ArrowRight', 'ArrowRight', 'Home', 'End', 'ArrowLeft']) await page.keyboard.press(key);
  await expect(island(page).getByRole('group', { name: '2 of 3' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await idle(page);
  const settled = await geometry(shell(page));
  expect(Math.abs(settled.svgWidth - settled.width)).toBeLessThan(1);
  await expect(host(page).locator(layers.map(layer => `.${layer} > *`).join(','))).toHaveCount(0);
});

test('timeScale slows every transition and reduced motion changes the shape at once', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '3 notifications', exact: true }).click();
  await idle(page);
  await page.getByRole('radio', { name: '0.1', exact: true }).check();
  const before = await geometry(shell(page));
  await pill(page).click();
  await page.waitForTimeout(400);
  const slowed = await geometry(shell(page));
  // At 1× the open spring is visually done by ~400 ms; at 0.1× it has barely started.
  expect(slowed.svgWidth - before.svgWidth).toBeLessThan((slowed.width - before.svgWidth) * 0.5);
  await page.getByRole('radio', { name: '1', exact: true }).check();
  // Lab controls keep the Island open (task 16); a press on the page outside collapses it.
  await page.getByRole('heading', { level: 1 }).click();
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  await idle(page);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(host(page)).toHaveAttribute('data-reduced-motion', 'true');
  await pill(page).click();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const instant = await geometry(shell(page));
  expect(Math.abs(instant.svgWidth - instant.width)).toBeLessThan(1);
  await focusTitle(page);
  await page.keyboard.press('ArrowRight');
  await expect(host(page).locator('.cloudlet-clip > .cloudlet-slide')).toHaveCSS('transform', 'none');
  await idle(page);
});
