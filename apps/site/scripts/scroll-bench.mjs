#!/usr/bin/env node
/**
 * Scrolls pages of the static export with a wheel in headless Chromium without a GPU (software
 * compositing, CPU ×4 slower, 1440×900 at 2×) — a stand-in for a laptop on integrated graphics —
 * and prints how long the frames took. Backdrop filters over a fixed sky show up here first: a
 * frame over 33 ms is one the screen missed at 60 Hz. A measurement, not a test: it never fails.
 *
 *   npm run build && npm run build:site
 *   node apps/site/scripts/scroll-bench.mjs [path ...]   (default: /toaster/playground /toaster)
 */
import { chromium } from '@playwright/test';
import { serve } from './serve-out.mjs';

const PATHS = process.argv.slice(2).length ? process.argv.slice(2) : ['/toaster/playground', '/toaster'];
const SLOW_MS = 33;

/** Wheel down and back up twice, as a trackpad would: small steps, one per frame. */
async function scroll(page) {
  await page.mouse.move(720, 450);
  for (let pass = 0; pass < 2; pass++) {
    for (const direction of [1, -1]) {
      for (let step = 0; step < 25; step++) {
        await page.mouse.wheel(0, direction * 60);
        await page.waitForTimeout(16);
      }
      await page.waitForTimeout(600);
    }
  }
}

async function measure(browser, base, path) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  await page.goto(base + path, { waitUntil: 'networkidle' });
  // The motion runtime (Lenis, ScrollTrigger) loads after the first paint.
  await page.waitForTimeout(1500);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(() => {
    const frames = (window.__frames = []);
    let last = performance.now();
    const tick = (time) => {
      frames.push(time - last);
      last = time;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await scroll(page);
  const frames = (await page.evaluate(() => window.__frames)).slice(5).sort((a, b) => a - b);
  await context.close();
  const at = (quantile) => frames[Math.min(frames.length - 1, Math.floor(frames.length * quantile))].toFixed(1);
  return { path, frames: frames.length, p50: at(0.5), p90: at(0.9), p99: at(0.99), slow: frames.filter((ms) => ms > SLOW_MS).length };
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--disable-gpu'] });
try {
  for (const path of PATHS) {
    const { frames, p50, p90, p99, slow } = await measure(browser, base, path);
    console.log(`${path}: ${frames} frames, p50 ${p50} ms, p90 ${p90} ms, p99 ${p99} ms, over ${SLOW_MS} ms: ${slow}`);
  }
} finally {
  await browser.close();
  server.close();
}
