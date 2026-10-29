import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { AttentionFixtureApi, SliderFixtureApi } from '../../apps/lab/src/scenario-fixtures.js';
import { drag, finishAudit, geometry, idle, openRoute, screenshot, translateX } from './shell-audit.js';

// Opening and collapsing, the slider, swipes, RTL, the fixed shell
// during a slide (`timeScale`) and deterministic auto-opening on the production laboratory.

declare global { interface Window { sliderFixture?: SliderFixtureApi; attentionFixture?: AttentionFixtureApi } }

const host = (page: Page) => page.locator('.cloudlet-host');
const shell = (page: Page) => host(page).locator('.cloudlet-stack > .cloudlet-shell');
const pill = (page: Page) => host(page).locator('.cloudlet-pill');
const island = (page: Page) => page.getByRole('region', { name: 'Current notifications', exact: true });
const title = (page: Page) => island(page).locator('[data-cloudlet-title]');
const close = (page: Page) => island(page).getByRole('button', { name: 'Close notification', exact: true });
const body = (page: Page) => island(page).locator('.cloudlet-clip > .cloudlet-slide > .cloudlet-body');
const pageText = (page: Page) => island(page).locator('.cloudlet-page > .cloudlet-page-value');
const peek = (page: Page) => host(page).locator('.cloudlet-peek');
const slide = (page: Page, name: string) => island(page).getByRole('group', { name, exact: true });
const sliderState = (page: Page) => page.evaluate(() => window.sliderFixture!.snapshot());

async function openSlider(page: Page, query = '') {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openRoute(page, `/?fixture=slider${query}`);
  await expect(page.getByTestId('slider-state')).toHaveAttribute('data-state', 'island');
  await expect.poll(async () => (await sliderState(page)).readable).toBe(true);
  await idle(page);
}

test.afterEach(async ({ page }, info) => finishAudit(page, info, 'slider-audit'));

test('the Island is a labelled carousel; Escape, Enter, Space and a press outside switch between stack and Island', async ({ page }, info) => {
  await openSlider(page);
  await expect(island(page)).toHaveAttribute('aria-roledescription', 'carousel');
  await expect(island(page)).toHaveAttribute('data-state', 'island');
  expect(await island(page).evaluate(element => document.getElementById(element.getAttribute('aria-describedby')!)?.textContent)).toBe('Escape to collapse');
  await expect(slide(page, '1 of 3')).toHaveAttribute('aria-roledescription', 'slide');
  await expect(slide(page, '1 of 3')).toHaveAttribute('data-current', 'true');
  await expect(slide(page, '1 of 3').getByRole('heading', { level: 2 })).toHaveText('New comment');
  const dots = island(page).locator('.cloudlet-dot-button');
  await expect(dots).toHaveCount(3);
  await expect(dots.nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(dots.nth(0)).toHaveAccessibleName('1 of 3');
  await expect(dots.nth(2)).toHaveAccessibleName('3 of 3');
  await expect(close(page)).toBeVisible();
  expect((await new AxeBuilder({ page }).include('.cloudlet-host').analyze()).violations).toEqual([]);
  await screenshot(page, info, 'slider-island');

  await title(page).focus();
  await page.keyboard.press('Escape');
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  await expect(host(page)).not.toHaveAttribute('data-island-reason', /./u);
  await expect(pill(page)).toBeFocused();
  await expect(pill(page)).toHaveAccessibleName('New comment, notifications: 3');
  await expect(pill(page)).toHaveAttribute('aria-expanded', 'false');
  expect(await pill(page).getAttribute('aria-controls')).toBe(await shell(page).getAttribute('id'));
  await expect(island(page)).toHaveCount(0);
  await idle(page);
  expect((await new AxeBuilder({ page }).include('.cloudlet-host').analyze()).violations).toEqual([]);
  await screenshot(page, info, 'slider-stack');

  // Keyboard opening focuses the title; Escape returns to the pill; Space opens too.
  await page.keyboard.press('Enter');
  await expect(host(page)).toHaveAttribute('data-island-reason', 'user');
  await expect(title(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pill(page)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(host(page)).toHaveAttribute('data-state', 'island');
  await expect(title(page)).toBeFocused();
  // A press outside the Island collapses it (the fixture controls are marked to keep it).
  await page.getByRole('heading', { level: 1 }).click();
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  await pill(page).click();
  await expect(host(page)).toHaveAttribute('data-island-reason', 'user');
  await expect(slide(page, '1 of 3')).toBeVisible();
  await idle(page);
});

test('arrows, Home/End and the dots move between slides; closing the current slide moves older, then newer, then leaves', async ({ page }) => {
  await openSlider(page);
  expect((await sliderState(page)).stack).toEqual(['slide-3', 'slide-2', 'slide-1']);
  await title(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(slide(page, '2 of 3')).toBeVisible();
  await expect(slide(page, '2 of 3').getByRole('heading', { level: 2 })).toHaveText('File uploaded');
  await expect(island(page).locator('.cloudlet-dot-button').nth(1)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(slide(page, '3 of 3')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(slide(page, '3 of 3')).toBeVisible();
  await page.keyboard.press('Home');
  await expect(slide(page, '1 of 3')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(slide(page, '1 of 3')).toBeVisible();
  await page.keyboard.press('End');
  await expect(slide(page, '3 of 3')).toBeVisible();
  await island(page).locator('.cloudlet-dot-button').nth(1).click();
  await expect(slide(page, '2 of 3')).toBeVisible();
  expect((await sliderState(page)).current).toBe('slide-2');
  // The title and the close button stay the same elements across slides.
  const closeHandle = await close(page).elementHandle();
  await close(page).focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await sliderState(page)).current).toBe('slide-1');
  await expect(slide(page, '2 of 2')).toBeVisible();
  await expect(close(page)).toBeFocused();
  expect(await close(page).evaluate((element, previous) => element === previous, closeHandle)).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await sliderState(page)).current).toBe('slide-3');
  await expect(island(page).locator('.cloudlet-indicator')).toHaveCount(0);
  await expect(slide(page, '1 of 1')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  await expect(shell(page)).toBeHidden();
  expect((await sliderState(page)).stack).toEqual([]);
  expect(await page.evaluate(() => document.activeElement?.closest('.cloudlet-host'))).toBeNull();
  await idle(page);
  await expect(host(page).locator('.cloudlet-exit > *')).toHaveCount(0);
});

test('a swipe shows the inert neighbour only during the gesture, resists at the ends, navigates past the threshold and never moves the shell', async ({ page }) => {
  await openSlider(page);
  const rest = await geometry(shell(page));
  await drag(page, body(page), -40, 0, 4, 60, false);
  await expect(host(page)).toHaveAttribute('data-dragging', 'x');
  await expect(peek(page)).toHaveCount(1);
  expect(await peek(page).evaluate(element => element.hasAttribute('inert') && element.getAttribute('aria-hidden') === 'true'
    && !element.querySelector('[id],[data-cloudlet-title],[data-cloudlet-control],a[href],[tabindex]:not([tabindex="-1"])'))).toBe(true);
  expect(await translateX(peek(page))).toBeGreaterThan(0);
  await expect.poll(() => translateX(body(page))).toBeLessThan(-20);
  let during = await geometry(shell(page));
  expect(during.x).toBeCloseTo(rest.x, 0);
  expect(during.width).toBeCloseTo(rest.width, 0);
  await page.mouse.up();
  await idle(page);
  await expect(peek(page)).toHaveCount(0);
  expect((await sliderState(page)).current).toBe('slide-3');
  expect(Math.abs(await translateX(body(page)))).toBeLessThan(0.5);

  await drag(page, body(page), -220, 0, 8, 15);
  await expect.poll(async () => (await sliderState(page)).current).toBe('slide-2');
  await expect(slide(page, '2 of 3')).toBeVisible();
  await idle(page);
  await expect(peek(page)).toHaveCount(0);
  during = await geometry(shell(page));
  expect(during.x).toBeCloseTo(rest.x, 0);
  expect(during.width).toBeCloseTo(rest.width, 0);

  // At the newest slide there is nothing to the left: the content resists and springs back.
  await title(page).focus();
  await page.keyboard.press('Home');
  await expect(slide(page, '1 of 3')).toBeVisible();
  await idle(page);
  await drag(page, body(page), 200, 0, 6, 30, false);
  await expect(host(page)).toHaveAttribute('data-dragging', 'x');
  await expect(peek(page)).toHaveCount(0);
  const resisted = await translateX(body(page));
  expect(resisted).toBeGreaterThan(20);
  expect(resisted).toBeLessThan(120);
  await page.mouse.up();
  await idle(page);
  expect((await sliderState(page)).current).toBe('slide-3');
  expect(Math.abs(await translateX(body(page)))).toBeLessThan(0.5);

  // A horizontal trackpad stream over the Island navigates like a swipe; the shell still stays.
  await body(page).hover();
  for (let step = 0; step < 4; step += 1) await page.mouse.wheel(60, 0);
  await expect.poll(async () => (await sliderState(page)).current).toBe('slide-2');
  await idle(page);
  during = await geometry(shell(page));
  expect(during.x).toBeCloseTo(rest.x, 0);
  expect(during.width).toBeCloseTo(rest.width, 0);
  expect(await page.evaluate(() => window.__shellAudit.maxLiveSlides)).toBe(1);
});

test('timeScale 0.1 keeps the shell still while the body slides and the heading blur-swaps; reduced motion crossfades in place', async ({ page }) => {
  await openSlider(page, '&timeScale=0.1');
  const rest = await geometry(shell(page));
  await title(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(slide(page, '2 of 3')).toBeVisible();
  const samples: { x: number; width: number; bodyX: number; slideOut: number; headingOut: number }[] = [];
  for (const wait of [100, 200, 300]) {
    await page.waitForTimeout(wait);
    samples.push({ ...(await geometry(shell(page))), bodyX: await translateX(body(page)),
      slideOut: await host(page).locator('.cloudlet-slide-out > *').count(), headingOut: await host(page).locator('.cloudlet-heading-out > *').count() });
  }
  for (const sample of samples) {
    expect(sample.x).toBeCloseTo(rest.x, 0);
    expect(sample.width).toBeCloseTo(rest.width, 0);
  }
  // Slowed ten times, the body is still travelling and both outgoing snapshots are present mid-slide.
  expect(samples.some(sample => Math.abs(sample.bodyX) > 2)).toBe(true);
  expect(samples.some(sample => sample.slideOut === 1 && sample.headingOut === 1)).toBe(true);
  await idle(page);
  const settled = await geometry(shell(page));
  expect(Math.abs(settled.svgWidth - settled.width)).toBeLessThan(1);
  await expect(host(page).locator('.cloudlet-slide-out > *, .cloudlet-heading-out > *')).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(host(page)).toHaveAttribute('data-reduced-motion', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(slide(page, '1 of 3')).toBeVisible();
  await expect(body(page)).toHaveCSS('transform', 'none');
  await expect.poll(() => island(page).locator('.cloudlet-header > .cloudlet-heading').evaluate(element => getComputedStyle(element).filter)).toBe('none');
  // Swipes are off under reduced motion.
  await drag(page, body(page), -200, 0, 6, 20);
  await expect(peek(page)).toHaveCount(0);
  expect((await sliderState(page)).current).toBe('slide-3');
  await idle(page);
});

test('RTL mirrors the badge corner, the icon, the close button, the arrow keys and the swipe sides', async ({ page }, info) => {
  await openSlider(page, '&count=7&dir=rtl');
  await expect(host(page)).toHaveAttribute('dir', 'rtl');
  await expect(pageText(page)).toHaveText('1 of 7');
  await expect(island(page).locator('.cloudlet-dot-button')).toHaveCount(0);
  const [titleBox, iconBox, closeBox] = await Promise.all([title(page).boundingBox(), island(page).locator('.cloudlet-icon').boundingBox(), close(page).boundingBox()]);
  expect(iconBox!.x).toBeGreaterThan(titleBox!.x + titleBox!.width - 1);
  expect(closeBox!.x + closeBox!.width).toBeLessThanOrEqual(titleBox!.x + 1);
  await title(page).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(pageText(page)).toHaveText('2 of 7');
  await page.keyboard.press('ArrowRight');
  await expect(pageText(page)).toHaveText('1 of 7');
  await idle(page);
  // Older records lie to the left in RTL: a swipe to the right shows the neighbour on the left and navigates to it.
  const start = await drag(page, body(page), 60, 0, 4, 60, false);
  await expect(peek(page)).toHaveCount(1);
  expect(await translateX(peek(page))).toBeLessThan(0);
  await page.mouse.move(start.x + 220, start.y, { steps: 6 });
  await page.mouse.up();
  // The newest of seven is slide-7; the older neighbour is slide-6.
  await expect.poll(async () => (await sliderState(page)).current).toBe('slide-6');
  await expect(pageText(page)).toHaveText('2 of 7');
  await idle(page);
  await screenshot(page, info, 'slider-rtl-island');
  await title(page).focus();
  await page.keyboard.press('Escape');
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  await idle(page);
  const [shellBox, badgeBox] = await Promise.all([shell(page).boundingBox(), shell(page).locator('.cloudlet-badge').boundingBox()]);
  expect(badgeBox!.x + badgeBox!.width / 2).toBeLessThan(shellBox!.x + shellBox!.width / 2);
  await expect(shell(page).locator('.cloudlet-badge > .cloudlet-badge-value')).toHaveText('7');
  expect((await new AxeBuilder({ page }).include('.cloudlet-host').analyze()).violations).toEqual([]);
  await screenshot(page, info, 'slider-rtl-stack');
});

test('attention: the auto-open waits for hover and focus, never takes focus, moves an open Island to the newest candidate and is cancelled by removal', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openRoute(page, '/?fixture=attention&delay=300');
  await expect(page.getByTestId('attention-delay')).toHaveText('300');
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const state = page.getByTestId('attention-state');
  const button = page.getByRole('button', { name: 'auto + description', exact: true });
  await button.focus();
  await page.keyboard.press('Enter');
  await page.clock.runFor(310);
  await expect(state).toHaveAttribute('data-state', 'island');
  await expect(state).toHaveAttribute('data-reason', 'attention');
  await expect(button).toBeFocused();
  await expect(title(page)).not.toBeFocused();

  // An open Island slides to the newest candidate and keeps its reason.
  await page.evaluate(() => window.attentionFixture!.show('auto-action'));
  await page.clock.runFor(310);
  await expect(state).toHaveAttribute('data-current', 'auto-action-2');
  await expect(state).toHaveAttribute('data-reason', 'attention');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(state).toHaveAttribute('data-state', 'stack');

  // Hover holds the candidate; the delay restarts after the pointer leaves.
  await page.evaluate(() => window.attentionFixture!.show('auto-description'));
  await expect(pill(page)).toBeVisible();
  await pill(page).hover();
  await page.clock.runFor(900);
  await expect(state).toHaveAttribute('data-state', 'stack');
  await page.mouse.move(2, 700);
  await page.mouse.move(4, 720);
  await page.clock.runFor(200);
  await expect(state).toHaveAttribute('data-state', 'stack');
  await page.clock.runFor(150);
  await expect(state).toHaveAttribute('data-state', 'island');
  await expect(state).toHaveAttribute('data-current', 'auto-description-3');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();

  // Keyboard focus on the pill holds the candidate too; blurring restarts the delay.
  await page.evaluate(() => window.attentionFixture!.show('auto-action'));
  await pill(page).focus();
  await page.clock.runFor(900);
  await expect(state).toHaveAttribute('data-state', 'stack');
  await page.getByRole('button', { name: 'Clear', exact: true }).focus();
  await page.clock.runFor(350);
  await expect(state).toHaveAttribute('data-state', 'island');
  await expect(state).toHaveAttribute('data-current', 'auto-action-4');
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeFocused();

  // Removing the candidate before the deadline cancels the auto-open.
  await page.keyboard.press('Enter');
  await expect(state).toHaveAttribute('data-state', 'stack');
  await page.evaluate(() => { window.attentionFixture!.show('auto-description'); window.attentionFixture!.clear(); });
  await page.clock.runFor(600);
  await expect(state).toHaveAttribute('data-state', 'stack');
  await page.clock.resume();
});

test('attention: a hover pause ends when the hovered card disappears under a still pointer and the pointer then leaves', async ({ page }) => {
  // Found on the landing's playground: no mouseout reaches the host when the card under the pointer goes away.
  await page.setViewportSize({ width: 1024, height: 768 });
  await openRoute(page, '/?fixture=attention&delay=300');
  // The fixture installs its API in an effect after the first render.
  await page.waitForFunction(() => window.attentionFixture !== undefined);
  const state = page.getByTestId('attention-state');
  await page.evaluate(() => window.attentionFixture!.show('auto-action'));
  await expect(state).toHaveAttribute('data-state', 'island');
  await idle(page);
  await island(page).getByRole('button', { name: 'Undo', exact: true }).hover();
  await page.evaluate(() => window.attentionFixture!.clear());
  await expect(state).toHaveAttribute('data-state', 'stack');
  await idle(page);
  await page.mouse.move(900, 700, { steps: 10 });
  await page.evaluate(() => window.attentionFixture!.show('auto-description'));
  await expect(state).toHaveAttribute('data-state', 'island');
  await expect(state).toHaveAttribute('data-current', 'auto-description-2');
});
