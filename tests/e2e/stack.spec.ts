import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { MobileFixtureApi } from '../../apps/lab/src/mobile-fixture.js';
import { drag, finishAudit, geometry, idle, openRoute, screenshot, translateX, translateY } from './shell-audit.js';

// DESIGN §2, §6, §10: the collapsed stack on the production laboratory (`?fixture=mobile`
// exposes the public snapshot with pauses, remaining time and close reasons).

declare global { interface Window { mobileFixture?: MobileFixtureApi } }

const host = (page: Page) => page.locator('.cloudlet-host');
const shell = (page: Page) => host(page).locator('.cloudlet-stack > .cloudlet-shell');
const pill = (page: Page) => host(page).locator('.cloudlet-pill');
const tails = (page: Page) => host(page).locator('.cloudlet-tail');
const badge = (page: Page) => shell(page).locator('.cloudlet-badge');
const island = (page: Page) => page.getByRole('region', { name: 'Текущие уведомления', exact: true });
const state = (page: Page) => page.evaluate(() => window.mobileFixture!.snapshot());
const record = async (page: Page, id: string) => (await state(page)).records.find(item => item.id === id)!;

async function open(page: Page, records?: { id: string; title: string; duration?: number | null; kind?: 'success' | 'info' | 'error' | 'warning' | 'loading'; description?: { kind: 'text'; text: string } }[]) {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openRoute(page, '/?fixture=mobile');
  await expect.poll(() => page.evaluate(() => Boolean(window.mobileFixture))).toBe(true);
  if (records) await page.evaluate(records => window.mobileFixture!.reset(records), records);
  await readable(page);
}
async function readable(page: Page) {
  await expect.poll(async () => (await state(page)).readable).toBe(true);
}

test.afterEach(async ({ page }, info) => finishAudit(page, info, 'stack-audit'));

test('first pill grows in; tails and badge follow the depth; an arrival keeps the same shell', async ({ page }, info) => {
  await open(page, [{ id: 'one', title: 'Первое' }]);
  await idle(page);
  const shellHandle = await shell(page).elementHandle();
  await expect(pill(page)).toHaveAccessibleName('Первое');
  await expect(pill(page)).toHaveAttribute('aria-expanded', 'false');
  expect(await pill(page).getAttribute('aria-controls')).toBe(await shell(page).getAttribute('id'));
  await expect(tails(page)).toHaveCount(0);
  expect(await badge(page).evaluate(element => getComputedStyle(element).opacity)).toBe('0');
  let box = await geometry(shell(page));
  expect(box.svgHeight).toBeCloseTo(44, 0);
  expect(Math.abs(box.svgWidth - box.width)).toBeLessThan(1);
  expect(await shell(page).evaluate(element => getComputedStyle(element).opacity)).toBe('1');

  const exitsBefore = (await page.evaluate(() => window.__shellAudit.maxSnapshots))['cloudlet-exit'] ?? 0;
  await page.evaluate(() => window.mobileFixture!.show({ id: 'two', title: 'Второе уведомление' }));
  // The arrival blur-swaps the title inside the same shell: no exit snapshot, one heading snapshot at most.
  await expect(host(page).locator('.cloudlet-exit > *')).toHaveCount(0);
  await expect(pill(page)).toHaveAccessibleName('Второе уведомление, уведомлений: 2');
  await expect(tails(page)).toHaveCount(1);
  await expect(badge(page).locator('> .cloudlet-badge-value')).toHaveText('2');
  await expect.poll(() => badge(page).evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  expect(await shell(page).evaluate((element, previous) => element === previous, shellHandle)).toBe(true);
  expect((await page.evaluate(() => window.__shellAudit.maxSnapshots))['cloudlet-exit'] ?? 0).toBe(exitsBefore);
  await idle(page);
  box = await geometry(shell(page));
  expect(Math.abs(box.svgWidth - box.width)).toBeLessThan(1);

  await page.evaluate(() => { window.mobileFixture!.show({ id: 'three', title: 'Третье' }); window.mobileFixture!.show({ id: 'four', title: 'Четвёртое' }); });
  await expect(tails(page)).toHaveCount(2);
  await expect(badge(page).locator('> .cloudlet-badge-value')).toHaveText('4');
  await expect(pill(page)).toHaveAccessibleName('Четвёртое, уведомлений: 4');
  await idle(page);
  // Tails peek out below the pill at the top edge, 4 px per step, as wide as the pill.
  const pillBox = (await shell(page).boundingBox())!;
  const tailBoxes = await tails(page).evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { bottom: box.bottom, width: box.width, y: new DOMMatrix(getComputedStyle(element).transform).f };
  }));
  expect(tailBoxes[0]!.y).toBeCloseTo(4, 0);
  expect(tailBoxes[1]!.y).toBeCloseTo(8, 0);
  for (const tail of tailBoxes) expect(tail.bottom).toBeGreaterThan(pillBox.y + pillBox.height - 1);
  await screenshot(page, info, 'stack-four');

  // Hover lifts the tails by 2 px per step and pauses the top record (DESIGN §2).
  await pill(page).hover();
  await expect.poll(async () => (await record(page, 'four')).pauses).toContain('hover');
  await expect.poll(() => translateY(tails(page).last())).toBeCloseTo(12, 0);
  await page.mouse.move(2, 400);
  await expect.poll(async () => (await record(page, 'four')).pauses).not.toContain('hover');
  await idle(page);
});

test('a sideways swipe follows the finger, springs back below the threshold and dismisses the top record past it', async ({ page }, info) => {
  await open(page);
  await idle(page);
  const before = await state(page);
  expect(before.stack).toEqual(['C', 'B', 'A']);
  const tailBefore = await translateX(tails(page).first());
  // Below 30 % of the pill width and slower than the flick velocity: the pill springs back.
  await drag(page, pill(page), 24, 0, 4, 80, false);
  await expect(host(page)).toHaveAttribute('data-dragging', 'x');
  await expect.poll(() => translateX(shell(page))).toBeGreaterThan(8);
  // The tails do not follow the finger (hover may still lift them vertically).
  expect(await translateX(tails(page).first())).toBe(tailBefore);
  expect((await record(page, 'C')).pauses).toContain('gesture');
  await page.mouse.up();
  await expect(host(page)).not.toHaveAttribute('data-dragging', /./u);
  await idle(page);
  expect(Math.abs(await translateX(shell(page)))).toBeLessThan(0.5);
  expect((await state(page)).closes).toEqual([]);
  // The click that follows a drag is suppressed: the Island stays closed.
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  expect((await record(page, 'C')).pauses).not.toContain('gesture');

  await drag(page, pill(page), 220, 0, 8, 15);
  await expect.poll(async () => (await state(page)).closes).toEqual([{ id: 'C', reason: 'swipe' }]);
  await expect.poll(async () => (await state(page)).stack).toEqual(['B', 'A']);
  await expect(pill(page)).toHaveAccessibleName('Mobile B, уведомлений: 2');
  await expect(tails(page)).toHaveCount(1);
  await idle(page);
  await expect(host(page).locator('.cloudlet-exit > *')).toHaveCount(0);
  expect((await page.evaluate(() => window.__shellAudit.maxSnapshots))['cloudlet-exit']).toBe(1);
  await screenshot(page, info, 'stack-after-swipe');

  // A vertical drag over the pill belongs to the page.
  await drag(page, pill(page), 0, 80, 4, 10);
  expect((await state(page)).closes).toHaveLength(1);
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  expect((await record(page, 'B')).pauses).not.toContain('gesture');
});

test('only the top record spends time; a user-opened slide and an action slide pause; a description-only auto-open keeps counting (DESIGN §6)', async ({ page }, info) => {
  // `remainingMs` is fixed at each snapshot publication; the proof is which record actually expires.
  await open(page, [{ id: 'a', title: 'A', duration: 900 }, { id: 'b', title: 'B', duration: 1500 }]);
  await page.mouse.move(2, 600);
  expect((await record(page, 'a')).pauses).toContain('inactive');
  expect((await record(page, 'b')).pauses).not.toContain('inactive');
  // B (top) expires first although A is shorter; A starts counting only once it is the top pill.
  await expect.poll(async () => (await state(page)).closes, { timeout: 4000 }).toEqual([{ id: 'b', reason: 'timeout' }]);
  expect((await state(page)).stack).toEqual(['a']);
  await expect.poll(async () => (await state(page)).closes, { timeout: 4000 }).toEqual([{ id: 'b', reason: 'timeout' }, { id: 'a', reason: 'timeout' }]);

  await page.evaluate(() => window.mobileFixture!.reset([{ id: 'c', title: 'C', duration: 1200 }]));
  await readable(page);
  await pill(page).hover();
  await expect.poll(async () => (await record(page, 'c')).pauses).toContain('hover');
  await page.waitForTimeout(1500);
  expect((await state(page)).stack).toEqual(['c']);
  await page.evaluate(() => window.mobileFixture!.open());
  await expect(host(page)).toHaveAttribute('data-island-reason', 'user');
  await page.mouse.move(2, 600);
  await expect.poll(async () => (await record(page, 'c')).pauses).toContain('island');
  if (info.project.name === 'webkit') {
    // WebKit keeps the stale hover after the hovered pill left the DOM under the pointer until the
    // pointer enters and leaves the host again (handoff 18, open remark); a user's pointer does that.
    await island(page).locator('[data-cloudlet-title]').hover();
    await page.mouse.move(2, 600);
  }
  await expect.poll(async () => (await record(page, 'c')).pauses).not.toContain('hover');
  await page.waitForTimeout(1500);
  expect((await state(page)).stack).toEqual(['c']);
  await page.evaluate(() => window.mobileFixture!.collapse());
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  await expect.poll(async () => (await record(page, 'c')).pauses).not.toContain('island');
  await expect.poll(async () => (await state(page)).stack, { timeout: 4000 }).toEqual([]);

  await page.evaluate(() => window.mobileFixture!.reset([{ id: 'older', title: 'Older' }]));
  await readable(page);
  await page.evaluate(() => window.mobileFixture!.show({ id: 'd', title: 'D', duration: 1500, attention: 'auto', description: { kind: 'text', text: 'Описание открывает Island само' } }));
  await expect(host(page)).toHaveAttribute('data-island-reason', 'attention');
  await expect.poll(async () => (await state(page)).current).toBe('d');
  expect((await record(page, 'd')).pauses).not.toContain('island');
  // The slide expires and the Island moves on to the next older record.
  await expect.poll(async () => (await state(page)).closes, { timeout: 5000 }).toEqual([{ id: 'd', reason: 'timeout' }]);
  await expect.poll(async () => (await state(page)).current).toBe('older');
  await expect(host(page)).toHaveAttribute('data-state', 'island');

  await page.evaluate(() => window.mobileFixture!.show({ id: 'e', title: 'E', duration: 1200, attention: 'auto', action: { kind: 'command', label: 'Готово', run: () => undefined } }));
  await expect.poll(async () => (await state(page)).current).toBe('e');
  await expect.poll(async () => (await record(page, 'e')).pauses).toContain('island');
  await page.waitForTimeout(1600);
  expect((await state(page)).stack).toEqual(['e', 'older']);
});

test('missed notifications join the badge and the pill name; the Island indicator line acknowledges them', async ({ page }, info) => {
  await open(page, Array.from({ length: 101 }, (_, index) => ({ id: `m-${index + 1}`, title: `Mobile ${index + 1}` })));
  await expect.poll(async () => (await state(page)).missed).toBe(1);
  expect((await state(page)).stack).toHaveLength(100);
  await expect(pill(page)).toHaveAccessibleName('Mobile 100, уведомлений: 100, пропущено: 1');
  await expect(badge(page).locator('> .cloudlet-badge-value')).toHaveText('101');
  await page.evaluate(() => window.mobileFixture!.open());
  const overflow = island(page).locator('.cloudlet-overflow');
  await expect(overflow).toContainText('Пропущено: 1');
  await expect(island(page).locator('.cloudlet-page-value')).toHaveText('1 из 100');
  await expect(island(page).getByRole('group', { name: '1 из 100', exact: true })).toBeVisible();
  await idle(page);
  await screenshot(page, info, 'island-overflow');
  expect((await new AxeBuilder({ page }).include('.cloudlet-host').analyze()).violations).toEqual([]);
  // Keyboard activation: WebKit does not focus buttons on click, and the focus hand-off is the point.
  await overflow.getByRole('button', { name: 'Подтвердить пропущенные', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(overflow).toHaveCount(0);
  await expect.poll(async () => (await state(page)).missed).toBe(0);
  await expect(island(page).locator('[data-cloudlet-title]')).toBeFocused();
  await page.evaluate(() => window.mobileFixture!.collapse());
  await expect(badge(page).locator('> .cloudlet-badge-value')).toHaveText('100');
  await expect(pill(page)).toHaveAccessibleName('Mobile 100, уведомлений: 100');
});
