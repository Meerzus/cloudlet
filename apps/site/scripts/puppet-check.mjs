#!/usr/bin/env node
/**
 * Puppet accuracy check: screenshots the real Toaster and the puppet
 * alone on /puppet-check at 1:1, diffs them in a canvas and writes contact sheets.
 *
 * The stand is a service page, not in the production export: build it in or use `next dev`.
 *
 *   npm run build && SITE_SERVICE_PAGES=1 npm run build:site
 *   node apps/site/scripts/puppet-check.mjs <out-dir> [--base http://127.0.0.1:3000] [case ...]
 *
 * Writes <case>-<theme>-{real,puppet,diff}.png, sheet-<theme>.png and report.json
 * (share of differing pixels per case; tolerance absorbs antialiasing).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { serve } from './serve-out.mjs';

const CASES = ['pill', 'loading', 'stack', 'progress-pill', 'island', 'dots', 'progress', 'retry', 'cancel'];
const THEMES = ['light', 'dark'];
const VIEWPORT = { width: 640, height: 360 };
/** Region around the top-center stack, CSS px. */
const CLIP = { x: 96, y: 0, width: 448, height: 300 };
const SCALE = 2;
/** A pixel differs when a channel moves more than this (0–255). */
const TOLERANCE = 40;

const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base');
const base = baseIndex >= 0 ? args.splice(baseIndex, 2)[1] : null;
const out = resolve(args.shift() ?? 'artifacts/landing-03/puppet-check');
const cases = args.length ? args : CASES;
mkdirSync(out, { recursive: true });

const server = base ? null : await serve();
const origin = base ?? `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const report = { origin, tolerance: TOLERANCE, results: [] };

async function shoot(context, name, theme, show) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${origin}/toaster/puppet-check?case=${name}&theme=${theme}&show=${show}`);
  await page.waitForSelector('html[data-check-ready]', { timeout: 15000 });
  const png = await page.screenshot({ clip: CLIP });
  await page.close();
  return { png, errors };
}

/** Diffs two PNGs in the browser: share of differing pixels and a red-on-grey diff image. */
async function diff(context, a, b) {
  const page = await context.newPage();
  const result = await page.evaluate(
    async ({ a, b, tolerance }) => {
      const load = (data) =>
        new Promise((done) => {
          const image = new Image();
          image.onload = () => done(image);
          image.src = `data:image/png;base64,${data}`;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const canvas = document.createElement('canvas');
      canvas.width = ia.width;
      canvas.height = ia.height;
      const g = canvas.getContext('2d');
      g.drawImage(ia, 0, 0);
      const da = g.getImageData(0, 0, canvas.width, canvas.height);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawImage(ib, 0, 0);
      const db = g.getImageData(0, 0, canvas.width, canvas.height);
      const view = g.createImageData(canvas.width, canvas.height);
      let differing = 0;
      let maxDelta = 0;
      const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (let i = 0; i < da.data.length; i += 4) {
        const delta = Math.max(
          Math.abs(da.data[i] - db.data[i]),
          Math.abs(da.data[i + 1] - db.data[i + 1]),
          Math.abs(da.data[i + 2] - db.data[i + 2]),
        );
        maxDelta = Math.max(maxDelta, delta);
        const grey = (da.data[i] + da.data[i + 1] + da.data[i + 2]) / 3;
        const hit = delta > tolerance;
        if (hit) {
          differing += 1;
          const x = (i / 4) % canvas.width;
          const y = Math.floor(i / 4 / canvas.width);
          box.x0 = Math.min(box.x0, x);
          box.y0 = Math.min(box.y0, y);
          box.x1 = Math.max(box.x1, x);
          box.y1 = Math.max(box.y1, y);
        }
        view.data[i] = hit ? 255 : grey * 0.35 + 140;
        view.data[i + 1] = hit ? 30 : grey * 0.35 + 140;
        view.data[i + 2] = hit ? 30 : grey * 0.35 + 140;
        view.data[i + 3] = 255;
      }
      g.putImageData(view, 0, 0);
      return {
        share: differing / (da.data.length / 4),
        differing,
        maxDelta,
        /** Bounding box of differing pixels, CSS px of the clip. */
        box: differing ? { x: box.x0 / 2, y: box.y0 / 2, width: (box.x1 - box.x0 + 1) / 2, height: (box.y1 - box.y0 + 1) / 2 } : null,
        image: canvas.toDataURL('image/png').split(',')[1],
      };
    },
    { a: a.toString('base64'), b: b.toString('base64'), tolerance: TOLERANCE },
  );
  await page.close();
  return result;
}

/** One sheet per theme: real | puppet | overlay (50%) | diff, a row per case. */
async function sheet(context, theme, rows) {
  const page = await context.newPage();
  const cell = (data, label, extra = '') =>
    `<figure><div class="frame" ${extra}><img src="data:image/png;base64,${data}"></div><figcaption>${label}</figcaption></figure>`;
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:24px;font:13px/1.4 system-ui;background:${theme === 'dark' ? '#05080f' : '#fff'};color:${theme === 'dark' ? '#ddd' : '#222'}}
    h2{margin:24px 0 8px;font-size:15px} .row{display:grid;grid-template-columns:repeat(4,${CLIP.width}px);gap:12px}
    figure{margin:0} img{display:block;width:${CLIP.width}px} .frame{position:relative}
    .overlay img + img{position:absolute;inset:0;opacity:.5} figcaption{opacity:.7;margin-top:4px}
  </style>${rows
    .map(
      (row) => `<h2>${row.name} · ${theme} · ${(row.share * 100).toFixed(2)}% px differ</h2><div class="row">
      ${cell(row.real, 'real Cloudlet')}${cell(row.puppet, 'puppet')}
      <figure><div class="frame overlay"><img src="data:image/png;base64,${row.real}"><img src="data:image/png;base64,${row.puppet}"></div><figcaption>overlay 50/50</figcaption></figure>
      ${cell(row.diff, `diff (red: Δ > ${TOLERANCE})`)}</div>`,
    )
    .join('')}`;
  await page.setViewportSize({ width: CLIP.width * 4 + 36 + 48, height: 400 });
  await page.setContent(html);
  await page.screenshot({ path: join(out, `sheet-${theme}.png`), fullPage: true });
  await page.close();
}

for (const theme of THEMES) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    reducedMotion: 'reduce',
    colorScheme: theme,
  });
  const rows = [];
  for (const name of cases) {
    const real = await shoot(context, name, theme, 'real');
    const puppet = await shoot(context, name, theme, 'puppet');
    const result = await diff(context, real.png, puppet.png);
    writeFileSync(join(out, `${name}-${theme}-real.png`), real.png);
    writeFileSync(join(out, `${name}-${theme}-puppet.png`), puppet.png);
    writeFileSync(join(out, `${name}-${theme}-diff.png`), Buffer.from(result.image, 'base64'));
    rows.push({ name, share: result.share, real: real.png.toString('base64'), puppet: puppet.png.toString('base64'), diff: result.image });
    report.results.push({ case: name, theme, share: result.share, differing: result.differing, maxDelta: result.maxDelta, box: result.box, errors: [...real.errors, ...puppet.errors] });
    console.log(`${name.padEnd(14)} ${theme.padEnd(5)} ${(result.share * 100).toFixed(3)}% differ`);
  }
  await sheet(context, theme, rows);
  await context.close();
}

writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
server?.close();
