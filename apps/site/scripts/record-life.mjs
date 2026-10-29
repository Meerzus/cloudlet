#!/usr/bin/env node
/**
 * Records scene 2 ("Life of a notification") in headless Chromium: trackpad-like wheel
 * gestures (a burst with decaying momentum) forward through every plateau and back,
 * on desktop (Lenis) and phone (native scroll), light and dark. After each gesture it
 * waits for scrub + snap to settle and checks that the timeline rests on a label —
 * the scene must never stay in an in-between frame.
 *
 *   npm run build && npm run build:site
 *   node apps/site/scripts/record-life.mjs <out-dir> [--base http://127.0.0.1:3000] [scenario ...]
 *
 * Writes <scenario>.webm, a PNG per stop and report.json.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { serve } from './serve-out.mjs';

const SCENARIOS = {
  'desktop-light': { viewport: { width: 1440, height: 900 }, theme: 'light' },
  'desktop-dark': { viewport: { width: 1440, height: 900 }, theme: 'dark' },
  'phone-light': { viewport: { width: 390, height: 844 }, theme: 'light', mobile: true },
  'phone-dark': { viewport: { width: 390, height: 844 }, theme: 'dark', mobile: true },
  reduced: { viewport: { width: 1280, height: 800 }, theme: 'light', reduced: true },
};

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args.splice(index, 2)[1] : null;
};
const base = option('--base');
const out = resolve(args.shift() ?? 'artifacts/landing-03/life');
const names = args.length ? args : Object.keys(SCENARIOS);
mkdirSync(out, { recursive: true });

const server = base ? null : await serve();
const origin = base ?? `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const report = { origin, scenarios: {} };

/** One trackpad flick: ~0.5 s of wheel events whose deltas decay like macOS momentum. */
async function flick(page, direction, strength) {
  let delta = strength;
  for (let step = 0; step < 32 && Math.abs(delta) > 0.5; step += 1) {
    await page.mouse.wheel(0, direction * delta);
    await page.waitForTimeout(16);
    delta *= 0.86;
  }
}

const state = (page) =>
  page.evaluate(() => {
    const pin = document.querySelector('.life-pin');
    return pin ? { t: Number(pin.dataset.t), labels: JSON.parse(pin.dataset.labels ?? '{}'), y: window.scrollY } : null;
  });

for (const name of names) {
  const scenario = SCENARIOS[name];
  const dir = join(out, `${name}-video`);
  const context = await browser.newContext({
    viewport: scenario.viewport,
    deviceScaleFactor: 1,
    colorScheme: scenario.theme,
    reducedMotion: scenario.reduced ? 'reduce' : 'no-preference',
    isMobile: Boolean(scenario.mobile),
    hasTouch: Boolean(scenario.mobile),
    recordVideo: { dir, size: scenario.viewport },
  });
  await context.addInitScript((theme) => localStorage.setItem('cloudlet-site-theme', theme), scenario.theme);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => (message.type() === 'error' || message.type() === 'warning') && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${origin}/toaster`);
  await page.waitForTimeout(1200);
  const stops = [];

  if (scenario.reduced) {
    await page.locator('#life').scrollIntoViewIfNeeded();
    const rows = await page.locator('.life-sequence-row').count();
    for (let index = 0; index < rows; index += 1) {
      await page.locator('.life-sequence-row').nth(index).scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
    }
    await page.screenshot({ path: join(out, `${name}-sequence.png`), fullPage: false });
    report.scenarios[name] = { rows, pinned: await page.locator('.life-pin').count(), errors };
  } else {
    // Arrive just above the pinned section, then move with gestures only.
    const top = await page.evaluate(() => document.querySelector('.life-pin').getBoundingClientRect().top + window.scrollY);
    await page.evaluate((y) => window.scrollTo(0, y), top);
    await page.waitForTimeout(800);
    const box = scenario.viewport;
    await page.mouse.move(box.width / 2, box.height / 2);
    let label = 0;
    const settle = async (direction) => {
      await page.waitForTimeout(2200);
      const now = await state(page);
      const entries = Object.entries(now.labels);
      const nearest = entries.reduce((best, entry) => (Math.abs(entry[1] - now.t) < Math.abs(best[1] - now.t) ? entry : best), entries[0]);
      const pinned = await page.evaluate(() => {
        const rect = document.querySelector('.life-pin').getBoundingClientRect();
        return Math.abs(rect.top) < 1;
      });
      const stop = { direction, t: now.t, label: nearest[0], offLabel: Math.abs(nearest[1] - now.t), pinned, y: now.y };
      stops.push(stop);
      await page.screenshot({ path: join(out, `${name}-${String(label).padStart(2, '0')}-${direction}-${nearest[0]}.png`) });
      label += 1;
      return stop;
    };
    // Forward: one modest flick per plateau until the scene has ended.
    for (let guard = 0; guard < 16; guard += 1) {
      await flick(page, 1, scenario.mobile ? 34 : 26);
      const stop = await settle('down');
      if (stop.label === 'end') break;
    }
    // Back: the same in reverse until the scene start.
    for (let guard = 0; guard < 16; guard += 1) {
      await flick(page, -1, scenario.mobile ? 34 : 26);
      const stop = await settle('up');
      if (stop.label === 'start') break;
    }
    const stuck = stops.filter((stop) => stop.pinned && stop.offLabel > 0.02);
    report.scenarios[name] = { stops, stuck: stuck.length, errors };
    console.log(`${name}: ${stops.length} stops, ${stuck.length} off-label, ${errors.length} console errors`);
    console.log('  ' + stops.map((stop) => `${stop.direction === 'down' ? '↓' : '↑'}${stop.label}${stop.offLabel > 0.02 ? `(!${stop.t})` : ''}`).join(' '));
  }

  await page.close();
  await context.close();
  const video = await page.video()?.path();
  if (video && existsSync(video)) renameSync(video, join(out, `${name}.webm`));
}

writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
server?.close();
