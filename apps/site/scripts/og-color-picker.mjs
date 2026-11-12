#!/usr/bin/env node
/**
 * The color picker landing's Open Graph and Twitter card (COLOR_PICKER §8.7): the hero at the brand
 * color, 1200×630, shot once in headless Chromium (SwiftShader for the shader) from the static
 * export and committed like the Toaster's card — as JPEG, since the film grain makes a PNG five times heavier. The header gives way to the name of the
 * component; the copy, the material and the open panel stay as the page draws them.
 *
 *   npm run build && npm run build:site
 *   node apps/site/scripts/og-color-picker.mjs
 *
 * Writes src/app/color-picker/opengraph-image.jpg and twitter-image.jpg. Run it again when the hero
 * changes.
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
  if ((await page.locator('.cp-hero').getAttribute('data-flat')) !== null) throw new Error('No WebGL 2: the hero fell back to the flat background');
  await page.addStyleTag({ content: '.site-header, .site-edge, .chapters, nextjs-portal { display: none !important; } .cp-hero { min-height: 630px; margin-top: 0; }' });
  await page.evaluate((icon) => {
    const label = document.createElement('div');
    label.style.cssText = 'position:fixed;left:48px;top:40px;z-index:5;display:flex;align-items:center;gap:14px;font:600 28px/1 var(--font-inter),sans-serif;letter-spacing:-0.02em;color:var(--cp-ink)';
    label.innerHTML = `<span style="width:44px;height:44px;display:block">${icon.replace('<svg ', '<svg width="44" height="44" ')}</span>Cloudlet Color Picker`;
    document.querySelector('.cp-hero')?.append(label);
  }, ICON);
  // The canvas re-lays out after the style change: let it draw its next frame.
  await page.waitForTimeout(600);
  const og = resolve(ROUTE, 'opengraph-image.jpg');
  await page.screenshot({ path: og, type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  copyFileSync(og, resolve(ROUTE, 'twitter-image.jpg'));
  console.log(`Wrote ${og} and twitter-image.jpg`);
} finally {
  await browser?.close();
  server.close();
}
