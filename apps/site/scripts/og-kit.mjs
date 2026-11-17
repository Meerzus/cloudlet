#!/usr/bin/env node
/**
 * The kit's Open Graph and Twitter card, the root's (1200×630, JPEG like the color picker's: the sky's
 * gradients and the cloud renders are photographs, a PNG of them is twice as heavy), shot in
 * headless Chromium. The variants:
 *
 * - `wordmark-day`, `wordmark-night`: the README's picture (.github/readme/wordmark-<day|night>.webp),
 *   "Cloudlet" written in clouds across the sky, whole across the card.
 * - `paint`: the top of the kit's landing as it draws it — the color picker's paint, the headline,
 *   the command, the two buttons and the kit's three components — shot at 1440 px wide with reduced
 *   motion and scaled to the card in the start color (`?c=ff6a3d`: a visit's own color is random);
 *   the header keeps only the logo.
 * - `clouds`: a still card like the Toaster's (scripts/brand-images.mjs): the day sky, the cloud
 *   renders and "Cloudlet" written in clouds over the headline, without the page's controls.
 *
 *   npm run build && npm run build:site                    (paint and clouds: they shoot the export)
 *   node apps/site/scripts/og-kit.mjs                       the chosen variant, as the root's card
 *   node apps/site/scripts/og-kit.mjs <variant> --out <dir> one variant into <dir> (to compare)
 *
 * The paint needs WebGL 2 in the headless browser (SwiftShader draws it once, as a software WebGL).
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
const CHOSEN = 'wordmark-day';
const APP = resolve(fileURLToPath(new URL('../src/app', import.meta.url)));
const HEADLINE = readFileSync(new URL('../src/components/kit/kit-hero.tsx', import.meta.url), 'utf8').includes('Made to work <span>together.</span>')
  ? ['Made to work', 'together.']
  : null;
if (!HEADLINE) throw new Error('The hero no longer says "Made to work together.": update the card and its alt text');

const ALT = {
  'wordmark-day': 'Cloudlet — "Cloudlet" written in clouds across a day sky',
  'wordmark-night': 'Cloudlet — "Cloudlet" written in clouds across a night sky with stars',
  paint: `Cloudlet — the kit's landing: the headline "${HEADLINE.join(' ')}" on the color picker's coral paint, the shadcn install command, Browse components and Star on GitHub, and the live Toaster, color picker and palette`,
  clouds: `Cloudlet — "Cloudlet" written in clouds and the headline "${HEADLINE.join(' ')}" on a day sky with clouds`,
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
  <div style="position:absolute;left:0;right:0;top:318px;text-align:center;font-size:80px;font-weight:600;line-height:1.04;letter-spacing:-0.04em">${HEADLINE.join('<br>')}</div>
</div>`;

/** The page is laid out at 1440 px (the hero's two columns of parts) and scaled to the card's 1200. */
const SHOT_WIDTH = 1440;

async function shootPaint(browser, origin) {
  const scale = 1200 / SHOT_WIDTH;
  const page = await browser.newPage({ viewport: { width: SHOT_WIDTH, height: Math.round(630 / scale) }, deviceScaleFactor: scale, reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`${origin}/?c=ff6a3d`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '.site-edge, .chapters, nextjs-portal { display: none !important; } .site-header :is(nav, [aria-haspopup], button) { visibility: hidden; }' });
  // The paint draws once its frame is in: WebGL (GPU or software) or the still frame.
  await page.waitForFunction(() => document.querySelector('#hero .paint-section')?.dataset.state === 'drawn', null, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
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

/** The README's picture (2:1) whole across the card (1.9:1), 15 px of its edges mirrored above and below. */
async function shootWordmark(browser, theme) {
  const picture = `data:image/webp;base64,${readFileSync(new URL(`../../../.github/readme/wordmark-${theme}.webp`, import.meta.url)).toString('base64')}`;
  const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 1200, height: 630 } });
  // The 15 px bands mirror the picture's own edge rows: the sky's gradient runs on without a seam.
  const band = (top, imageTop) =>
    `<div style="position:fixed;left:0;top:${top}px;width:1200px;height:15px;overflow:hidden"><img src="${picture}" alt="" style="position:absolute;left:0;top:${imageTop}px;width:1200px;height:600px;transform:scaleY(-1)"></div>`;
  await page.setContent(`<body style="margin:0;overflow:hidden">
    ${band(0, -585)}
    <img src="${picture}" alt="" style="position:fixed;left:0;top:15px;width:1200px;height:600px">
    ${band(615, 0)}
  </body>`);
  await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
  return page;
}

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outDir = outFlag >= 0 ? resolve(args.splice(outFlag, 2)[1]) : null;
const variant = args[0] ?? CHOSEN;
if (!(variant in ALT)) {
  console.error(`Usage: node apps/site/scripts/og-kit.mjs [${Object.keys(ALT).join('|')}] [--out dir]`);
  process.exit(2);
}
const folder = outDir ?? APP;
mkdirSync(folder, { recursive: true });

const wordmark = variant.startsWith('wordmark-');
const server = wordmark ? null : await serve();
const origin = server ? `http://127.0.0.1:${server.address().port}` : '';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = wordmark ? await shootWordmark(browser, variant.slice('wordmark-'.length)) : await (variant === 'paint' ? shootPaint : shootClouds)(browser, origin);
  const og = resolve(folder, 'opengraph-image.jpg');
  await page.screenshot({ path: og, type: 'jpeg', quality: 90, clip: variant === 'paint' ? { x: 0, y: 0, width: SHOT_WIDTH, height: 630 * (SHOT_WIDTH / 1200) } : { x: 0, y: 0, width: 1200, height: 630 } });
  copyFileSync(og, resolve(folder, 'twitter-image.jpg'));
  for (const name of ['opengraph-image', 'twitter-image']) writeFileSync(resolve(folder, `${name}.alt.txt`), ALT[variant]);
  console.log(`Wrote the ${variant} card: ${og}, twitter-image.jpg and their alt texts`);
} finally {
  await browser.close();
  server?.close();
}
