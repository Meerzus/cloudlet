#!/usr/bin/env node
/**
 * The color picker landing's Open Graph and Twitter card (COLOR_PICKER §8.12): the top of the page at
 * the brand color in the light theme, 1200×630, shot once in headless Chromium (SwiftShader for the
 * shader) from the static export and committed like the Toaster's card — as JPEG, since the grain
 * makes a PNG five times heavier. The header gives way to the name of the component; the copy, the
 * paint (with its paper lifted under the copy) and the open panel stay as the page draws them.
 *
 *   npm run build && npm run build:site
 *   node apps/site/scripts/og-color-picker.mjs
 *
 * Writes src/app/color-picker/opengraph-image.jpg and twitter-image.jpg. Run it again when the hero
 * top of the page changes.
 */
import { copyFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { serve } from './serve-out.mjs';

/** The brand color: the first of the curated start colors, a warm orange. */
const BRAND = 'ff6a3d';
const ROUTE = resolve(fileURLToPath(new URL('../src/app/color-picker', import.meta.url)));
const ICON = readFileSync(new URL('./brand/icon.svg', import.meta.url), 'utf8');

const server = await serve();
let browser;
try {
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`http://127.0.0.1:${server.address().port}/color-picker?c=${BRAND}`, { waitUntil: 'networkidle' });
  // The paint is drawn once its frame is in: 'page' here (software WebGL), 'flat' without WebGL 2.
  const mode = await page
    .waitForFunction(() => {
      if (document.querySelector('.cp-paint')?.dataset.mode === 'flat') return 'flat';
      const img = document.querySelector('picture img[src*="material-page"]');
      const paint = document.documentElement.dataset.cpPaint;
      return paint && img?.complete && img.naturalWidth > 0 ? paint : false;
    }, null, { timeout: 15_000 })
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  if (mode !== 'page' && mode !== 'fixed') throw new Error(`The paint did not draw its frame (${mode ?? 'nothing'})`);
  await page.addStyleTag({ content: '.site-header, .site-edge, .chapters, nextjs-portal { display: none !important; } .cp-hero { min-height: 630px; margin-top: 0; }' });
  await page.evaluate((icon) => {
    const label = document.createElement('div');
    label.style.cssText = 'position:fixed;left:48px;top:40px;z-index:5;display:flex;align-items:center;gap:14px;font:600 28px/1 var(--font-inter),sans-serif;letter-spacing:-0.02em;color:var(--foreground)';
    label.innerHTML = `<span style="width:44px;height:44px;display:block">${icon.replace('<svg ', '<svg width="44" height="44" ')}</span>Cloudlet Color Picker`;
    document.querySelector('.cp-hero')?.append(label);
  }, ICON);
  // The map of lines is rebuilt after the style change (on the next frame): let the paint draw it.
  await page.waitForTimeout(800);
  const og = resolve(ROUTE, 'opengraph-image.jpg');
  await page.screenshot({ path: og, type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  copyFileSync(og, resolve(ROUTE, 'twitter-image.jpg'));
  console.log(`Wrote ${og} and twitter-image.jpg`);
} finally {
  await browser?.close();
  server.close();
}
