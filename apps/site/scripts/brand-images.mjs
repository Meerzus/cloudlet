#!/usr/bin/env node
/**
 * Renders the site's raster brand images from the icon (scripts/brand/icon.svg, the ≥64 px cut) in headless Chromium against the static export, so the OG card gets the site's
 * Inter, sky and cloud renders:
 *
 *   npm run build && npm run build:site
 *   node apps/site/scripts/brand-images.mjs
 *
 * Writes src/app/apple-icon.png (180², full bleed: iOS rounds it itself) and
 * src/app/opengraph-image.png + twitter-image.png (1200×630, a hero frame with clouds).
 */
import { copyFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { serve } from './serve-out.mjs';

const APP = resolve(fileURLToPath(new URL('../src/app', import.meta.url)));
const ICON = readFileSync(new URL('./brand/icon.svg', import.meta.url), 'utf8');

/** Same clouds as the first screen of the sky (components/site/sky.tsx), placed for a 1200×630 card. */
const CLOUDS = [
  { shape: 3, x: 2, y: 64, w: 26, depth: 0.15 },
  { shape: 4, x: 66, y: 60, w: 30, depth: 0.15, flip: true },
  { shape: 5, x: 84, y: 30, w: 18, depth: 0.35 },
  { shape: 1, x: 24, y: 74, w: 44, depth: 0.6 },
  { shape: 6, x: -14, y: 80, w: 46, depth: 1 },
  { shape: 1, x: 62, y: 82, w: 50, depth: 1, flip: true },
];

const card = `
<div style="position:fixed;inset:0;overflow:hidden;font-family:var(--font-inter),sans-serif;color:oklch(0.24 0.06 258)">
  <div style="position:absolute;inset:0;background:linear-gradient(180deg, oklch(0.6 0.14 247) 0%, oklch(0.76 0.1 238) 55%, oklch(0.93 0.035 230) 100%)"></div>
  <div style="position:absolute;inset:0;background:radial-gradient(720px 480px at 12% -8%, oklch(1 0.03 90 / 0.4), transparent 70%)"></div>
  ${CLOUDS.map((c) => `<img src="/sky/cloud-${c.shape}-day-1600.webp" alt="" style="position:absolute;left:${c.x}%;top:${c.y}%;width:${c.w}%;opacity:${0.55 + c.depth * 0.45};filter:blur(${(1 - c.depth) * 1.5}px)${c.flip ? ';transform:scaleX(-1)' : ''}">`).join('')}
  <div style="position:absolute;left:96px;top:84px;display:flex;align-items:center;gap:22px">
    <div style="width:88px;height:88px">${ICON.replace('<svg ', '<svg width="88" height="88" ')}</div>
    <span style="font-size:46px;font-weight:600;letter-spacing:-0.02em">Cloudlet</span>
  </div>
  <div style="position:absolute;left:96px;top:226px;width:1000px;font-size:96px;font-weight:600;line-height:1.02;letter-spacing:-0.04em">Notifications,<br>light as a cloud.</div>
</div>`;

const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  // No JS: the export's HTML and CSS only (fonts, tokens), then the page body is replaced
  const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 1200, height: 630 } });
  await page.goto(`${origin}/`);
  await page.evaluate((html) => {
    document.documentElement.className = document.documentElement.className.replace(/\bdark\b/, '');
    document.body.innerHTML = html;
  }, card);
  await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.images].map((image) => image.decode())]));
  await page.screenshot({ path: resolve(APP, 'opengraph-image.png') });
  copyFileSync(resolve(APP, 'opengraph-image.png'), resolve(APP, 'twitter-image.png'));

  const icon = await browser.newPage({ viewport: { width: 180, height: 180 } });
  await icon.setContent(`<style>html,body{margin:0}</style>${ICON.replace('<svg ', '<svg width="180" height="180" ').replace(' rx="8"', '')}`);
  await icon.screenshot({ path: resolve(APP, 'apple-icon.png') });
} finally {
  await browser.close();
  server.close();
}
console.log('wrote apple-icon.png, opengraph-image.png, twitter-image.png');
