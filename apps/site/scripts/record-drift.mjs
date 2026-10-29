#!/usr/bin/env node
/**
 * Records the seam of scene 2 → scene 3 ("Drifting by") in headless Chromium: from scene 2's
 * last plateau, trackpad-like flicks forward through the volley, the title, all six benefits and
 * their stories into Get started, then back until the volley has unwound. Scene 2 snaps, so its
 * stops must rest on a label; scene 3 has no snap, so its stops should land in a
 * rest of its timeline (`data-rests`, nothing moves there) — the report gives the share.
 * Frame intervals (rAF) and long tasks are collected while scrolling; `--no-video` measures
 * without the recorder's own load. `--frames` instead shoots scene 3 at every rest and between
 * them (a storyboard for review), without flicks.
 *
 *   npm run build && npm run build:site
 *   node apps/site/scripts/record-drift.mjs <out-dir> [--base http://127.0.0.1:3000] [--no-video] [--frames] [scenario ...]
 *
 * Writes <scenario>.webm, a PNG per stop (or per storyboard frame) and report.json.
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
const flag = (name) => {
  const index = args.indexOf(name);
  if (index >= 0) args.splice(index, 1);
  return index >= 0;
};
const base = option('--base');
const frames = flag('--frames');
const video = !frames && !flag('--no-video');
const out = resolve(args.shift() ?? 'artifacts/landing-04/drift');
const names = args.length ? args : Object.keys(SCENARIOS);
mkdirSync(out, { recursive: true });

const server = base ? null : await serve();
const origin = base ?? `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const report = { origin, video, scenarios: {} };

/** One trackpad flick: ~0.5 s of wheel events whose deltas decay like macOS momentum. */
async function flick(page, direction, strength) {
  let delta = strength;
  for (let step = 0; step < 32 && Math.abs(delta) > 0.5; step += 1) {
    await page.mouse.wheel(0, direction * delta);
    await page.waitForTimeout(16);
    delta *= 0.86;
  }
}

/** Where the page rests: each pinned timeline's position and nearest label, the volley and the layer. */
const state = (page) =>
  page.evaluate(() => {
    const read = (selector) => {
      const pin = document.querySelector(selector);
      if (!pin) return null;
      const t = Number(pin.dataset.t);
      const labels = Object.entries(JSON.parse(pin.dataset.labels ?? '{}'));
      const [label, at] = labels.reduce((best, entry) => (Math.abs(entry[1] - t) < Math.abs(best[1] - t) ? entry : best), labels[0]);
      const rests = pin.dataset.rests ? JSON.parse(pin.dataset.rests) : null;
      const rest = rests ? rests.some(([from, to]) => t >= from - 0.02 && t <= to + 0.02) : null;
      return { t, label, off: Math.abs(at - t), rest, pinned: Math.abs(pin.getBoundingClientRect().top) < 1 };
    };
    const layer = document.querySelector('.drift-layer');
    const started = document.querySelector('#get-started')?.getBoundingClientRect().top ?? Infinity;
    return {
      y: Math.round(window.scrollY),
      life: read('.life-pin'),
      drift: read('.drift-pin'),
      volley: Number(layer?.dataset.volley ?? 0),
      layer: layer ? { visible: layer.style.visibility === 'visible', opacity: Number(layer.style.opacity || 0) } : null,
      getStarted: started < window.innerHeight * 0.5,
    };
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
    ...(video ? { recordVideo: { dir, size: scenario.viewport } } : {}),
  });
  await context.addInitScript((theme) => {
    localStorage.setItem('cloudlet-site-theme', theme);
    // Frame intervals while `window.__measure` is on, and every long task.
    window.__frames = [];
    window.__longTasks = [];
    let last = 0;
    const tick = (now) => {
      if (window.__measure && last) window.__frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (window.__measure) window.__longTasks.push(Math.round(entry.duration));
    }).observe({ type: 'longtask', buffered: false });
  }, scenario.theme);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => (message.type() === 'error' || message.type() === 'warning') && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${origin}/toaster`);
  await page.waitForTimeout(1500);
  const stops = [];

  if (frames && !scenario.reduced) {
    // Storyboard: the middle of every rest, plus a frame halfway to the next one.
    const shots = await page.evaluate(() => {
      const pin = document.querySelector('.drift-pin');
      const rests = JSON.parse(pin.dataset.rests);
      const at = [];
      rests.forEach(([from, to], index) => {
        at.push((from + to) / 2);
        const next = rests[index + 1];
        if (next) at.push((to + next[0]) / 2);
      });
      return at;
    });
    const go = (t) =>
      page.evaluate((time) => {
        const spacer = document.querySelector('.drift-pin').parentElement;
        const top = spacer.getBoundingClientRect().top + window.scrollY;
        const labels = JSON.parse(document.querySelector('.drift-pin').dataset.labels);
        const length = spacer.offsetHeight - window.innerHeight;
        window.scrollTo(0, top + (time / labels.end) * length);
      }, t);
    // Walk in: the volley has to be scrubbed through first.
    await go(0);
    await page.waitForTimeout(1500);
    for (const [index, t] of shots.entries()) {
      await go(t);
      await page.waitForTimeout(1300);
      const now = await state(page);
      await page.screenshot({ path: join(out, `${name}-frame-${String(index).padStart(3, '0')}-t${now.drift.t.toFixed(1)}.png`) });
      stops.push({ t, at: now.drift.t, rest: now.drift.rest });
    }
    report.scenarios[name] = { frames: stops.length, errors };
    console.log(`${name}: ${stops.length} storyboard frames, ${errors.length} console errors`);
  } else if (scenario.reduced) {
    await page.locator('#drifting').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `${name}-drifting.png`) });
    await page.locator('#get-started').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `${name}-get-started.png`) });
    report.scenarios[name] = {
      benefits: await page.locator('.benefit-static').count(),
      pinned: await page.locator('.drift-pin').count(),
      layer: await page.locator('.drift-layer').count(),
      errors,
    };
    console.log(`${name}: ${JSON.stringify(report.scenarios[name])}`);
  } else {
    // Arrive at scene 2's last plateau ("drift"): the volley launches from the next flick.
    const target = await page.evaluate(() => {
      const pin = document.querySelector('.life-pin');
      const labels = JSON.parse(pin.dataset.labels);
      const top = pin.getBoundingClientRect().top + window.scrollY;
      return top + (labels.drift / labels.end) * window.innerHeight * 8;
    });
    await page.evaluate((y) => window.scrollTo(0, y), target);
    await page.waitForTimeout(2500);
    const box = scenario.viewport;
    await page.mouse.move(box.width / 2, box.height / 2);
    let index = 0;
    const settle = async (direction) => {
      await page.waitForTimeout(2400);
      const now = await state(page);
      // Scene 2 must rest on a label (snap); scene 3 should rest in a rest (no snap); between the pins anything goes.
      const pinned = now.life?.pinned ? now.life : now.drift?.pinned ? now.drift : null;
      const where = pinned === now.life ? `life:${pinned.label}` : pinned ? `drift:${pinned.label}@${pinned.t.toFixed(1)}` : now.getStarted ? 'get-started' : 'between';
      const stop = { direction, ...now, where, offLabel: pinned === now.life ? pinned.off : 0, moving: pinned === now.drift ? !pinned.rest : false };
      stops.push(stop);
      await page.screenshot({ path: join(out, `${name}-${String(index).padStart(3, '0')}-${direction}-${stop.where.replace(/[:@]/g, '-')}.png`) });
      index += 1;
      return stop;
    };
    await page.evaluate(() => (window.__measure = true));
    for (let guard = 0; guard < 160; guard += 1) {
      await flick(page, 1, scenario.mobile ? 34 : 26);
      const stop = await settle('down');
      if (stop.getStarted) break;
    }
    for (let guard = 0; guard < 160; guard += 1) {
      await flick(page, -1, scenario.mobile ? 34 : 26);
      const stop = await settle('up');
      if (stop.life?.pinned && stop.life.label === 'drift' && stop.volley === 0) break;
    }
    const perf = await page.evaluate(() => {
      window.__measure = false;
      const frames = [...window.__frames].sort((a, b) => a - b);
      const at = (q) => frames[Math.min(frames.length - 1, Math.floor(q * frames.length))] ?? 0;
      return {
        frames: frames.length,
        p50: Math.round(at(0.5) * 10) / 10,
        p95: Math.round(at(0.95) * 10) / 10,
        p99: Math.round(at(0.99) * 10) / 10,
        over25: frames.filter((frame) => frame > 25).length,
        longTasks: window.__longTasks,
      };
    });
    const stuck = stops.filter((stop) => stop.offLabel > 0.02);
    const inDrift = stops.filter((stop) => stop.drift?.pinned);
    const resting = inDrift.filter((stop) => !stop.moving).length;
    const restShare = inDrift.length ? Math.round((resting / inDrift.length) * 100) : 100;
    const launched = stops.some((stop) => stop.volley === 1);
    report.scenarios[name] = { stops, stuck: stuck.length, restShare, launched, perf, errors };
    console.log(`${name}: ${stops.length} stops, ${stuck.length} off-label in scene 2, ${restShare}% of scene 3 stops at rest, volley ${launched ? 'landed' : 'MISSING'}, ${errors.length} console errors`);
    console.log('  ' + stops.map((stop) => `${stop.direction === 'down' ? '↓' : '↑'}${stop.where}${stop.offLabel > 0.02 || stop.moving ? '(!)' : ''}`).join(' '));
    console.log(`  frames p50 ${perf.p50} ms, p95 ${perf.p95} ms, p99 ${perf.p99} ms, >25 ms: ${perf.over25}/${perf.frames}; long tasks: ${perf.longTasks.length ? perf.longTasks.join(', ') + ' ms' : 'none'}`);
  }

  await page.close();
  await context.close();
  const recorded = video ? await page.video()?.path() : null;
  if (recorded && existsSync(recorded)) renameSync(recorded, join(out, `${name}.webm`));
}

writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
server?.close();
