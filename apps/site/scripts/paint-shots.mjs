#!/usr/bin/env node
/**
 * Screens of the whole color picker landing from the dev server, top to bottom: the paint is a canvas
 * fixed to the window, so a full-page screenshot would not scroll it — the page is shot one screen at
 * a time instead. Desktop and phone, both themes, reduced motion (a still paint). A look, not a test.
 *
 *   npx next dev --hostname 127.0.0.1 --port 3000   (in apps/site)
 *   node apps/site/scripts/paint-shots.mjs <out-dir> [tag]
 *   C=ff6a3d,2f8f9d,f2b84b  SCHEMES=dark,light  VIEWS=desktop,phone  GL=swiftshader  BASE=http://127.0.0.1:3000
 */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [out = '.', tag = 'paint'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const base = process.env.BASE ?? 'http://127.0.0.1:3000';
const color = process.env.C ?? 'ff6a3d';
// GL=swiftshader shoots the software WebGL path (the paint over the whole page, drawn once).
const args = process.env.GL === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const VIEWS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

const browser = await chromium.launch({ args });
for (const name of (process.env.VIEWS ?? 'desktop,phone').split(',')) {
  for (const scheme of (process.env.SCHEMES ?? 'dark,light').split(',')) {
    const context = await browser.newContext({ ...VIEWS[name], colorScheme: scheme, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text().slice(0, 200)));
    await page.goto(`${base}/color-picker?c=${color}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.cpPaint !== undefined, null, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const mode = await page.evaluate(() => document.documentElement.dataset.cpPaint ?? 'flat');
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    const height = VIEWS[name].viewport.height;
    let shots = 0;
    for (let y = 0; y < total; y += height, shots += 1) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/${tag}-${name}-${scheme}-${String(shots).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 80 });
    }
    console.log(name, scheme, mode, `${shots} screens`, errors.length ? errors.slice(0, 3) : 'ok');
    await context.close();
  }
}
await browser.close();
