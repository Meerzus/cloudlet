import { devices, expect, test } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import type { MobileFixtureApi } from '../../apps/lab/src/mobile-fixture.js';
import { drag, finishAudit, geometry, idle, installShellAudit, screenshot, translateY } from './shell-audit.js';

// DESIGN §2, §3, §7, §9 and the viewport contract (API_CONTRACT §18, §22) on `?fixture=mobile`:
// bottom edge, auto placement, safe area + obstruction + VisualViewport, keyboard-sized viewports,
// gestures with release physics, portals, reduced motion and device emulation. Device presets and
// the VisualViewport mock are emulation, not physical devices.

interface ViewportValues { width: number; height: number; offsetLeft: number; offsetTop: number; scale: number }
declare global {
  interface Window {
    mobileFixture?: MobileFixtureApi;
    __mobileViewport: { set: (values: Partial<ViewportValues>, event?: 'resize' | 'scroll') => void; listeners: () => number };
  }
}

const host = (page: Page) => page.locator('.cloudlet-host');
const shell = (page: Page) => host(page).locator('.cloudlet-stack > .cloudlet-shell');
const pill = (page: Page) => host(page).locator('.cloudlet-pill');
const island = (page: Page) => page.getByRole('region', { name: 'Текущие уведомления', exact: true });
const header = (page: Page) => island(page).locator('.cloudlet-clip > .cloudlet-slide > .cloudlet-header');
const body = (page: Page) => island(page).locator('.cloudlet-clip > .cloudlet-slide > .cloudlet-body');
const state = (page: Page) => page.evaluate(() => window.mobileFixture!.snapshot());
const record = async (page: Page, id: string) => (await state(page)).records.find(item => item.id === id)!;

async function openFixture(page: Page, size = { width: 390, height: 844 }) {
  await page.setViewportSize(size);
  await page.addInitScript(() => {
    // This controllable EventTarget tests coordinate math and listener cleanup.
    // It does not claim to reproduce a physical keyboard, toolbar or pinch.
    const values: Partial<ViewportValues> = {};
    const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
    class FixtureViewport extends EventTarget {
      get width() { return values.width ?? innerWidth; }
      get height() { return values.height ?? innerHeight; }
      get offsetLeft() { return values.offsetLeft ?? 0; }
      get offsetTop() { return values.offsetTop ?? 0; }
      get pageLeft() { return scrollX + this.offsetLeft; }
      get pageTop() { return scrollY + this.offsetTop; }
      get scale() { return values.scale ?? 1; }
      override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
        if (callback) { const set = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>(); set.add(callback); listeners.set(type, set); }
        super.addEventListener(type, callback, options);
      }
      override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
        if (callback) listeners.get(type)?.delete(callback);
        super.removeEventListener(type, callback, options);
      }
    }
    const viewport = new FixtureViewport();
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    window.__mobileViewport = {
      set: (next, event = 'resize') => { Object.assign(values, next); viewport.dispatchEvent(new Event(event)); },
      listeners: () => [...listeners.values()].reduce((sum, item) => sum + item.size, 0),
    };
  });
  await installShellAudit(page);
  const response = await page.goto('/?fixture=mobile');
  expect(response?.headers()['content-security-policy']).toContain("style-src-attr 'none'");
  await expect.poll(() => page.evaluate(() => Boolean(window.mobileFixture))).toBe(true);
  await readable(page);
}
async function readable(page: Page) {
  await expect.poll(async () => (await state(page)).readable).toBe(true);
}
async function settle(locator: Locator) {
  await expect.poll(async () => {
    const before = await locator.boundingBox();
    await locator.page().waitForTimeout(100);
    const after = await locator.boundingBox();
    return Boolean(before && after && Math.abs(before.x - after.x) < 0.1 && Math.abs(before.y - after.y) < 0.1
      && Math.abs(before.width - after.width) < 0.1 && Math.abs(before.height - after.height) < 0.1);
  }).toBe(true);
}
async function installSafeArea(page: Page, top: number, right: number, bottom: number, left: number) {
  await page.evaluate(insets => {
    const style = document.createElement('style');
    style.nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')!.content;
    style.textContent = `.cloudlet-host { --cloudlet-safe-top:${insets.top}px; --cloudlet-safe-right:${insets.right}px; --cloudlet-safe-bottom:${insets.bottom}px; --cloudlet-safe-left:${insets.left}px; }`;
    document.head.append(style);
    window.dispatchEvent(new Event('resize'));
  }, { top, right, bottom, left });
}
/** Every visible control of the Island lies inside `bounds` (controls deep in a scrolled body are scrolled to first). */
async function expectControlsInside(page: Page, bounds: { left: number; top: number; right: number; bottom: number }) {
  const boxes = await island(page).locator('[data-cloudlet-control], .cloudlet-dot-button').evaluateAll(elements => elements.map(element => {
    element.scrollIntoView({ block: 'nearest' });
    const box = element.getBoundingClientRect();
    return { name: element.getAttribute('aria-label') ?? element.textContent, x: box.x, y: box.y, right: box.right, bottom: box.bottom };
  }));
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.x, box.name ?? '').toBeGreaterThanOrEqual(bounds.left - 1);
    expect(box.y, box.name ?? '').toBeGreaterThanOrEqual(bounds.top - 1);
    expect(box.right, box.name ?? '').toBeLessThanOrEqual(bounds.right + 1);
    expect(box.bottom, box.name ?? '').toBeLessThanOrEqual(bounds.bottom + 1);
  }
}
async function attachEnvironment(page: Page, info: TestInfo) {
  await info.attach('mobile-environment', { body: JSON.stringify(await page.evaluate(() => ({ userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight }, devicePixelRatio, touchPoints: navigator.maxTouchPoints })), null, 2), contentType: 'application/json' });
}

test.afterEach(async ({ page }, info) => finishAudit(page, info, 'mobile-audit'));

test('auto placement crosses 48rem while both explicit positions keep the pill focus and the records', async ({ page }, info) => {
  await openFixture(page, { width: 1024, height: 768 });
  await expect(host(page)).toHaveAttribute('data-edge', 'top');
  await pill(page).focus();
  await settle(host(page));
  expect((await host(page).boundingBox())!.y).toBeCloseTo(16, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(host(page)).toHaveAttribute('data-edge', 'bottom');
  await settle(host(page));
  let box = (await host(page).boundingBox())!;
  expect(box.y + box.height).toBeCloseTo(828, 0);
  await expect(pill(page)).toBeFocused();
  expect((await state(page)).current).toBe('C');
  await page.evaluate(() => window.mobileFixture!.position('top-center'));
  await expect(host(page)).toHaveAttribute('data-edge', 'top');
  await settle(host(page));
  expect((await host(page).boundingBox())!.y).toBeCloseTo(16, 0);
  await screenshot(page, info, 'mobile-explicit-top');
  await page.evaluate(() => window.mobileFixture!.position('bottom-center'));
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(host(page)).toHaveAttribute('data-edge', 'bottom');
  await settle(host(page));
  box = (await host(page).boundingBox())!;
  expect(box.y + box.height).toBeCloseTo(752, 0);
  await expect(pill(page)).toBeFocused();
  expect((await state(page)).closes).toEqual([]);
  await attachEnvironment(page, info);
});

test('four safe edges and extra obstruction compose once inside a resized and panned VisualViewport; pinch never scales text', async ({ page }, info) => {
  await openFixture(page);
  await installSafeArea(page, 7, 11, 13, 17);
  await page.evaluate(() => {
    window.mobileFixture!.offsets({ gutter: { top: 5, right: 5, bottom: 5, left: 5 }, obstruction: { top: 19, right: 23, bottom: 29, left: 31 } });
    window.__mobileViewport.set({ width: 350, height: 340, offsetLeft: 20, offsetTop: 40 });
  });
  await settle(host(page));
  const box = (await host(page).boundingBox())!;
  // Visual rect (20,40)-(370,380), then safe + gap + extra navigation obstruction on each edge.
  expect(box.x).toBeCloseTo(73, 0);
  expect(box.x + box.width).toBeCloseTo(331, 0);
  expect(box.y + box.height).toBeCloseTo(333, 0);
  await page.evaluate(() => window.mobileFixture!.open());
  await expect(island(page)).toBeVisible();
  await idle(page);
  await expectControlsInside(page, { left: 73, top: 71, right: 331, bottom: 333 });
  await page.evaluate(() => window.__mobileViewport.set({ offsetTop: 80 }, 'scroll'));
  await settle(host(page));
  const panned = (await host(page).boundingBox())!;
  expect(panned.y + panned.height).toBeCloseTo(373, 0);
  await screenshot(page, info, 'mobile-safe-viewport-navigation');
  await page.evaluate(() => window.__mobileViewport.set({ width: 195, height: 422, offsetLeft: 50, offsetTop: 100, scale: 2 }));
  await settle(host(page));
  const scales = await island(page).locator('[data-cloudlet-title]').evaluate(element => {
    const result: number[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) {
      const transform = getComputedStyle(current).transform;
      if (transform !== 'none') { const matrix = new DOMMatrix(transform); result.push(matrix.a, matrix.d); }
    }
    return result;
  });
  expect(scales.every(value => Math.abs(value - 1) < 0.0001)).toBe(true);
  expect(await host(page).locator('[style]').count()).toBe(0);
});

test('a keyboard-sized viewport keeps the action and close reachable while the long body scrolls natively', async ({ page }, info) => {
  await openFixture(page);
  await page.evaluate(() => window.mobileFixture!.command());
  await readable(page);
  await page.evaluate(() => window.mobileFixture!.open());
  await expect(island(page)).toBeVisible();
  await page.evaluate(() => window.__mobileViewport.set({ height: 280, offsetTop: 40 }));
  await settle(host(page));
  await expectControlsInside(page, { left: 16, top: 56, right: 374, bottom: 304 });
  expect(await body(page).evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await body(page).hover();
  await page.mouse.wheel(0, 200);
  await expect.poll(() => body(page).evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const action = island(page).getByRole('button', { name: 'Execute action', exact: true });
  await action.focus();
  await page.keyboard.press('Enter');
  expect((await state(page)).actionAttempts).toBe(1);
  await screenshot(page, info, 'mobile-keyboard-viewport-controls');
  await island(page).getByRole('button', { name: 'Закрыть уведомление', exact: true }).click();
  await expect.poll(async () => (await state(page)).current).toBe('successor');
  await page.evaluate(() => window.__mobileViewport.set({ height: 844, offsetTop: 0 }));
  await settle(host(page));
  await expectControlsInside(page, { left: 16, top: 16, right: 374, bottom: 828 });
});

test('bottom edge: the tails peek upwards, the badge sits in the bottom corner, the Island grows from a fixed bottom and a header swipe to the edge collapses it', async ({ page }, info) => {
  await openFixture(page);
  await expect(host(page)).toHaveAttribute('data-edge', 'bottom');
  await idle(page);
  const rest = await geometry(shell(page));
  expect(rest.bottom).toBeCloseTo(828, 0);
  const tails = host(page).locator('.cloudlet-tail');
  await expect(tails).toHaveCount(2);
  expect(await translateY(tails.nth(0))).toBeCloseTo(-4, 0);
  expect(await translateY(tails.nth(1))).toBeCloseTo(-8, 0);
  for (const tail of await tails.all()) expect((await tail.boundingBox())!.y).toBeLessThan(rest.y + 1);
  const badge = (await shell(page).locator('.cloudlet-badge').boundingBox())!;
  expect(badge.y + badge.height / 2).toBeGreaterThan(rest.y + rest.height / 2);
  await screenshot(page, info, 'mobile-bottom-stack');

  await page.evaluate(() => window.mobileFixture!.open());
  await expect(island(page)).toBeVisible();
  // Every sample during the morph keeps the same bottom while the height grows upwards.
  const bottoms: number[] = [];
  for (let sample = 0; sample < 5; sample += 1) { await page.waitForTimeout(40); bottoms.push((await geometry(shell(page))).bottom); }
  await idle(page);
  const opened = await geometry(shell(page));
  for (const bottom of [...bottoms, opened.bottom]) expect(bottom).toBeCloseTo(828, 0);
  expect(opened.height).toBeGreaterThan(rest.height);
  expect(opened.y).toBeLessThan(rest.y);
  await screenshot(page, info, 'mobile-bottom-island');

  // The header dragged towards the screen edge (down) collapses; away from it only resists.
  await drag(page, header(page), 0, -60, 4, 30);
  await expect(host(page)).toHaveAttribute('data-state', 'island');
  await drag(page, header(page), 0, 70, 4, 30);
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  expect((await state(page)).closes).toEqual([]);
  await idle(page);

  await page.evaluate(() => window.mobileFixture!.position('top-center'));
  await expect(host(page)).toHaveAttribute('data-edge', 'top');
  await page.evaluate(() => window.mobileFixture!.open());
  await expect(island(page)).toBeVisible();
  await idle(page);
  // 32 px commits towards the edge (D44). Start low in the header: Firefox drops a pointer that leaves the viewport.
  const top = (await header(page).boundingBox())!;
  await page.mouse.move(top.x + top.width / 2, top.y + top.height - 6);
  await page.mouse.down();
  for (let step = 1; step <= 4; step += 1) { await page.mouse.move(top.x + top.width / 2, top.y + top.height - 6 - 10 * step); await page.waitForTimeout(30); }
  await page.mouse.up();
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  expect((await state(page)).closes).toEqual([]);
});

test('actions, links and the body never start a swipe; vertical scrolling of the body and the page stays native; a link closes by navigation', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => window.mobileFixture!.command());
  await readable(page);
  await page.evaluate(() => window.mobileFixture!.open());
  await expect(island(page)).toBeVisible();
  await idle(page);
  const action = island(page).getByRole('button', { name: 'Execute action', exact: true });
  for (const element of [action, body(page)]) {
    await element.dispatchEvent('pointerdown', { pointerId: 81, isPrimary: true, pointerType: 'touch', button: 0, clientX: 100, clientY: 500 });
    await element.dispatchEvent('pointermove', { pointerId: 81, isPrimary: true, pointerType: 'touch', buttons: 1, clientX: 300, clientY: 500 });
    expect((await record(page, 'action')).pauses).not.toContain(element === action ? 'gesture' : 'never');
    await element.dispatchEvent('pointerup', { pointerId: 81, isPrimary: true, pointerType: 'touch', clientX: 300, clientY: 500 });
  }
  expect((await state(page)).closes).toEqual([]);
  expect(await header(page).evaluate(element => getComputedStyle(element).touchAction)).toBe('none');
  for (const target of [body(page), island(page).locator('.cloudlet-clip')]) expect(await target.evaluate(element => getComputedStyle(element).touchAction)).toContain('pan-y');
  await body(page).hover();
  await page.mouse.wheel(0, 250);
  await expect.poll(() => body(page).evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await page.mouse.move(2, 200);
  await page.mouse.wheel(0, 250);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await action.click();
  expect((await state(page)).actionAttempts).toBe(1);

  await page.evaluate(() => window.mobileFixture!.link());
  await readable(page);
  await page.evaluate(() => window.mobileFixture!.open());
  const link = island(page).getByRole('link', { name: 'Open destination', exact: true });
  await link.dispatchEvent('pointerdown', { pointerId: 82, isPrimary: true, pointerType: 'touch', button: 0 });
  await link.dispatchEvent('pointermove', { pointerId: 82, isPrimary: true, pointerType: 'touch', buttons: 1, clientX: 300 });
  expect((await record(page, 'link')).pauses).not.toContain('gesture');
  await link.dispatchEvent('pointercancel', { pointerId: 82 });
  await link.click();
  await expect(page).toHaveURL(/#mobile-destination$/u);
  await expect.poll(async () => (await state(page)).closes).toEqual([{ id: 'link', reason: 'navigation' }]);
  await expect.poll(async () => (await state(page)).current).toBe('successor');
});

async function interruptedDrag(page: Page, finish: 'cancel' | 'lostcapture' | 'second' | 'orientation' | 'replace' | 'unmount') {
  // A real automation pointer so native capture is active; only the interruption is synthetic.
  const box = (await pill(page).boundingBox())!;
  const x = box.x + box.width / 2; const y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 40, y, { steps: 4 });
  await expect.poll(async () => (await record(page, 'C')).pauses).toContain('gesture');
  const pointerId = await page.evaluate(() => window.__shellAudit.lastPointerId!);
  await page.evaluate(({ reason, pointer }) => {
    const host = document.querySelector('.cloudlet-host')!;
    const target = host.querySelector('.cloudlet-pill') ?? host;
    if (reason === 'cancel') target.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: pointer }));
    if (reason === 'lostcapture') host.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: false, pointerId: pointer }));
    if (reason === 'second') target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: pointer + 1, pointerType: 'touch', isPrimary: false, button: 0 }));
    if (reason === 'orientation') window.dispatchEvent(new Event('orientationchange'));
    if (reason === 'replace') window.mobileFixture!.show({ id: 'D', title: 'Mobile D' });
    if (reason === 'unmount') window.mobileFixture!.attach(false);
  }, { reason: finish, pointer: pointerId });
  await page.waitForTimeout(40);
  await page.mouse.move(x + 200, y, { steps: 4 });
  await page.mouse.up();
}

test('cancel, lost capture, a second pointer, orientation, a new top record, unmount and reduced motion never swipe-dismiss', async ({ page }) => {
  await openFixture(page);
  for (const reason of ['cancel', 'lostcapture', 'second', 'orientation', 'replace', 'unmount'] as const) {
    await page.evaluate(() => { window.mobileFixture!.attach(true); window.mobileFixture!.reset(); });
    await readable(page);
    await idle(page);
    await interruptedDrag(page, reason);
    await page.waitForTimeout(100);
    expect((await state(page)).closes.filter(item => item.reason === 'swipe'), reason).toEqual([]);
    expect((await state(page)).records.every(item => !item.pauses.includes('gesture')), reason).toBe(true);
    expect((await state(page)).stack, reason).toContain('C');
  }
  await page.evaluate(() => { window.mobileFixture!.attach(true); window.mobileFixture!.reset(); });
  await readable(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(host(page)).toHaveAttribute('data-reduced-motion', 'true');
  // Released beside the pill: with swipes off, a press released on the pill is a plain click that opens
  // the Island, and whether 60 px leaves the pill depends on the platform's font.
  const pillBox = (await pill(page).boundingBox())!;
  await drag(page, pill(page), pillBox.width / 2 + 24, 0, 4, 40);
  expect((await state(page)).closes).toEqual([]);
  expect((await record(page, 'C')).pauses).not.toContain('gesture');
  await expect(host(page)).toHaveAttribute('data-state', 'stack');
  await pill(page).focus();
  await page.keyboard.press('Enter');
  await expect(island(page)).toBeVisible();
  await island(page).getByRole('button', { name: 'Закрыть уведомление', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).current).toBe('B');
  expect((await state(page)).closes).toEqual([{ id: 'C', reason: 'close-button' }]);
});

test('custom container and application dialog retain explicit controls in the same document', async ({ page }) => {
  await openFixture(page);
  for (const portal of ['custom', 'dialog'] as const) {
    await page.evaluate(value => window.mobileFixture!.portal(value), portal);
    await readable(page);
    expect(await host(page).evaluate(element => element.parentElement?.id)).toBe(`mobile-${portal}-portal`);
    await page.evaluate(() => window.mobileFixture!.open());
    await expect(island(page)).toBeVisible();
    await idle(page);
    await expectControlsInside(page, { left: 16, top: 16, right: 374, bottom: 828 });
    await island(page).getByRole('button', { name: 'Закрыть уведомление', exact: true }).click();
    await expect.poll(async () => (await state(page)).current).toBe('B');
    await page.evaluate(() => window.mobileFixture!.reset());
    await readable(page);
  }
});

test('unmount releases VisualViewport listeners, observation and pending frames', async ({ page }) => {
  await openFixture(page);
  expect(await page.evaluate(() => window.__mobileViewport.listeners())).toBe(2);
  await page.evaluate(() => window.mobileFixture!.attach(false));
  await expect(host(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({ listeners: window.__mobileViewport.listeners(),
    observers: window.__shellAudit.resizeTargets, frames: window.__shellAudit.rafPending }))).toEqual({ listeners: 0, observers: 0, frames: 0 });
  await page.evaluate(() => window.__mobileViewport.set({ height: 200, offsetTop: 100 }));
  await page.waitForTimeout(100);
  expect((await state(page)).closes).toEqual([]);
  expect((await state(page)).records.every(item => !item.pauses.includes('gesture'))).toBe(true);
});

test('touch (Chromium): a tap opens the Island, a sideways touch swipe dismisses the pill and a vertical touch pans the page', async ({ browser, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Touch sequences are dispatched through the Chromium DevTools protocol.');
  const device = devices['Pixel 6a']!;
  const context = await browser.newContext({ ...device, baseURL: 'http://127.0.0.1:4173' });
  try {
    const page = await context.newPage();
    await openFixture(page, device.viewport);
    await idle(page);
    const client = await context.newCDPSession(page);
    const touch = async (points: { x: number; y: number }[], pause = 16) => {
      const [first, ...rest] = points;
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: first!.x, y: first!.y }] });
      for (const point of rest) { await page.waitForTimeout(pause); await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y }] }); }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    let box = (await pill(page).boundingBox())!;
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    // Vertical: the page pans, the stack is untouched.
    await touch([{ x: cx, y: cy }, { x: cx + 2, y: cy - 40 }, { x: cx + 3, y: cy - 90 }, { x: cx + 3, y: cy - 150 }]);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    expect((await state(page)).closes).toEqual([]);
    // The fast pan leaves a fling that keeps scrolling past scrollTo, and a tap during a fling only
    // stops it (no click). Let it settle first; how long it runs depends on the machine.
    await expect.poll(async () => {
      const before = await page.evaluate(() => scrollY);
      await page.waitForTimeout(100);
      return before === await page.evaluate(() => scrollY);
    }).toBe(true);
    await page.evaluate(() => scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await idle(page);
    box = (await pill(page).boundingBox())!;
    await touch([{ x: cx, y: cy }, { x: cx + 30, y: cy }, { x: cx + 80, y: cy }, { x: cx + 160, y: cy }], 30);
    await expect.poll(async () => (await state(page)).closes).toEqual([{ id: 'C', reason: 'swipe' }]);
    await expect.poll(async () => (await state(page)).current).toBe('B');
    await idle(page);
    // Linux CI: this tap after the swipe did not open the Island while the same tap without a swipe
    // does. Record what reaches the page, so a failure says why.
    await page.evaluate(() => {
      const log: string[] = [];
      (window as unknown as { tapLog: string[] }).tapLog = log;
      const name = (target: EventTarget | null) => target instanceof Element ? `${target.tagName.toLowerCase()}.${[...target.classList].join('.')}` : String(target);
      for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'touchcancel', 'click']) {
        window.addEventListener(type, event => {
          const pointer = event instanceof PointerEvent ? ` id=${event.pointerId} primary=${event.isPrimary} kind=${event.pointerType}` : '';
          const touches = event instanceof TouchEvent ? ` touches=${event.touches.length}` : '';
          log.push(`${type} ${name(event.target)}${pointer}${touches} prevented=${event.defaultPrevented} detail=${(event as UIEvent).detail}`);
        });
      }
    });
    const tapBox = (await pill(page).boundingBox())!;
    const under = await page.evaluate(({ x, y }) => { const element = document.elementFromPoint(x, y); return element ? `${element.tagName}.${[...element.classList].join('.')}` : 'none'; }, { x: tapBox.x + tapBox.width / 2, y: tapBox.y + tapBox.height / 2 });
    await pill(page).tap();
    try {
      await expect(host(page)).toHaveAttribute('data-island-reason', 'user');
    } catch (error) {
      const log = await page.evaluate(() => (window as unknown as { tapLog: string[] }).tapLog);
      throw new Error(`${String(error)}\npill ${JSON.stringify(tapBox)}, under its centre: ${under}, scrollY ${await page.evaluate(() => scrollY)}\nevents:\n${log.join('\n')}`);
    }
    await expect(island(page)).toBeVisible();
    await idle(page);
    await expectControlsInside(page, { left: 16, top: 16, right: device.viewport.width - 16, bottom: device.viewport.height - 16 });
    await attachEnvironment(page, info);
    await finishAudit(page, info, 'mobile-touch-audit');
  } finally { await context.close(); }
});

test('named mobile device emulation keeps the Island controls after a tap, typing and viewport rotation', async ({ browser, browserName }, info) => {
  test.skip(browserName === 'firefox', 'Playwright Firefox does not support isMobile device emulation.');
  const deviceName = browserName === 'webkit' ? 'iPhone SE (3rd gen)' : 'Pixel 6a';
  const device = devices[deviceName]!;
  const context = await browser.newContext({ ...device, baseURL: 'http://127.0.0.1:4173' });
  try {
    const page = await context.newPage();
    await openFixture(page, device.viewport);
    await pill(page).tap();
    await expect(host(page)).toHaveAttribute('data-island-reason', 'user');
    await page.locator('#mobile-input').tap();
    await page.locator('#mobile-input').fill('Emulated keyboard input');
    await page.setViewportSize({ width: device.viewport.height, height: device.viewport.width });
    await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
    await settle(host(page));
    await expectControlsInside(page, { left: 16, top: 16, right: device.viewport.height - 16, bottom: device.viewport.width - 16 });
    await island(page).getByRole('button', { name: 'Закрыть уведомление', exact: true }).tap();
    await expect.poll(async () => (await state(page)).current).toBe('B');
    await attachEnvironment(page, info);
    await finishAudit(page, info, 'mobile-device-audit');
  } finally { await context.close(); }
});
