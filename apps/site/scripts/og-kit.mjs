#!/usr/bin/env node
/**
 * The kit's Open Graph and Twitter card, the root's (1200×630, JPEG like the color picker's: the sky's
 * gradients and the cloud renders are photographs, a PNG of them is twice as heavy). Two variants,
 * shot in headless Chromium from the static export in the light theme:
 *
 * - `sky`: the top of the kit's landing as it draws it — the sky, "Cloudlet" in clouds, the slogan,
 *   the command and the islands — with reduced motion; the header gives way to the hero.
 * - `clouds`: a still card like the Toaster's (scripts/brand-images.mjs): the day sky, the cloud
 *   renders and "Cloudlet" written in clouds over the slogan, without the page's controls.
 *
 *   npm run build && npm run build:site
 *   node apps/site/scripts/og-kit.mjs                       the chosen variant, as the root's card
 *   node apps/site/scripts/og-kit.mjs <variant> --out <dir> one variant into <dir> (to compare)
 *
 * The root's card is src/app/opengraph-image.jpg and twitter-image.jpg; their .alt.txt follow the
 * variant. Run it again when the top of the kit's landing changes.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { serve } from './serve-out.mjs';

/** The variant the root shows. */
const CHOSEN = 'clouds';
const APP = resolve(fileURLToPath(new URL('../src/app', import.meta.url)));
const SLOGAN = readFileSync(new URL('../src/components/kit/kit-hero.tsx', import.meta.url), 'utf8').includes('Everything floats.')
  ? ['Everything floats.', 'Nothing jumps.']
  : null;
if (!SLOGAN) throw new Error('The hero no longer says "Everything floats. Nothing jumps.": update the card and its alt text');

const ALT = {
  sky: `Cloudlet — the kit's landing: "Cloudlet" written in clouds over a day sky, the headline "${SLOGAN.join(' ')}", the shadcn install command and live components resting on clouds`,
  clouds: `Cloudlet — "Cloudlet" written in clouds and the headline "${SLOGAN.join(' ')}" on a day sky with clouds`,
};

/** The Toaster card's clouds, lower: a bank under the slogan, the name and the slogan above it. */
const CLOUDS = [
  { shape: 3, x: -2, y: 64, w: 24, depth: 0.15 },
  { shape: 4, x: 74, y: 60, w: 28, depth: 0.15, flip: true },
  { shape: 1, x: 24, y: 76, w: 44, depth: 0.6 },
  { shape: 6, x: -12, y: 78, w: 44, depth: 1 },
  { shape: 1, x: 60, y: 80, w: 50, depth: 1, flip: true },
];

const cloudsCard = `
<div style="position:fixed;inset:0;overflow:hidden;font-family:var(--font-inter),sans-serif;color:oklch(0.24 0.06 258)">
  <div style="position:absolute;inset:0;background:linear-gradient(180deg, oklch(0.6 0.14 247) 0%, oklch(0.76 0.1 238) 55%, oklch(0.93 0.035 230) 100%)"></div>
  <div style="position:absolute;inset:0;background:radial-gradient(720px 480px at 50% -10%, oklch(1 0.03 90 / 0.4), transparent 70%)"></div>
  ${CLOUDS.map((c) => `<img src="/sky/cloud-${c.shape}-day-1600.webp" alt="" style="position:absolute;left:${c.x}%;top:${c.y}%;width:${c.w}%;opacity:${0.55 + c.depth * 0.45};filter:blur(${(1 - c.depth) * 1.5}px)${c.flip ? ';transform:scaleX(-1)' : ''}">`).join('')}
  <img src="/wordmark/wordmark-wide-day-1600.webp" alt="" style="position:absolute;left:50%;top:40px;width:760px;transform:translateX(-50%)">
  <div style="position:absolute;left:0;right:0;top:318px;text-align:center;font-size:80px;font-weight:600;line-height:1.04;letter-spacing:-0.04em">${SLOGAN.join('<br>')}</div>
</div>`;

async function shootSky(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '.site-header, .site-edge, .chapters, nextjs-portal { display: none !important; } .kit-hero { min-height: 630px; }' });
  // The wordmark and the islands' clouds are lazy (the other theme must not load): wait for the shown ones.
  await page.waitForFunction(() => {
    const shown = [...document.querySelectorAll('.kit-hero img')].filter((img) => img.getClientRects().length && img.getBoundingClientRect().top < 630);
    return shown.length > 0 && shown.every((img) => img.complete && img.naturalWidth > 0);
  }, null, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  return page;
}

async function shootClouds(browser, origin) {
  // No JS: the export's HTML and CSS only (fonts, tokens), then the page body is replaced.
  const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 1200, height: 630 } });
  await page.goto(`${origin}/`);
  await page.evaluate((html) => {
    document.documentElement.className = document.documentElement.className.replace(/\bdark\b/, '');
    document.body.innerHTML = html;
  }, cloudsCard);
  await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.images].map((image) => image.decode())]));
  return page;
}

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outDir = outFlag >= 0 ? resolve(args.splice(outFlag, 2)[1]) : null;
const variant = args[0] ?? CHOSEN;
if (!(variant in ALT)) {
  console.error('Usage: node apps/site/scripts/og-kit.mjs [sky|clouds] [--out dir]');
  process.exit(2);
}
const folder = outDir ?? APP;
mkdirSync(folder, { recursive: true });

const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  const page = await (variant === 'sky' ? shootSky : shootClouds)(browser, origin);
  const og = resolve(folder, 'opengraph-image.jpg');
  await page.screenshot({ path: og, type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  copyFileSync(og, resolve(folder, 'twitter-image.jpg'));
  for (const name of ['opengraph-image', 'twitter-image']) writeFileSync(resolve(folder, `${name}.alt.txt`), ALT[variant]);
  console.log(`Wrote the ${variant} card: ${og}, twitter-image.jpg and their alt texts`);
} finally {
  await browser.close();
  server.close();
}
