import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { AccessibilityFixtureApi } from '../../apps/lab/src/accessibility-fixture.js';
import { finishAudit, idle, nativeTab, openRoute, screenshot, speech } from './shell-audit.js';

// Accessibility on the production laboratory (`?fixture=accessibility`, bottom-center, autoDismiss off):
// roles and names, keyboard and focus hand-offs, native controls, live regions, axe, RTL, 320 px,
// 200 % text, forced colors and reduced motion. Live-DOM delivery does not prove speech; screen readers are checked by hand.

declare global { interface Window { accessibilityFixture?: AccessibilityFixtureApi } }

const host = (page: Page) => page.locator('.cloudlet-host');
const pill = (page: Page) => host(page).locator('.cloudlet-pill');
const island = (page: Page) => page.getByRole('region', { name: 'Current notifications', exact: true });
const title = (page: Page) => island(page).locator('[data-cloudlet-title]');
const live = (page: Page, urgency: 'polite' | 'assertive') => page.locator(`[data-cloudlet-announcer="${urgency}"]`);
const control = (page: Page, name: 'action' | 'retry' | 'cancel' | 'close') => island(page).locator(`.cloudlet-clip > .cloudlet-slide [data-cloudlet-control="${name}"], .cloudlet-clip > [data-cloudlet-control="${name}"]`);
const state = (page: Page) => page.evaluate(() => window.accessibilityFixture!.snapshot());
const origin = (page: Page) => page.locator('#accessibility-origin');

async function openFixture(page: Page) {
  await openRoute(page, '/?fixture=accessibility');
  await expect.poll(() => page.evaluate(() => Boolean(window.accessibilityFixture))).toBe(true);
  await expect(live(page, 'polite')).toHaveCount(1);
  await expect(live(page, 'assertive')).toHaveCount(1);
}
async function readable(page: Page) {
  await expect.poll(async () => (await state(page)).readable).toBe(true);
}

test.afterEach(async ({ page }, info) => finishAudit(page, info, 'accessibility-audit'));

test('keyboard: the region anchor, the pill, the Island title, Tab order, Escape and the last close hand focus back outside', async ({ page }, info) => {
  const tab = await nativeTab(page, info);
  await openFixture(page);
  await page.evaluate(() => window.accessibilityFixture!.reset([{ id: 'one', title: 'First' }, { id: 'two', title: 'Second', description: { kind: 'text', text: 'Description of the second' } }, { id: 'three', title: 'Third' }]));
  await readable(page);
  await origin(page).focus();
  await page.keyboard.press('Enter');
  await expect(host(page)).toBeFocused();
  await page.keyboard.press(tab);
  await expect(pill(page)).toBeFocused();
  await expect(pill(page)).toHaveAccessibleName('Third, notifications: 3');
  await page.keyboard.press('Enter');
  await expect(host(page)).toHaveAttribute('data-island-reason', 'user');
  await expect(title(page)).toBeFocused();
  await page.keyboard.press(tab);
  await expect(control(page, 'close')).toBeFocused();
  await page.keyboard.press(tab);
  await expect(island(page).locator('.cloudlet-dot-button').first()).toBeFocused();
  await page.keyboard.press(tab === 'Tab' ? 'Shift+Tab' : 'Alt+Shift+Tab');
  await expect(control(page, 'close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  await expect(pill(page)).toBeFocused();
  expect((await state(page)).ids).toEqual(['one', 'two', 'three']);

  // Closing the last slide from the keyboard returns focus to the element the user came from.
  await page.evaluate(() => window.accessibilityFixture!.reset([{ id: 'last', title: 'Last message' }]));
  await readable(page);
  await origin(page).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press(tab);
  await expect(pill(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(title(page)).toBeFocused();
  await page.keyboard.press(tab);
  await expect(control(page, 'close')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(origin(page)).toBeFocused();
  await expect(host(page).locator('.cloudlet-stack > .cloudlet-shell')).toBeHidden();
  expect((await state(page)).ids).toEqual([]);
});

test('command failure/retry and operation cancel/retry keep focus on surviving controls; a link navigates natively', async ({ page }) => {
  await openFixture(page);
  await origin(page).focus();
  await page.evaluate(() => window.accessibilityFixture!.command());
  // An action is an attention candidate: the Island opens by itself without taking focus.
  await expect(host(page)).toHaveAttribute('data-island-reason', 'attention');
  await expect(origin(page)).toBeFocused();
  const action = control(page, 'action');
  await expect(action).toHaveText('Save');
  await action.focus();
  await page.keyboard.press('Enter');
  await expect(action).toHaveAttribute('aria-disabled', 'true');
  await expect(action).toBeFocused();
  await page.keyboard.press('Space');
  expect((await state(page)).actionAttempts).toBe(1);
  await page.evaluate(() => window.accessibilityFixture!.settleAction(false));
  await expect(island(page)).toContainText('Could not save. Retry the action.');
  await expect(action).toHaveAttribute('aria-disabled', 'false');
  await expect(action).toBeFocused();
  expect(await action.getAttribute('aria-describedby')).not.toBeNull();
  await expect.poll(async () => (await speech(page)).some(entry => entry.text.includes('Action failed: Could not save. Retry the action.'))).toBe(true);
  await page.keyboard.press('Space');
  expect((await state(page)).actionAttempts).toBe(2);
  await page.evaluate(() => window.accessibilityFixture!.settleAction(true));
  await expect(origin(page)).toBeFocused();
  expect((await state(page)).ids).toEqual([]);

  await page.evaluate(() => window.accessibilityFixture!.operation());
  await readable(page);
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  expect(await page.evaluate(() => window.accessibilityFixture!.open())).toBe(true);
  await expect(island(page).getByRole('progressbar', { name: 'Upload progress', exact: true })).toHaveAttribute('aria-valuenow', '10');
  await control(page, 'cancel').focus();
  await page.keyboard.press('Enter');
  await expect(control(page, 'cancel')).toHaveCount(0);
  await expect(title(page)).toBeFocused();
  await page.evaluate(() => window.accessibilityFixture!.settleOperation(false));
  await expect.poll(async () => (await speech(page)).some(entry => entry.urgency === 'assertive' && entry.text.includes('Upload failed'))).toBe(true);
  await expect(control(page, 'retry')).toHaveText('Retry');
  await control(page, 'retry').focus();
  await page.keyboard.press('Enter');
  await expect(control(page, 'retry')).toHaveCount(0);
  await expect(title(page)).toBeFocused();
  expect((await state(page)).operationAttempts).toBe(2);
  await page.evaluate(() => window.accessibilityFixture!.settleOperation(true));
  await expect(title(page)).toHaveText('Document uploaded');
  await expect.poll(async () => (await speech(page)).some(entry => entry.text.includes('Document uploaded'))).toBe(true);

  await origin(page).focus();
  await page.evaluate(() => window.accessibilityFixture!.reset([{ id: 'link', title: 'Following a link', action: { kind: 'link', label: 'Open document', href: '#accessibility-destination' } }]));
  await readable(page);
  expect(await page.evaluate(() => window.accessibilityFixture!.open())).toBe(true);
  const link = island(page).getByRole('link', { name: 'Open document', exact: true });
  await expect(link).toHaveAttribute('href', '#accessibility-destination');
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#accessibility-destination$/u);
  await expect.poll(async () => (await state(page)).ids).toEqual([]);
  await expect(page.locator('#accessibility-destination')).toBeFocused();
});

test('live hosts coalesce a burst for 300 ms, announce the first presentation of each slide once and never repeat on resize, remount or rich reveal', async ({ page }) => {
  await openFixture(page);
  const politeIdentity = await live(page, 'polite').elementHandle();
  const started = await page.evaluate(() => {
    const started = performance.now();
    window.accessibilityFixture!.show({ id: 'A', title: 'Ordinary error', kind: 'error', announcementPriority: 'polite' });
    window.accessibilityFixture!.show({ id: 'B', title: 'Outdated title' });
    window.accessibilityFixture!.show({ id: 'C', title: 'Hidden context' });
    window.accessibilityFixture!.update('B', { title: 'Current title' });
    return started;
  });
  await readable(page);
  await expect.poll(async () => (await speech(page)).length).toBe(1);
  const first = (await speech(page))[0]!;
  expect(first.urgency).toBe('polite');
  expect(first.at - started).toBeGreaterThanOrEqual(280);
  // The newest record is the pill; the rest are one queued aggregate, never their titles.
  expect(first.text).toContain('Hidden context');
  expect(first.text).toContain('Queued: 2');
  expect(first.text).not.toContain('Outdated title');
  expect(first.text).not.toContain('Ordinary error');
  await expect(live(page, 'assertive')).toBeEmpty();

  expect(await page.evaluate(() => window.accessibilityFixture!.open())).toBe(true);
  await title(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(title(page)).toHaveText('Current title');
  await expect.poll(async () => (await speech(page)).some(entry => entry.text.includes('Current title'))).toBe(true);
  await page.keyboard.press('ArrowRight');
  await expect(title(page)).toHaveText('Ordinary error');
  await expect.poll(async () => (await speech(page)).some(entry => entry.text.includes('Ordinary error'))).toBe(true);
  const afterFirstPresentations = (await speech(page)).length;
  await page.keyboard.press('ArrowLeft');
  await expect(title(page)).toHaveText('Current title');
  // A slide shown again is spoken once more (the title node is shared, focus does not move); wait for it,
  // or the resize below races its 300 ms window.
  await expect.poll(async () => (await speech(page)).length).toBe(afterFirstPresentations + 1);
  expect((await speech(page)).at(-1)!.text).toContain('Current title');
  const afterRevisit = afterFirstPresentations + 1;
  await page.setViewportSize({ width: 480, height: 720 });
  await page.waitForTimeout(400);
  expect((await speech(page)).length).toBe(afterRevisit);
  expect(await live(page, 'polite').evaluate((element, previous) => element === previous, politeIdentity)).toBe(true);
  await page.evaluate(() => window.accessibilityFixture!.attach(false));
  await expect(live(page, 'polite')).toHaveCount(0);
  await page.evaluate(() => window.accessibilityFixture!.attach(true));
  await readable(page);
  await page.waitForTimeout(450);
  expect((await speech(page)).length).toBe(afterRevisit);

  await page.evaluate(() => window.accessibilityFixture!.reset([{ id: 'urgent', title: 'Explicitly urgent message', kind: 'info', announcementPriority: 'assertive' }]));
  await readable(page);
  await expect.poll(async () => (await speech(page)).some(entry => entry.urgency === 'assertive' && entry.text.includes('Explicitly urgent message'))).toBe(true);
  await page.evaluate(() => window.accessibilityFixture!.rich());
  // A rich description is an attention candidate: the Island opens and shows the visual slot.
  await expect(host(page)).toHaveAttribute('data-island-reason', 'attention');
  await expect(island(page)).toContainText('Visual context of the document');
  await expect.poll(async () => (await speech(page)).some(entry => entry.text.includes('The document is ready for review.'))).toBe(true);
  expect((await speech(page)).every(entry => !entry.text.includes('Visual context'))).toBe(true);
  await page.evaluate(() => window.accessibilityFixture!.reset([{ id: 'silent', title: 'Do not speak', announcementPriority: 'off' }]));
  await readable(page);
  await page.waitForTimeout(400);
  expect((await speech(page)).every(entry => !entry.text.includes('Do not speak'))).toBe(true);
  expect(await page.locator('.cloudlet-exit [aria-live], .cloudlet-slide-out [aria-live], .cloudlet-chrome-out [aria-live], .cloudlet-heading-out [aria-live], .cloudlet-body-out [aria-live]').count()).toBe(0);
});

test('operation progress is silent between its semantic start and terminal; auto-dismiss can be disabled', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => window.accessibilityFixture!.operation());
  await readable(page);
  await expect.poll(async () => (await speech(page)).length).toBe(1);
  expect(await page.evaluate(() => window.accessibilityFixture!.open())).toBe(true);
  const beforeProgress = (await speech(page)).length;
  for (const value of [0.2, 0.4, 0.6, 0.8]) {
    await page.evaluate(value => window.accessibilityFixture!.update('operation', { progress: { kind: 'determinate', value, label: 'Upload progress' } }), value);
    await expect(island(page).getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(value * 100));
  }
  await page.waitForTimeout(400);
  expect((await speech(page)).length).toBe(beforeProgress);
  await page.evaluate(() => window.accessibilityFixture!.settleOperation(true));
  await expect.poll(async () => (await speech(page)).length).toBe(beforeProgress + 1);
  expect((await speech(page)).filter(entry => entry.text.includes('Document uploaded'))).toHaveLength(1);
  await page.evaluate(() => window.accessibilityFixture!.reset([{ id: 'persistent-preference', title: 'User preference', duration: 80 }]));
  await readable(page);
  await page.mouse.move(1, 1);
  await page.waitForTimeout(500);
  expect((await state(page)).ids).toEqual(['persistent-preference']);
});

test('axe, RTL, long multilingual text at 320 px and 200 % text, 44 px hit areas, forced colors and reduced motion', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openFixture(page);
  await page.evaluate(() => {
    const fixture = window.accessibilityFixture!;
    fixture.dir('rtl');
    const sheet = [...document.styleSheets].find(sheet => sheet.href?.includes('/assets/'));
    if (!sheet) throw new Error('Expected external application stylesheet');
    sheet.insertRule(':root { font-size: 32px; }', sheet.cssRules.length);
    fixture.reset(Array.from({ length: 5 }, (_, index) => ({
      id: `long-${index}`, title: `${index}: A very long notification in English — رسالة عربية طويلة للتأكد من ظهور النص بالكامل 📄`,
      description: { kind: 'text', text: 'English context. وصف عربي طويل بدون فقدان المحتوى. '.repeat(12) + 'https://example.com/' + 'abcdefghijklmnopqrstuvwxyz'.repeat(12) },
      progress: { kind: 'determinate', value: 0.5, label: 'Record progress' },
      action: { kind: 'link', label: 'OpenTheDocumentWithoutSpacesفتحالمستندومراجعةالتفاصيل', href: '#accessibility-destination' },
    })));
  });
  await readable(page);
  await expect(host(page)).toHaveAttribute('dir', 'rtl');
  await idle(page);
  const stackGeometry = await page.evaluate(() => ({ pageWidth: document.documentElement.scrollWidth, viewport: innerWidth,
    pill: document.querySelector('.cloudlet-stack > .cloudlet-shell')!.getBoundingClientRect().width }));
  expect(stackGeometry.pageWidth).toBeLessThanOrEqual(stackGeometry.viewport);
  expect(stackGeometry.pill).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => window.accessibilityFixture!.open())).toBe(true);
  await idle(page);
  const geometry = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('.cloudlet-host')!;
    const body = host.querySelector<HTMLElement>('.cloudlet-clip > .cloudlet-slide > .cloudlet-body')!;
    const hits = [...host.querySelectorAll<HTMLElement>('[data-cloudlet-control],[data-cloudlet-overflow]')]
      .filter(element => element.getClientRects().length > 0 && !element.closest('[hidden],[inert],[aria-hidden="true"]')).map(element => {
        // A control deep in the scrolled body is reached by scrolling, like a finger would.
        element.scrollIntoView({ block: 'nearest' });
        const box = element.getBoundingClientRect();
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        // 44 px hit areas come from `::before`; measure them with hit testing, not the 32 px box.
        const hit = (x: number, y: number) => { const target = document.elementFromPoint(x, y); return !!target && (target === element || element.contains(target)); };
        return { name: element.getAttribute('aria-label') ?? element.textContent, x: box.x, right: box.right,
          hits: [hit(cx - 21, cy), hit(cx + 21, cy), hit(cx, cy - 21), hit(cx, cy + 21)] };
      });
    const bodyBox = body.getBoundingClientRect();
    // WebKit reports an RTL `scrollWidth` that includes words broken by `overflow-wrap`; the painted boxes are the proof.
    const outside = [...body.querySelectorAll<HTMLElement>('*')].filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && (box.left < bodyBox.left - 1 || box.right > bodyBox.right + 1); }).map(element => element.className);
    return { rootFont: getComputedStyle(document.documentElement).fontSize, viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
      hostWidth: host.getBoundingClientRect().width, outside,
      bodyScrolls: body.scrollHeight > body.clientHeight, titleLines: Math.round(host.querySelector('[data-cloudlet-title]')!.getBoundingClientRect().height / parseFloat(getComputedStyle(host.querySelector('[data-cloudlet-title]')!).lineHeight)), hits };
  });
  await info.attach('reflow-and-hit-geometry', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
  expect(geometry.rootFont).toBe('32px');
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.hostWidth).toBeLessThanOrEqual(320);
  expect(geometry.outside).toEqual([]);
  expect(geometry.bodyScrolls).toBe(true);
  expect(geometry.titleLines).toBeLessThanOrEqual(2);
  expect(geometry.hits.length).toBeGreaterThanOrEqual(2);
  for (const hit of geometry.hits) {
    expect(hit.hits, hit.name ?? '').toEqual([true, true, true, true]);
    expect(hit.x, hit.name ?? '').toBeGreaterThanOrEqual(0);
    expect(hit.right, hit.name ?? '').toBeLessThanOrEqual(320);
  }
  // The long body scrolls natively under the pointer; the page does not move while the body can scroll.
  const body = island(page).locator('.cloudlet-clip > .cloudlet-slide > .cloudlet-body');
  await body.hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('.cloudlet-host [tabindex]').evaluateAll(elements => elements.some(element => Number(element.getAttribute('tabindex')) > 0))).toBe(false);
  expect(await island(page).locator('button button,button a,a button,a a').count()).toBe(0);
  const ids = await page.locator('.cloudlet-host [id]').evaluateAll(elements => elements.map(element => element.id));
  expect(new Set(ids).size).toBe(ids.length);
  const audit = await new AxeBuilder({ page }).analyze();
  await info.attach('axe-result', { body: JSON.stringify(audit, null, 2), contentType: 'application/json' });
  expect(audit.violations).toEqual([]);
  await screenshot(page, info, 'accessibility-rtl-text200');

  for (const theme of ['light', 'dark', 'system'] as const) {
    await page.evaluate(theme => window.accessibilityFixture!.theme(theme), theme);
    await page.emulateMedia({ forcedColors: 'active' });
    await control(page, 'close').focus();
    const forced = await control(page, 'close').evaluate(element => ({ active: matchMedia('(forced-colors: active)').matches,
      outlineStyle: getComputedStyle(element).outlineStyle, outlineWidth: getComputedStyle(element).outlineWidth,
      background: getComputedStyle(element.closest('.cloudlet-host')!).getPropertyValue('--cloudlet-background').trim(),
      fill: getComputedStyle(element.closest('.cloudlet-host')!.querySelector('.cloudlet-progress-fill')!).stroke,
      track: getComputedStyle(element.closest('.cloudlet-host')!.querySelector('.cloudlet-ring-track')!).stroke }));
    expect(forced.active).toBe(true);
    expect(forced.outlineStyle).toBe('solid');
    expect(Number.parseFloat(forced.outlineWidth)).toBeGreaterThanOrEqual(2);
    expect(forced.background).toBe('Canvas');
    expect(forced.fill).not.toBe(forced.track);
  }
  await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' });
  await page.evaluate(() => window.accessibilityFixture!.reset([{ id: 'loading', title: 'Loading', kind: 'loading' }]));
  await readable(page);
  const spinner = host(page).locator('.cloudlet-clip > .cloudlet-slide .cloudlet-spinner');
  await expect.poll(() => spinner.evaluate(element => getComputedStyle(element).animationName)).toBe('cloudlet-spin');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(host(page)).toHaveAttribute('data-reduced-motion', 'true');
  await expect.poll(() => spinner.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  expect(await page.evaluate(() => window.accessibilityFixture!.open())).toBe(true);
  await expect(island(page)).toBeVisible();
  const transforms = await host(page).locator('.cloudlet-clip > .cloudlet-slide :is(h2, .cloudlet-body, .cloudlet-spinner)').evaluateAll(elements => elements.map(element => getComputedStyle(element).transform));
  expect(transforms.every(value => value === 'none' || value === 'matrix(1, 0, 0, 1, 0, 0)')).toBe(true);
});
