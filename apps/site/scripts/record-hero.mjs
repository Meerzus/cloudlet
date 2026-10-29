#!/usr/bin/env node
/**
 * Records the hero in headless Chromium against the static export (the desktop-app
 * browser pane throttles requestAnimationFrame, so motion is judged from these videos).
 *
 *   npm run build && npm run build:site
 *   node apps/site/scripts/record-hero.mjs <out-dir> [scenario ...]
 *
 * Writes <scenario>.webm, a few PNG stills and report.json (console errors, timings).
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { serve } from './serve-out.mjs';

const wait = (page, ms) => page.waitForTimeout(ms);
const toDevice = (page) => page.locator('.hero-device').scrollIntoViewIfNeeded();

/** Wheels over the device screen and reports how far the page scrolled (it must not be swallowed). */
async function wheelOverDevice(page) {
  const box = await page.locator('.dv-live .dv-screen').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await page.evaluate(() => window.scrollY);
  for (let step = 0; step < 5; step += 1) {
    await page.mouse.wheel(0, 100);
    await wait(page, 50);
  }
  await wait(page, 1200);
  const after = await page.evaluate(() => window.scrollY);
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), before);
  await wait(page, 600);
  return after - before;
}

/** Each scenario drives the page like a visitor; `still` saves a PNG at that moment. */
const SCENARIOS = {
  'desktop-light': {
    context: { viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
    async run(page, still, notes) {
      await toDevice(page);
      await wait(page, 4200);
      await still('stack');
      await wait(page, 1700);
      await still('island');
      await wait(page, 6400);
      await still('done');
      await page.getByRole('button', { name: 'Phone', exact: true }).click();
      await wait(page, 1600);
      await still('mobile');
      // Switching the device starts the intro there: the Island is open 4.2–8.1 s into a run.
      await wait(page, 4400);
      await still('mobile-island');
      await wait(page, 4000);
      await page.getByRole('button', { name: 'Laptop', exact: true }).click();
      await wait(page, 1600);
      notes.wheelScroll = await wheelOverDevice(page);
    },
  },
  'desktop-dark': {
    context: { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
    async run(page, still) {
      await toDevice(page);
      await wait(page, 5900);
      await still('island');
      await wait(page, 6400);
      await still('done');
      await page.getByRole('button', { name: 'Phone', exact: true }).click();
      await wait(page, 1600);
      await still('mobile');
    },
  },
  'mobile-mockup': {
    context: { viewport: { width: 1280, height: 860 }, colorScheme: 'light' },
    async run(page, still, notes) {
      await page.getByRole('button', { name: 'Phone', exact: true }).click();
      await toDevice(page);
      await wait(page, 4200);
      await still('stack');
      await wait(page, 1700);
      await still('island');
      await wait(page, 6400);
      await still('done');
      notes.wheelScroll = await wheelOverDevice(page);
    },
  },
  'mobile-mockup-dark': {
    context: { viewport: { width: 1280, height: 860 }, colorScheme: 'dark' },
    async run(page, still) {
      await page.getByRole('button', { name: 'Phone', exact: true }).click();
      await toDevice(page);
      await wait(page, 5900);
      await still('island');
      await wait(page, 6400);
      await still('done');
    },
  },
  foldable: {
    context: { viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
    async run(page, still, notes) {
      await page.getByRole('button', { name: 'Foldable', exact: true }).click();
      await toDevice(page);
      await wait(page, 13000);
      await still('closed');
      await page.getByRole('button', { name: 'Unfold', exact: true }).click();
      await wait(page, 400);
      await still('unfolding');
      await wait(page, 1200);
      await still('open');
      const frame = page.frames().find((candidate) => candidate.url().includes('device=foldable'));
      notes.openViewport = await frame?.evaluate(() => `${innerWidth}x${innerHeight}`);
      await page.getByRole('button', { name: 'Fold', exact: true }).click();
      await wait(page, 1600);
      await page.getByRole('button', { name: 'Tablet', exact: true }).click();
      await wait(page, 1600);
      await still('tablet');
    },
  },
  'foldable-dark': {
    context: { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
    async run(page, still) {
      await page.getByRole('button', { name: 'Foldable', exact: true }).click();
      await toDevice(page);
      await wait(page, 6000);
      await page.getByRole('button', { name: 'Unfold', exact: true }).click();
      await wait(page, 1600);
      await still('open');
      await wait(page, 5000);
      await page.getByRole('button', { name: 'Tablet', exact: true }).click();
      await wait(page, 1600);
      await still('tablet');
    },
  },
  'phone-visitor': {
    context: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: 'light',
    },
    async run(page, still) {
      await wait(page, 4200);
      await still('stack');
      await wait(page, 1700);
      await still('island');
      await wait(page, 6400);
      await still('done');
    },
  },
  'reduced-motion': {
    context: { viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' },
    async run(page, still) {
      await toDevice(page);
      await wait(page, 12500);
      await page.getByRole('button', { name: 'Phone', exact: true }).click();
      await wait(page, 90);
      await still('fade-mid');
      await wait(page, 900);
      await still('mobile');
    },
  },
};

const out = resolve(process.argv[2] ?? 'artifacts/landing-02');
const names = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(SCENARIOS);
mkdirSync(out, { recursive: true });
const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const report = {};

for (const name of names) {
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`Unknown scenario ${name}`);
  const dir = join(out, `${name}-video`);
  const context = await browser.newContext({
    ...scenario.context,
    recordVideo: { dir, size: scenario.context.viewport },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await page.goto(`${origin}/toaster`, { waitUntil: 'load' });
  const still = (label) => page.screenshot({ path: join(out, `${name}-${label}.png`) });
  const notes = {};
  await scenario.run(page, still, notes);
  const frames = page.frames().length - 1;
  const video = page.video();
  await context.close();
  if (video) renameSync(await video.path(), join(out, `${name}.webm`));
  report[name] = { errors, frames, ...notes };
  console.log(name, errors.length ? errors : 'no console errors', `iframes: ${frames}`, JSON.stringify(notes));
}

await browser.close();
server.close();
writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
