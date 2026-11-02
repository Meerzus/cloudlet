#!/usr/bin/env node
/**
 * Smoke snapshot of the color picker landing's hero (COLOR_PICKER §8.4): headless Chromium with
 * SwiftShader renders `/color-picker?c=ff6a3d` from the static export, still (reduced motion),
 * without the copy — fonts differ between systems, the shader should not. The frame is scaled
 * down to 160×100 in the page, which averages the film grain away, and compared with the
 * committed reference `smoke/picker-hero.png`: it fails when more than 1 % of the pixels differ
 * by more than 24 of 255 in any channel. `--update` writes a new reference.
 *
 *   npm run build && npm run build:site
 *   node apps/site/scripts/smoke-picker-hero.mjs [--update]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { serve } from './serve-out.mjs';

const REFERENCE = new URL('./smoke/picker-hero.png', import.meta.url);
const SIZE = { width: 160, height: 100 };
const TOLERANCE = 24;
const MAX_DIFFERENT = 0.01;
const update = process.argv.includes('--update');

const server = await serve();
let browser;
let failed = false;
try {
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/color-picker?c=ff6a3d`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '.cp-hero-copy, .site-header, .site-edge, nextjs-portal { visibility: hidden !important; }' });
  await page.waitForTimeout(400);
  const flat = await page.locator('.cp-hero').getAttribute('data-flat');
  const shot = (await page.locator('.cp-hero').screenshot()).toString('base64');
  const reference = existsSync(REFERENCE) && !update ? readFileSync(REFERENCE).toString('base64') : null;
  const result = await page.evaluate(async ({ shot, reference, size, tolerance }) => {
    const pixels = async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      Object.assign(canvas, size);
      const context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, size.width, size.height);
      return { data: context.getImageData(0, 0, size.width, size.height).data, png: canvas.toDataURL('image/png').split(',')[1] };
    };
    const actual = await pixels(shot);
    if (!reference) return { png: actual.png, different: null };
    const expected = await pixels(reference);
    let different = 0;
    for (let index = 0; index < actual.data.length; index += 4) {
      const delta = Math.max(...[0, 1, 2].map((channel) => Math.abs(actual.data[index + channel] - expected.data[index + channel])));
      if (delta > tolerance) different += 1;
    }
    return { png: actual.png, different: different / (size.width * size.height) };
  }, { shot, reference, size: SIZE, tolerance: TOLERANCE });

  if (flat !== null) {
    console.error('The hero fell back to the flat sky: no WebGL 2 in this Chromium.');
    failed = true;
  } else if (result.different === null) {
    writeFileSync(REFERENCE, Buffer.from(result.png, 'base64'));
    console.log(`Reference written: ${REFERENCE.pathname}`);
  } else {
    const share = (result.different * 100).toFixed(2);
    failed = result.different > MAX_DIFFERENT;
    console.log(`Hero smoke: ${share} % of pixels differ (limit ${MAX_DIFFERENT * 100} %) — ${failed ? 'FAILED' : 'passed'}`);
    if (failed) writeFileSync(new URL('./smoke/picker-hero.actual.png', import.meta.url), Buffer.from(result.png, 'base64'));
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    failed = true;
  }
  await context.close();
} finally {
  // A browser that failed to launch must not keep the server open.
  await browser?.close();
  server.close();
}
process.exit(failed ? 1 : 0);
