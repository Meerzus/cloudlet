#!/usr/bin/env node
/**
 * Accessibility audit of the color picker on the static export (COLOR_PICKER §5, §10; task C09).
 * audit-landing.mjs covers both routes at rest; this one opens every picker and checks what a
 * keyboard and screen reader user meets, and measures the hero's text against the shader's pixels.
 *
 * 1. Hero contrast by pixels (Chromium with SwiftShader): axe cannot see a canvas, so for every curated
 *    start color plus the extremes and the colors either side of the scene threshold the hero is
 *    shot with its text made transparent once the material has drawn (`data-ready`), and each text
 *    box (headline, lede, header) is compared with the pixels under it; the score is the 1st
 *    percentile of the per-pixel ratio (a few grain pixels may fall below). Text ≥ 4.5:1. The same
 *    again with WebGL 2 taken away: the flat background (`data-flat`) must hold the ink too.
 * 2. Every picker on /color-picker and /color-picker/docs, desktop 1440×900 and phone 390×844, light
 *    and dark: Enter on the swatch opens a named dialog with focus in the area; axe on the open panel;
 *    the panel inside the viewport; arrows, Shift and Home/End against the promised values
 *    ("Saturation 40%, Brightness 80%", "Hue 48°", "Opacity 50%"); the Tab order inside the panel;
 *    Tab out of the panel closes it; the format radios re-emit the value; copy announces itself;
 *    Escape (twice from an edited field) returns focus to the swatch; a press outside closes without
 *    moving focus there; target sizes; reduced motion opens without animations; forced colors draw
 *    the thumb and the frames (Chromium only).
 *
 *   npm run build && npm run build:site
 *   node apps/site/scripts/audit-color-picker.mjs <out-dir> [--browser chromium|webkit] [--skip-contrast] [--skip-pickers]
 *
 * Writes color-picker-<browser>.json (with an ARIA snapshot of each open panel); exits 1 on any failure.
 */
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, webkit } from '@playwright/test';
import { serve } from './serve-out.mjs';

/** The curated start colors, read from lib/picker-start.ts so the list cannot drift. */
const START_COLORS = [.../START_COLORS = \[([^\]]+)\]/u.exec(readFileSync(new URL('../src/lib/picker-start.ts', import.meta.url), 'utf8'))[1].matchAll(/'(#[0-9a-f]{6})'/gu)].map((match) => match[1]);
/**
 * Not curated, but reachable: the extremes, a greyish blue, and colors just under and over the
 * scene threshold (OKLCH L 0.445 / 0.455), where each ink meets the least room.
 */
const EXTRA_COLORS = ['#3d5a80', '#ffffff', '#000000', '#ffff00', '#808080', '#0b5693', '#105996', '#99291d', '#336128'];
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const TEXT_MIN = 4.5;
const RING_MIN = 3;
/** WCAG 2.5.8 (AA): a target at least 24 px across through its centre, both ways. */
const TARGET_MIN = 24;

const args = process.argv.slice(2);
const browserFlag = args.indexOf('--browser');
const engine = { chromium, webkit }[browserFlag >= 0 ? args.splice(browserFlag, 2)[1] : 'chromium'];
const skipContrast = args.includes('--skip-contrast');
const skipPickers = args.includes('--skip-pickers');
const [outDir] = args.filter((arg) => !arg.startsWith('--'));
if (!outDir || !engine) {
  console.error('Usage: node apps/site/scripts/audit-color-picker.mjs <out-dir> [--browser chromium|webkit] [--skip-contrast] [--skip-pickers]');
  process.exit(2);
}
const out = resolve(outDir);
mkdirSync(out, { recursive: true });
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const report = { contrast: [], pickers: [] };
const failures = [];
const fail = (where, what) => {
  failures.push(`${where}: ${what}`);
  console.log(`  FAIL ${where}: ${what}`);
};

// --- 1. Hero contrast -----------------------------------------------------------------------------

/** In the page: per-pixel contrast of each text box (or ring) against a shot of the hero without its text. */
const measure = (page, shot, targets) =>
  page.evaluate(async ({ shot, targets }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${shot}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const scale = image.width / window.innerWidth;
    const { data } = context.getImageData(0, 0, image.width, image.height);
    // A CSS color (oklch included) as straight sRGB with alpha, through a 1×1 canvas.
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgba = (color) => {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = color;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const lum = (r, g, b) => {
      const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    return targets.map(({ label, color, boxes, ring }) => {
      // A two-tone ring scores, per pixel, the band that stands out more.
      const inks = (Array.isArray(color) ? color : [color]).map(rgba);
      const ratios = [];
      const inRing = (x, y) => ring && boxes.some((box) => {
        const dx = Math.max(box.left - x, 0, x - box.right);
        const dy = Math.max(box.top - y, 0, y - box.bottom);
        const d = Math.hypot(dx, dy);
        return d >= ring.offset && d <= ring.offset + ring.width;
      });
      for (const box of boxes) {
        const pad = ring ? ring.offset + ring.width : 0;
        const x0 = Math.max(0, Math.floor((box.left - pad) * scale));
        const x1 = Math.min(image.width, Math.ceil((box.right + pad) * scale));
        const y0 = Math.max(0, Math.floor((box.top - pad) * scale));
        const y1 = Math.min(image.height, Math.ceil((box.bottom + pad) * scale));
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            if (ring && !inRing(x / scale, y / scale)) continue;
            const index = (y * image.width + x) * 4;
            const bg = [data[index], data[index + 1], data[index + 2]];
            ratios.push(Math.max(...inks.map((ink) => {
              const fg = [ink.r, ink.g, ink.b].map((channel, i) => channel * ink.a + bg[i] * (1 - ink.a));
              const [lighter, darker] = [lum(...fg), lum(...bg)].sort((p, q) => q - p);
              return (lighter + 0.05) / (darker + 0.05);
            })));
          }
        }
      }
      ratios.sort((p, q) => p - q);
      const at = (share) => ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * share))] ?? 0;
      return { label, pixels: ratios.length, p1: Math.round(at(0.01) * 100) / 100, min: Math.round((ratios[0] ?? 0) * 100) / 100, ring: Boolean(ring) };
    });
  }, { shot, targets });

/** The text boxes to score: tight line boxes of the hero's copy and of the header's labels. */
const textTargets = (page) =>
  page.evaluate(() => {
    // The line boxes of the element's text nodes: not its icons, and not a visually hidden label (1 px, clipped).
    const lines = (element) => {
      const boxes = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        // A visually hidden label (sr-only: 1 px, clipped) still reports its full line boxes.
        const parent = node.parentElement.getBoundingClientRect();
        if (!node.textContent.trim() || parent.width <= 1 || parent.height <= 1) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const { left, top, right, bottom, width, height } of range.getClientRects()) if (width > 2 && height > 2) boxes.push({ left, top, right, bottom });
      }
      return boxes;
    };
    const targets = [];
    for (const [label, selector] of [['headline', '.cp-hero-title'], ['lede', '.cp-hero-lede']]) {
      const element = document.querySelector(selector);
      if (element) targets.push({ label, color: getComputedStyle(element).color, boxes: lines(element) });
    }
    for (const element of document.querySelectorAll('.site-header a, .site-header button')) {
      const text = element.textContent?.trim();
      const boxes = lines(element);
      if (!text || boxes.length === 0 || getComputedStyle(element).visibility === 'hidden') continue;
      targets.push({ label: `header “${text.slice(0, 20)}”`, color: getComputedStyle(element).color, boxes });
    }
    return targets;
  });

/** Takes WebGL 2 away before the page runs: the hero must keep its flat background. */
const NO_WEBGL = () => {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    return type === 'webgl2' ? null : original.call(this, type, ...rest);
  };
};

async function heroContrast(browser) {
  for (const flat of [false, true]) {
    for (const [device, options] of Object.entries({ desktop: DESKTOP, phone: PHONE })) {
      for (const colorScheme of ['light', 'dark']) {
        const context = await browser.newContext({ ...options, colorScheme, reducedMotion: 'reduce' });
        if (flat) await context.addInitScript(NO_WEBGL);
        const page = await context.newPage();
        for (const color of [...START_COLORS, ...EXTRA_COLORS]) {
          await page.goto(`${base}/color-picker?c=${color.slice(1)}`, { waitUntil: 'networkidle' });
          const where = `contrast ${flat ? 'flat ' : ''}${device}-${colorScheme} ${color}`;
          const state = await page
            .waitForSelector(flat ? '.cp-hero[data-flat]' : '.cp-hero[data-ready]', { timeout: 10_000 })
            .then(() => 'ok')
            .catch(async () => ((await page.locator('.cp-hero').getAttribute('data-flat')) !== null ? 'flat' : 'not ready'));
          if (state !== 'ok') {
            fail(where, state === 'flat' ? 'the hero fell back to the flat background (no WebGL 2)' : flat ? 'the hero did not fall back without WebGL 2' : 'the material never drew');
            continue;
          }
          await page.waitForTimeout(150);
          const targets = await textTargets(page);
          const style = await page.addStyleTag({
            content: '.cp-hero-copy, .cp-hero-copy *, .site-header, .site-header * { color: transparent !important; text-shadow: none !important; }',
          });
          await page.waitForTimeout(100);
          const shot = (await page.screenshot()).toString('base64');
          await style.evaluate((node) => node.remove());
          const scene = await page.evaluate(() => document.documentElement.getAttribute('data-cp-scene'));
          for (const result of await measure(page, shot, targets)) {
            const min = result.ring ? RING_MIN : TEXT_MIN;
            const entry = { flat, device, colorScheme, color, scene, ...result, passed: result.p1 >= min };
            report.contrast.push(entry);
            if (!entry.passed) fail(where, `${result.label} ${result.p1}:1 at the 1st percentile (needs ${min}:1)`);
          }
        }
        await context.close();
      }
    }
  }
  for (const flat of [false, true]) {
    const entries = report.contrast.filter((entry) => entry.flat === flat);
    const passed = entries.filter((entry) => entry.passed).length;
    const worst = [...entries].sort((p, q) => p.p1 - q.p1)[0];
    console.log(`hero contrast${flat ? ' (flat, no WebGL 2)' : ''}: ${passed}/${entries.length} passed; tightest ${worst?.label} ${worst?.p1}:1 (${worst?.device}-${worst?.colorScheme} ${worst?.color}, ${worst?.scene})`);
  }
}

// --- 2. Pickers -------------------------------------------------------------------------------------

/** What the focus is on, for the Tab order: the accessible name the picker gives each stop. */
const focusName = (page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return 'body';
    if (element.matches('input[type="radio"]')) return `radio ${element.value}`;
    return element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 30) ?? element.tagName;
  });
const valueText = (locator) => locator.getAttribute('aria-valuetext');
const settle = (page, ms = 900) => page.waitForTimeout(ms);
/** Safari (and WebKit) tab only to text fields by default; Option+Tab reaches buttons and radios too. */
const TAB = engine === webkit ? 'Alt+Tab' : 'Tab';

/** Extent through the centre, in each direction, over which a press lands on the control (its own hit area included). */
const hitExtent = (locator) =>
  locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const control = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      return hit === element || element.contains(hit) || (element.control && hit?.closest('label') === element);
    };
    const reach = (dx, dy) => {
      let d = 0;
      while (d < 40 && control(cx + dx * (d + 1), cy + dy * (d + 1))) d += 1;
      return d;
    };
    return { width: reach(-1, 0) + reach(1, 0) + 1, height: reach(0, -1) + reach(0, 1) + 1 };
  });

async function checkPopover(page, trigger, where, { reduced, forced, browserName }) {
  const entry = { where, checks: {} };
  report.pickers.push(entry);
  const check = (name, ok, detail) => {
    entry.checks[name] = ok ? 'passed' : `failed: ${detail}`;
    if (!ok) fail(where, `${name} — ${detail}`);
  };
  await trigger.scrollIntoViewIfNeeded();
  // Room below and beside the swatch is the page's business; centre it the way a reader would have it.
  await trigger.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(300);
  const name = await trigger.getAttribute('aria-label');
  // The trigger's size while closed: open, the panel's own swatch covers it.
  const swatchExtent = await hitExtent(trigger);
  check('swatch is a collapsed button', (await trigger.getAttribute('aria-expanded')) === 'false', `aria-expanded=${await trigger.getAttribute('aria-expanded')}`);
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(50);
  const dialogId = await trigger.getAttribute('aria-controls');
  const dialog = page.locator(`[id="${dialogId}"]`);
  check('Enter opens a named dialog', (await trigger.getAttribute('aria-expanded')) === 'true' && (await dialog.getAttribute('role')) === 'dialog' && Boolean(await dialog.getAttribute('aria-label')), `controls ${dialogId}`);
  if (reduced) {
    const running = await dialog.evaluate((element) => [element, ...element.querySelectorAll('*'), element.parentElement].flatMap((node) => node.getAnimations()).filter((animation) => animation.playState === 'running').length);
    check('reduced motion: opens without animations', running === 0, `${running} animations running`);
  }
  await settle(page);
  const area = dialog.locator('.color-picker-area');
  check('focus starts in the area', await area.evaluate((element) => element === document.activeElement), await focusName(page));

  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  check('panel inside the viewport', box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, JSON.stringify(box));

  const axe = await new AxeBuilder({ page }).include(`[id="${dialogId}"]`).analyze();
  check('axe on the open panel', axe.violations.length === 0, axe.violations.map((violation) => `${violation.id} (${violation.nodes.map((node) => node.target.join(' ')).join(', ')})`).join('; '));
  entry.aria = await dialog.ariaSnapshot();

  if (forced) {
    const drawn = await dialog.evaluate((element) => {
      const thumb = getComputedStyle(element.querySelector('.color-picker-thumb'));
      const area = getComputedStyle(element.querySelector('.color-picker-area'));
      return thumb.borderTopStyle === 'solid' && parseFloat(thumb.borderTopWidth) >= 2 && parseFloat(area.borderTopWidth) >= 1;
    });
    check('forced colors: thumb and area framed', drawn, 'no border');
  }

  // The area: arrows, Shift, and the words a screen reader hears.
  const AREA = /^Saturation (\d+)%, Brightness (\d+)%$/u;
  const before = AREA.exec((await valueText(area)) ?? '');
  check('area value text', Boolean(before), await valueText(area));
  if (before) {
    const [s, v] = [Number(before[1]), Number(before[2])];
    await page.keyboard.press(s > 0 ? 'ArrowLeft' : 'ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    const after = AREA.exec((await valueText(area)) ?? '');
    const expected = [s > 0 ? s - 1 : s + 1, Math.max(0, v - 10)];
    check('area ←/→ by 1 %, Shift+↓ by 10 %', after && Number(after[1]) === expected[0] && Number(after[2]) === expected[1], `${await valueText(area)} after ${s}/${v}`);
    check('area aria-valuenow is the saturation', Number(await area.getAttribute('aria-valuenow')) === expected[0], await area.getAttribute('aria-valuenow'));
  }

  // Tab order from the panel's own swatch to the last tool, then out.
  await dialog.locator('.color-picker-head .color-picker-swatch').focus();
  const order = [await focusName(page)];
  for (let index = 0; index < 10; index += 1) {
    await page.keyboard.press(TAB);
    await page.waitForTimeout(60);
    const inside = await dialog.evaluate((element) => element.contains(document.activeElement)).catch(() => false);
    if (!inside) break;
    order.push(await focusName(page));
  }
  entry.tabOrder = order;
  const alpha = (await dialog.locator('.color-picker-alpha').count()) > 0;
  const eyedropper = await page.evaluate(() => typeof window.EyeDropper === 'function');
  const expected = ['Close', 'Color value', 'Saturation and brightness', 'Hue', ...(alpha ? ['Opacity'] : []), 'radio', ...(eyedropper ? ['Pick from screen'] : []), 'Copy'];
  const matches = order.length === expected.length && order.every((stop, index) => stop.startsWith(expected[index]));
  check('Tab order inside the panel', matches, order.join(' → '));
  await page.waitForTimeout(500);
  check('Tab out of the panel closes it', (await trigger.getAttribute('aria-expanded')) === 'false', `still open, focus on ${await focusName(page)}`);
  await settle(page);

  // Hue and opacity: Home/End and steps, against "Hue 48°" and "Opacity 50%".
  await trigger.focus();
  await page.keyboard.press('Enter');
  await settle(page);
  const hue = dialog.locator('.color-picker-hue');
  await hue.focus();
  await page.keyboard.press('Home');
  const hueHome = await valueText(hue);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const hueStep = await valueText(hue);
  await page.keyboard.press('End');
  const hueEnd = await valueText(hue);
  check('hue value text, Home, → +1°, Shift+→ +10°, End', hueHome === 'Hue 0°' && hueStep === 'Hue 11°' && hueEnd === 'Hue 360°', `${hueHome} / ${hueStep} / ${hueEnd}`);
  if (alpha) {
    const opacity = dialog.locator('.color-picker-alpha');
    await opacity.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+ArrowLeft');
    check('opacity value text', (await valueText(opacity)) === 'Opacity 90%', await valueText(opacity));
  }

  // The format radios: arrows move and re-emit the value in the new format.
  const checked = dialog.locator('input[type="radio"]:checked');
  if ((await checked.count()) > 0) {
    await checked.focus();
    const from = await checked.inputValue();
    await page.keyboard.press('ArrowRight');
    const to = await dialog.locator('input[type="radio"]:checked').inputValue();
    const value = await dialog.locator('.color-picker-value').inputValue();
    const shape = { hex: /^#[0-9a-f]{6}([0-9a-f]{2})?$/u, rgb: /^rgb\(/u, hsl: /^hsl\(/u, oklch: /^oklch\(/u }[to];
    check('format radios: arrow moves and re-emits', to !== from && shape?.test(value), `${from} → ${to}, field ${value}`);
    await page.keyboard.press('ArrowLeft');
  }

  // Copy: the live region says so (a blocked clipboard stays silent by design).
  const copy = dialog.getByRole('button', { name: 'Copy' });
  await copy.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const live = await dialog.locator('[aria-live="polite"]').textContent();
  const clipboard = browserName === 'chromium' ? await page.evaluate(() => navigator.clipboard.readText()).catch(() => null) : null;
  entry.copy = { live, clipboard };
  if (browserName === 'chromium') check('copy writes and announces', live === 'Copied' && clipboard === (await dialog.locator('.color-picker-value').inputValue()), `live “${live}”, clipboard ${clipboard}`);

  // Target sizes through the centre (own hit areas included).
  const targets = { value: dialog.locator('.color-picker-value'), hue, copy, segment: dialog.locator('.color-picker-segment').first() };
  entry.targets = {};
  for (const [label, locator] of [['swatch', null], ...Object.entries(targets)]) {
    if (locator && !(await locator.count())) continue;
    const extent = locator ? await hitExtent(locator) : swatchExtent;
    entry.targets[label] = extent;
    check(`target ${label} ≥ ${TARGET_MIN} px`, extent.width >= TARGET_MIN && extent.height >= TARGET_MIN, `${extent.width}×${extent.height}`);
  }

  // Escape from the area: closed, focus back on the swatch.
  await area.focus();
  await page.keyboard.press('Escape');
  await settle(page);
  check('Escape closes and returns focus to the swatch', (await trigger.getAttribute('aria-expanded')) === 'false' && (await trigger.evaluate((element) => element === document.activeElement)), await focusName(page));

  // The field: an unparsable draft, Escape reverts and stays; a second Escape closes.
  await page.keyboard.press('Enter');
  await settle(page);
  const field = dialog.locator('.color-picker-value');
  const kept = await field.inputValue();
  await field.focus();
  await page.keyboard.type('zz');
  await page.keyboard.press('Escape');
  const reverted = (await field.inputValue()) === kept && (await field.evaluate((element) => element === document.activeElement));
  await page.keyboard.press('Escape');
  await settle(page);
  check('field: Escape reverts, second Escape closes to the swatch', reverted && (await trigger.evaluate((element) => element === document.activeElement)), `field ${await field.inputValue().catch(() => 'gone')}, focus ${await focusName(page)}`);

  // A press outside closes and does not move focus to the swatch.
  await page.keyboard.press('Enter');
  await settle(page);
  await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })));
  await settle(page);
  check('press outside closes without focusing the swatch', (await trigger.getAttribute('aria-expanded')) === 'false' && !(await trigger.evaluate((element) => element === document.activeElement)), await focusName(page));
  console.log(`  ${where}: ${name} — ${Object.values(entry.checks).filter((value) => value === 'passed').length}/${Object.keys(entry.checks).length}`);
}

async function checkInline(page, panel, where) {
  const entry = { where, checks: {} };
  report.pickers.push(entry);
  await panel.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const axe = await new AxeBuilder({ page }).include('.color-picker-inline').analyze();
  entry.checks.axe = axe.violations.length ? `failed: ${axe.violations.map((violation) => violation.id).join(', ')}` : 'passed';
  if (axe.violations.length) fail(where, `axe on the inline panel — ${axe.violations.map((violation) => violation.id).join(', ')}`);
  entry.aria = await panel.ariaSnapshot();
  console.log(`  ${where}: inline panel — axe ${entry.checks.axe}`);
}

async function pickers(browser) {
  const scenarios = {};
  for (const [device, options] of Object.entries({ desktop: DESKTOP, phone: PHONE })) for (const colorScheme of ['light', 'dark']) scenarios[`${device}-${colorScheme}`] = { ...options, colorScheme };
  scenarios['desktop-light-reduced'] = { ...DESKTOP, colorScheme: 'light', reducedMotion: 'reduce' };
  if (engine === chromium) scenarios['desktop-dark-forced'] = { ...DESKTOP, colorScheme: 'dark', forcedColors: 'active' };
  for (const [scenario, options] of Object.entries(scenarios)) {
    console.log(`${scenario}:`);
    const context = await browser.newContext({
      ...options,
      ...(engine === chromium ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}),
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    for (const path of ['/color-picker?c=ff6a3d', '/color-picker/docs']) {
      await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      const triggers = page.locator('main .color-picker > .color-picker-swatch');
      for (let index = 0; index < (await triggers.count()); index += 1) {
        await checkPopover(page, triggers.nth(index), `${scenario} ${path} #${index + 1}`, { reduced: options.reducedMotion === 'reduce', forced: options.forcedColors === 'active', browserName: engine.name() });
      }
      const inline = page.locator('main .color-picker-inline');
      for (let index = 0; index < (await inline.count()); index += 1) await checkInline(page, inline.nth(index), `${scenario} ${path} inline #${index + 1}`);
    }
    if (errors.length) fail(scenario, `page errors: ${errors.join(' | ')}`);
    await context.close();
  }
}

const browser = await engine.launch(engine === chromium ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {});
try {
  if (!skipContrast && engine === chromium) await heroContrast(browser);
  if (!skipPickers) await pickers(browser);
} finally {
  await browser.close();
  server.close();
}
report.failures = failures;
writeFileSync(join(out, `color-picker-${engine.name()}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(failures.length ? `\n${failures.length} failures` : '\nNo failures');
process.exit(failures.length ? 1 : 0);
