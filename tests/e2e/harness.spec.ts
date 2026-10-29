import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { finishAudit, openRoute, screenshot } from './shell-audit.js';

// Production entry smoke under strict CSP: the laboratory loads, the main user path
// (show → auto-open → clear) works through the public API, and the document passes axe.

test.afterEach(async ({ page }, info) => finishAudit(page, info, 'harness-audit'));

test('production laboratory loads without browser errors, runs the main path and has an accessible document', async ({ page }, info) => {
  await openRoute(page, '/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Three independent operations');
  await expect(page.getByTestId('lab-notifications').locator('[data-notification-id]')).toHaveCount(0);
  await expect(page.getByTestId('lab-summary')).toHaveAttribute('data-state', 'stack');
  await screenshot(page, info, 'lab-desktop-initial');
  await page.getByRole('button', { name: 'Show notification', exact: true }).click();
  await expect(page.getByTestId('lab-notifications').locator('[data-notification-id]')).toHaveCount(1);
  const host = page.locator('.lab-main-host');
  await expect(host.locator('.cloudlet-pill')).toHaveAccessibleName('Changes saved');
  // A description makes the record an attention candidate: the Island opens by itself after 600 ms.
  await expect(host).toHaveAttribute('data-island-reason', 'attention');
  await expect(host.getByRole('region', { name: 'Current notifications', exact: true }).getByRole('heading', { name: 'Changes saved', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByTestId('lab-notifications').locator('[data-notification-id]')).toHaveCount(0);
  await expect(host.locator('.cloudlet-stack > .cloudlet-shell')).toBeHidden();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
