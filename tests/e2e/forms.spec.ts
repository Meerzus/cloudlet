import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { MobileFixtureApi } from '../../apps/lab/src/mobile-fixture.js';
import { drag, finishAudit, idle, openRoute, screenshot } from './shell-audit.js';

// Form actions in the Island on the production laboratory (`?fixture=mobile` shows a form whose
// sends wait for the test to settle them).

declare global { interface Window { mobileFixture?: MobileFixtureApi } }

const host = (page: Page) => page.locator('.cloudlet-host');
const pill = (page: Page) => host(page).locator('.cloudlet-pill');
const field = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });
const send = (page: Page) => page.getByRole('button', { name: 'Send', exact: true });
const state = (page: Page) => page.evaluate(() => window.mobileFixture!.snapshot());
const record = async (page: Page, id: string) => (await state(page)).records.find(item => item.id === id);

async function open(page: Page, fields: 'reply' | 'note' = 'reply', size = { width: 1024, height: 768 }) {
  await page.setViewportSize(size);
  await openRoute(page, '/?fixture=mobile');
  await expect.poll(() => page.evaluate(() => Boolean(window.mobileFixture))).toBe(true);
  await page.evaluate(fields => window.mobileFixture!.form(fields), fields);
  await expect.poll(async () => (await state(page)).readable).toBe(true);
  await page.evaluate(() => window.mobileFixture!.open());
  await expect(host(page)).toHaveAttribute('data-state', 'island');
  await idle(page);
}

test.afterEach(async ({ page }, info) => finishAudit(page, info, 'forms-audit'));

test('a reply: required message, caret keys, a held Island, Escape with the draft kept, a failed and a successful send', async ({ page }, info) => {
  await open(page);
  const reply = field(page, 'Reply');
  await reply.focus();
  await page.keyboard.press('Enter');
  await expect(reply).toHaveAttribute('aria-invalid', 'true');
  await expect(reply).toHaveAccessibleDescription('This field is required');
  await expect(reply).toBeFocused();

  await page.keyboard.type('Yes, see you');
  await expect(reply).not.toHaveAttribute('aria-invalid');
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) await page.keyboard.press(key);
  expect((await state(page)).current).toBe('form');
  expect(await record(page, 'form')).toMatchObject({ draft: true });
  expect((await record(page, 'form'))!.pauses).toContain('draft');

  // An outside press leaves a draft in place; Escape collapses and keeps it.
  await page.mouse.click(10, 700);
  await expect(host(page)).toHaveAttribute('data-state', 'island');
  await reply.focus();
  await page.keyboard.press('Escape');
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  await expect(pill(page)).toHaveAccessibleName('Anna: are you coming?, notifications: 2, Draft');
  await pill(page).click();
  await expect(reply).toHaveValue('Yes, see you');

  await reply.focus();
  await page.keyboard.press('Enter');
  await expect(send(page)).toHaveAttribute('aria-busy', 'true');
  await expect(reply).toHaveAttribute('readonly', '');
  expect((await state(page)).sent).toEqual([{ reply: 'Yes, see you' }]);
  await screenshot(page, info, 'forms-pending');
  await page.evaluate(() => window.mobileFixture!.settleForm(false));
  await expect(send(page)).toHaveAccessibleDescription('Could not send');
  await expect(reply).toHaveValue('Yes, see you');
  await expect(reply).not.toHaveAttribute('readonly');
  await screenshot(page, info, 'forms-failed');

  const audit = await new AxeBuilder({ page }).include('.cloudlet-host').analyze();
  expect(audit.violations).toEqual([]);

  await send(page).click();
  await page.evaluate(() => window.mobileFixture!.settleForm(true));
  await expect.poll(async () => (await state(page)).closes).toContainEqual({ id: 'form', reason: 'action-success' });
});

test('a note: the textarea grows to six rows, Enter adds a line, Ctrl or ⌘ with Enter sends, validate speaks under the field', async ({ page }, info) => {
  await open(page, 'note');
  const note = field(page, 'Note');
  await note.focus();
  await page.keyboard.type('ok');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(note).toHaveAccessibleDescription('Write at least three characters');
  expect((await state(page)).sent).toEqual([]);

  // The first key clears the message, so both heights are taken without it.
  await page.keyboard.press('Enter');
  await idle(page);
  const shellHeight = async () => (await host(page).locator('.cloudlet-stack > .cloudlet-shell').boundingBox())!.height;
  const [noteBefore, shellBefore] = [(await note.boundingBox())!.height, await shellHeight()];
  for (let line = 0; line < 7; line += 1) await page.keyboard.press('Enter');
  await page.keyboard.type('the end');
  await expect.poll(() => note.evaluate(element => (element as HTMLTextAreaElement).rows)).toBe(6);
  await idle(page);
  expect((await note.boundingBox())!.height).toBeGreaterThan(noteBefore + 50);
  expect(await shellHeight()).toBeGreaterThan(shellBefore + 50);
  await screenshot(page, info, 'forms-note');

  await page.keyboard.press('ControlOrMeta+Enter');
  expect((await state(page)).sent).toEqual([{ name: '', note: `ok${'\n'.repeat(8)}the end` }]);
  await page.evaluate(() => window.mobileFixture!.settleForm(true));
  await expect.poll(async () => (await state(page)).closes).toContainEqual({ id: 'form', reason: 'action-success' });
});

test('a drag that starts in a field selects text instead of switching slides', async ({ page }) => {
  await open(page);
  const reply = field(page, 'Reply');
  await reply.fill('A reply long enough to select');
  await drag(page, reply, -120, 0, 8);
  await idle(page);
  expect((await state(page)).current).toBe('form');
  await expect(host(page)).toHaveAttribute('data-state', 'island');
});

test('on a phone at the bottom edge the form stays inside a shorter viewport, as with the on-screen keyboard', async ({ page }, info) => {
  await open(page, 'reply', { width: 390, height: 844 });
  await expect(host(page)).toHaveAttribute('data-edge', 'bottom');
  await field(page, 'Reply').focus();
  // The layout viewport loses the keyboard's height; the Island moves up with its bottom edge.
  await page.setViewportSize({ width: 390, height: 520 });
  await idle(page);
  const box = (await host(page).locator('.cloudlet-stack > .cloudlet-shell').boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(520);
  await expect(field(page, 'Reply')).toBeInViewport();
  await screenshot(page, info, 'forms-phone');
});
