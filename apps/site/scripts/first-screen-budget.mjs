#!/usr/bin/env node
/**
 * The first screen's weight on the static export, the way the kit's landing budgets it:
 *
 * - start JS: the scripts a page's HTML loads (`<script src>`), each gzipped (level 9) as a static
 *   host serves it, summed. Inline scripts are part of the HTML and not counted.
 * - first-screen media: images (and video) the page fetches with no scroll, from load until the
 *   network has been idle for 2.5 s, in headless Chromium on a laptop (1440×900 at 2×) and on
 *   Lighthouse's phone (412×823 at 1.75×), light and dark. A lazy image wholly below the first
 *   screen is "the rest, lazily": Chrome fetches it early when it is near (a short page's footer),
 *   so it is listed apart and not counted. Everything else fetched counts, the theme that is not
 *   shown included (it must not be fetched at all).
 *
 *   npm run build && npm run build:site
 *   node apps/site/scripts/first-screen-budget.mjs [--json <file>] [path ...]   (default: / /toaster)
 *
 * When both `/` and `/toaster` are measured it also checks the kit's budget: the start JS of `/` is
 * no larger than that of `/toaster`, and the first screen of `/` fetches at most 150 KB of media in
 * every context. Exits 1 when either fails. --json also writes the measurements and the verdict to a
 * file (the audits workflow keeps it as an artifact).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { serve } from './serve-out.mjs';

const OUT = resolve(fileURLToPath(new URL('../out', import.meta.url)));
const args = process.argv.slice(2);
const jsonFlag = args.indexOf('--json');
const jsonFile = jsonFlag >= 0 ? resolve(args.splice(jsonFlag, 2)[1]) : null;
const PATHS = args.length ? args : ['/', '/toaster'];
const MEDIA_MAX = 150 * 1024;
const CONTEXTS = {
  'laptop-light': { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' },
  'laptop-dark': { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' },
  'phone-light': { viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true, colorScheme: 'light' },
  'phone-dark': { viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true, colorScheme: 'dark' },
};
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function htmlFile(path) {
  return path === '/' ? join(OUT, 'index.html') : join(OUT, `${path.replace(/^\//u, '')}.html`);
}

function startJs(path) {
  const html = readFileSync(htmlFile(path), 'utf8');
  const sources = [...new Set([...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/gu)].map((match) => match[1]))];
  let total = 0;
  for (const source of sources) total += gzipSync(readFileSync(join(OUT, new URL(source, 'http://x').pathname)), { level: 9 }).length;
  return { scripts: sources.length, bytes: total };
}

async function media(browser, base, path, context) {
  const page = await (await browser.newContext({ ...context, reducedMotion: 'no-preference' })).newPage();
  const fetched = [];
  page.on('requestfinished', async (request) => {
    if (!['image', 'media'].includes(request.resourceType())) return;
    const sizes = await request.sizes().catch(() => null);
    fetched.push({ url: new URL(request.url()).pathname, bytes: sizes?.responseBodySize ?? 0 });
  });
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  // Files used only by lazy images below the first screen: fetched early, but not the first screen's.
  const below = new Set(
    await page.evaluate(() => {
      const uses = new Map();
      for (const image of document.images) {
        // Only images that loaded: a lazy one out of the page (display: none) has a source but no file.
        if (!image.currentSrc || !image.complete || image.naturalWidth === 0) continue;
        const later = image.loading === 'lazy' && image.getBoundingClientRect().top >= window.innerHeight;
        const url = new URL(image.currentSrc).pathname;
        uses.set(url, (uses.get(url) ?? true) && later);
      }
      return [...uses].filter(([, later]) => later).map(([url]) => url);
    }),
  );
  await page.context().close();
  for (const file of fetched) file.later = below.has(file.url);
  return { bytes: fetched.filter((file) => !file.later).reduce((sum, file) => sum + file.bytes, 0), files: fetched };
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const results = {};
for (const path of PATHS) {
  const js = startJs(path);
  const shots = {};
  for (const [name, context] of Object.entries(CONTEXTS)) shots[name] = await media(browser, base, path, context);
  results[path] = { js, media: shots };
  console.log(`${path}\n  start JS: ${kb(js.bytes)} gzip in ${js.scripts} scripts`);
  for (const [name, shot] of Object.entries(shots)) {
    console.log(`  media, ${name}: ${kb(shot.bytes)} in ${shot.files.filter((file) => !file.later).length} files`);
    for (const file of shot.files) console.log(`    ${kb(file.bytes).padStart(9)}  ${file.url}${file.later ? '  (lazy, below the first screen: not counted)' : ''}`);
  }
}
await browser.close();
server.close();

let failed = false;
const budget = [];
if (results['/'] && results['/toaster']) {
  const kit = results['/'];
  const toaster = results['/toaster'];
  const jsOk = kit.js.bytes <= toaster.js.bytes;
  console.log(`\nstart JS of / (${kb(kit.js.bytes)}) ≤ /toaster (${kb(toaster.js.bytes)}): ${jsOk ? 'yes' : 'NO'}`);
  budget.push({ check: 'start JS of / ≤ /toaster', value: kit.js.bytes, limit: toaster.js.bytes, ok: jsOk });
  failed ||= !jsOk;
  for (const [name, shot] of Object.entries(kit.media)) {
    const ok = shot.bytes <= MEDIA_MAX;
    console.log(`first-screen media of /, ${name} (${kb(shot.bytes)}) ≤ ${kb(MEDIA_MAX)}: ${ok ? 'yes' : 'NO'}`);
    budget.push({ check: `first-screen media of /, ${name}`, value: shot.bytes, limit: MEDIA_MAX, ok });
    failed ||= !ok;
  }
}
if (jsonFile) {
  mkdirSync(dirname(jsonFile), { recursive: true });
  writeFileSync(jsonFile, JSON.stringify({ results, budget, ok: !failed }, null, 2) + '\n');
}
process.exit(failed ? 1 : 0);
