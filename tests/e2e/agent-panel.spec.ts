import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The laboratory's “Agent” panel: the live snapshot of `@cloudlet/agent` over both controllers.

type Entry = { ref: string; component: string; actions: string[]; [key: string]: unknown };
type ToasterEntry = Entry & { island: { open: boolean; current: string | null }; count: number; overflow: { count: number; pending: boolean }; mounted: boolean };
type FieldEntry = {
  name: string;
  label: string;
  kind: string;
  required: boolean;
  maxLength: number | null;
  inputMode: string | null;
  filled: boolean;
  filledBy: 'app' | 'user' | 'agent' | null;
  error: string | null;
};
type NotificationEntry = Entry & { label: string; action: { kind: string; fields?: FieldEntry[] } | null; draft: boolean };

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const host = (page: Page) => page.locator('.lab-main-host');
const summary = (page: Page) => page.getByTestId('agent-summary');

async function entries(page: Page): Promise<Entry[]> {
  return JSON.parse(await page.getByTestId('agent-snapshot').textContent() ?? '[]') as Entry[];
}
async function toaster(page: Page, name = 'toaster') {
  return (await entries(page)).find(entry => entry.component === 'toaster' && entry.ref === name) as ToasterEntry | undefined;
}
async function notifications(page: Page) {
  return (await entries(page)).filter((entry): entry is NotificationEntry => entry.component === 'notification');
}

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('One Island');
});
test.afterEach(() => { expect(errors).toEqual([]); });

test('the panel shows the toaster entry right after load', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Agent snapshot, JSON' })).toBeVisible();
  await expect.poll(() => toaster(page)).toMatchObject({ ref: 'toaster', count: 0, island: { open: false, current: null }, mounted: true });
  await expect.poll(() => toaster(page, 'secondary')).toMatchObject({ ref: 'secondary', count: 0 });
  await expect(summary(page)).toHaveAttribute('data-entries', '2');
  await expect(summary(page)).toContainText('Island closed');
});

test('a shown notification appears with its title', async ({ page }) => {
  await button(page, 'Show notification').click();
  await expect.poll(async () => (await notifications(page)).map(entry => [entry.ref, entry.label])).toEqual([['toaster:1', 'Changes saved']]);
  await expect.poll(() => toaster(page).then(entry => entry?.count)).toBe(1);
  await expect(summary(page)).toHaveAttribute('data-entries', '3');
});

test('opening the Island shows in the toaster entry, with its current notification', async ({ page }) => {
  await button(page, '3 notifications').click();
  await button(page, 'Open Island').click();
  await expect(host(page)).toHaveAttribute('data-state', 'island');
  await expect(summary(page)).toHaveAttribute('data-island', 'true');
  const current = (await notifications(page)).find(entry => entry.label === 'New comment');
  await expect.poll(() => toaster(page).then(entry => entry?.island)).toEqual({ open: true, current: current?.ref });
  await expect(summary(page)).toContainText(`Island open · ${current?.ref}`);
  // The panel's own clicks do not collapse the Island.
  await page.getByTestId('agent-snapshot').click();
  await expect(host(page)).toHaveAttribute('data-state', 'island');
  await button(page, 'Collapse').click();
  await expect(summary(page)).toHaveAttribute('data-island', 'false');
});

test('overflow shows the number not accepted', async ({ page }) => {
  await button(page, 'Overflow · 101').click();
  await expect(summary(page)).toHaveAttribute('data-overflow', '1');
  await expect.poll(() => toaster(page)).toMatchObject({ count: 100, overflow: { count: 1, pending: true } });
  expect((await toaster(page))?.actions).toContain('acknowledge');
  await button(page, 'Acknowledge missed').click();
  await expect.poll(() => toaster(page).then(entry => entry?.overflow.pending)).toBe(false);
});

test('a notification of the second controller has a ref starting with secondary:', async ({ page }) => {
  await button(page, 'Show in second').click();
  await expect.poll(async () => (await notifications(page)).map(entry => [entry.ref, entry.label])).toEqual([['secondary:1', 'Second controller']]);
  await expect.poll(() => toaster(page, 'secondary').then(entry => entry?.count)).toBe(1);
});

test('a form notification shows its fields and whether they are filled, never the typed text', async ({ page }) => {
  const attention = page.getByRole('group', { name: 'attention', exact: true });
  await attention.getByRole('radio', { name: 'open', exact: true }).check();
  await button(page, 'With form').click();
  await expect(host(page)).toHaveAttribute('data-state', 'island');
  const form = async () => (await notifications(page)).find(entry => entry.action?.kind === 'form');
  await expect.poll(async () => (await form())?.action?.fields).toEqual([{ name: 'reply', label: 'Reply', kind: 'text', required: true, maxLength: 120, inputMode: null, filled: false, filledBy: null, error: null }]);
  const typed = 'Secret reply 7f3a';
  await page.getByRole('textbox', { name: 'Reply', exact: true }).fill(typed);
  await expect.poll(async () => (await form())?.action?.fields?.[0]?.filled).toBe(true);
  expect((await form())?.action?.fields?.[0]?.filledBy).toBe('user');
  expect((await form())?.draft).toBe(true);
  await expect(page.getByTestId('agent-snapshot')).not.toContainText(typed);
});

test('Recreate main, Reset second and Full reset reconnect without errors and show the new state', async ({ page }) => {
  await button(page, 'Show notification').click();
  await button(page, 'Show in second').click();
  await expect(summary(page)).toHaveAttribute('data-entries', '4');
  await button(page, 'Recreate main').click();
  await expect.poll(async () => (await entries(page)).map(entry => entry.ref)).toEqual(['toaster', 'secondary', 'secondary:1']);
  await button(page, 'Reset second').click();
  await expect.poll(async () => (await entries(page)).map(entry => entry.ref)).toEqual(['toaster', 'secondary']);
  await button(page, 'Show notification').click();
  await button(page, 'Show in second').click();
  await expect(summary(page)).toHaveAttribute('data-entries', '4');
  await button(page, 'Full reset').click();
  await expect.poll(async () => (await entries(page)).map(entry => entry.ref)).toEqual(['toaster', 'secondary']);
  await button(page, 'Dispose main').click();
  await expect.poll(async () => (await entries(page)).map(entry => entry.ref)).toEqual(['secondary']);
  await button(page, 'Unmount laboratory').click();
  await button(page, 'Mount laboratory').click();
  await expect.poll(async () => (await entries(page)).map(entry => entry.ref)).toEqual(['toaster', 'secondary']);
});
