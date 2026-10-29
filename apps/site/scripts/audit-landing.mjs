#!/usr/bin/env node
/**
 * axe on the static export of the landing: `/`, `/playground` and `/frame`,
 * desktop 1440×900 and phone 390×844, light and dark, with motion and with reduced motion.
 * Scenes are pinned and fade text in and out, so the home page is checked at every section
 * and at points inside scenes 2 and 3, not only at the top. Text caught mid-fade (opacity
 * between 0 and 1 along its ancestors) is a passing frame, not a resting state: it is
 * excluded from that check and counted in the report.
 *
 *   npm run build && npm run build:site
 *   node apps/site/scripts/audit-landing.mjs <out-dir> [--base URL] [--browser chromium|firefox|webkit] [scenario ...]
 *
 * Besides axe, on `/` and `/playground`: a keyboard pass (Tab from the top until focus leaves the
 * page or cycles; every stop must show a focus ring and be scrolled into view) and, with reduced
 * motion, the still layout (no Lenis, no pin spacers, sky and scenes untransformed).
 *
 * Writes axe-<browser>.json; exits 1 on any violation, keyboard or reduced-motion failure, or console error.
 */
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, firefox, webkit } from '@playwright/test';
import { serve } from './serve-out.mjs';

const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };
const SCENARIOS = {};
for (const [device, context] of Object.entries({ desktop: DESKTOP, phone: PHONE })) {
  for (const colorScheme of ['light', 'dark']) {
    SCENARIOS[`${device}-${colorScheme}`] = { ...context, colorScheme };
    SCENARIOS[`${device}-${colorScheme}-reduced`] = { ...context, colorScheme, reducedMotion: 'reduce' };
  }
}
/** Fractions of a pinned scene's scroll range to check, besides each section's top. */
const SCENE_POINTS = [0.1, 0.3, 0.5, 0.7, 0.9];

const args = process.argv.slice(2);
const baseFlag = args.indexOf('--base');
const external = baseFlag >= 0 ? args.splice(baseFlag, 2)[1] : null;
const browserFlag = args.indexOf('--browser');
const engine = { chromium, firefox, webkit }[browserFlag >= 0 ? args.splice(browserFlag, 2)[1] : 'chromium'];
const [outDir, ...only] = args;
if (!outDir) {
  console.error('Usage: node apps/site/scripts/audit-landing.mjs <out-dir> [--base URL] [scenario ...]');
  process.exit(2);
}
const out = resolve(outDir);
mkdirSync(out, { recursive: true });
const server = external ? null : await serve();
const base = external ?? `http://127.0.0.1:${server.address().port}`;

const scrollTo = (page, y) =>
  page.evaluate(async (top) => {
    window.scrollTo({ top, behavior: 'instant' });
    // Long enough for scene 2's snap (delay 0.15 s + up to 0.8 s) to come to rest.
    await new Promise((done) => setTimeout(done, 1800));
  }, y);

/** Positions to audit on the home page: each section's top plus points inside the pinned scenes. */
const homeStops = (page) =>
  page.evaluate((points) => {
    const stops = [];
    for (const section of document.querySelectorAll('main > section, footer')) {
      const top = section.getBoundingClientRect().top + window.scrollY;
      const label = section.id || section.tagName.toLowerCase();
      stops.push({ label, y: Math.max(0, top - 80) });
      const range = section.offsetHeight - window.innerHeight;
      if (range > window.innerHeight) for (const p of points) stops.push({ label: `${label}@${p}`, y: top + range * p });
    }
    return stops;
  }, SCENE_POINTS);

/** Marks text whose effective opacity is strictly between 0 and 1; returns where it sits (aria-hidden counts as decorative). */
const markFading = (page) =>
  page.evaluate(() => {
    const where = new Set();
    for (const element of document.querySelectorAll('[data-audit-fading]')) element.removeAttribute('data-audit-fading');
    for (const element of document.querySelectorAll('main *')) {
      let opacity = 1;
      for (let node = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      if (opacity > 0.01 && opacity < 0.99 && element.childElementCount === 0 && element.textContent?.trim()) {
        element.setAttribute('data-audit-fading', '');
        const owner = element.closest('[aria-hidden="true"]') ? 'decorative' : (element.closest('[class]')?.className.split(' ')[0] ?? '?');
        where.add(owner);
      }
    }
    return [...where];
  });

async function axe(page) {
  const audit = await new AxeBuilder({ page }).exclude('[data-audit-fading]').analyze();
  return audit.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => ({ target: node.target.join(' '), summary: node.failureSummary?.split('\n').slice(1).join(' ').trim() })),
  }));
}

/** Safari (and WebKit) tab only to controls by default; Option+Tab reaches links too. */
const TAB = engine === webkit ? 'Alt+Tab' : 'Tab';

/** Tab through `path` from the top; returns the stops and the failures among them. */
async function keyboard(page, path) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const stops = [];
  const failures = [];
  for (let index = 0; index < 120; index += 1) {
    await page.keyboard.press(TAB);
    await page.waitForTimeout(250);
    const stop = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      // An element focused twice ends the pass: focus cycled, or it left for the browser's own UI
      // and the page kept its activeElement (Firefox).
      if (element.hasAttribute('data-audit-seen')) return null;
      element.setAttribute('data-audit-seen', '');
      const style = getComputedStyle(element);
      const ring = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
      const box = element.getBoundingClientRect();
      const name = (element.getAttribute('aria-label') ?? element.getAttribute('title') ?? element.textContent ?? '').trim().replace(/\s+/gu, ' ');
      return {
        name: `${element.tagName.toLowerCase()} "${name.slice(0, 40)}"`,
        frame: element.tagName === 'IFRAME',
        ring,
        inView: box.bottom > 0 && box.top < window.innerHeight && box.width > 0,
        hidden: box.width === 0 && box.height === 0,
      };
    });
    if (!stop) break;
    stops.push(stop);
    // The hero screen is one stop: its own controls take focus inside the frame.
    if (!stop.frame && !stop.hidden && (!stop.ring || !stop.inView)) failures.push(stop);
    if (stop.frame) {
      // Leave the frame: Tab past its controls (bounded) until focus is back in the page.
      for (let inner = 0; inner < 20; inner += 1) {
        const back = await page.evaluate(() => document.activeElement?.tagName !== 'IFRAME');
        if (back) break;
        await page.keyboard.press(TAB);
      }
    }
  }
  if (stops.length >= 120) failures.push({ name: 'no end after 120 stops (focus trap?)' });
  return { stops: stops.length, failures };
}

/** The still layout under reduced motion. */
const stillLayout = (page) =>
  page.evaluate(() => ({
    lenis: document.documentElement.classList.contains('lenis'),
    pinSpacers: document.querySelectorAll('.pin-spacer').length,
    moved: [...document.querySelectorAll('[data-depth], .life-pin, .drift-layer')].filter((element) => {
      const transform = getComputedStyle(element).transform;
      return transform !== 'none' && transform !== 'matrix(1, 0, 0, 1, 0, 0)';
    }).length,
  }));

const browser = await engine.launch();
const report = {};
let failed = false;
try {
  for (const [name, options] of Object.entries(SCENARIOS)) {
    if (only.length && !only.includes(name)) continue;
    // Firefox has no mobile emulation: its phone scenarios are a narrow touch window.
    const context = await browser.newContext(engine === firefox ? { ...options, isMobile: undefined } : options);
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    page.on('pageerror', (error) => errors.push(String(error)));
    const entry = (report[name] = { errors, checks: [] });
    for (const path of ['/toaster', '/toaster/playground', '/toaster/frame']) {
      await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      const stops = path === '/toaster' ? await homeStops(page) : [{ label: 'top', y: 0 }];
      for (const stop of stops) {
        await scrollTo(page, stop.y);
        const fading = await markFading(page);
        const violations = await axe(page);
        entry.checks.push({ path, at: stop.label, fading, violations });
        if (violations.length) failed = true;
      }
    }
    entry.keyboard = {};
    for (const path of ['/toaster', '/toaster/playground']) {
      entry.keyboard[path] = await keyboard(page, path);
      if (entry.keyboard[path].failures.length) failed = true;
    }
    if (options.reducedMotion === 'reduce') {
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await scrollTo(page, 3000);
      entry.still = await stillLayout(page);
      if (entry.still.lenis || entry.still.pinSpacers || entry.still.moved) failed = true;
    }
    if (errors.length) failed = true;
    await context.close();
    const bad = entry.checks.filter((check) => check.violations.length);
    const fading = [...new Set(entry.checks.flatMap((check) => check.fading))];
    const keys = Object.entries(entry.keyboard).map(([path, pass]) => `${path} ${pass.stops} tab stops, ${pass.failures.length} failing`);
    console.log(
      `${name}: ${entry.checks.length} checks, ${bad.length} with violations (mid-fade text skipped in: ${fading.join(', ') || 'none'}); ${keys.join('; ')}; ${errors.length} console errors` +
        (entry.still ? `; still layout ${JSON.stringify(entry.still)}` : ''),
    );
    for (const [path, pass] of Object.entries(entry.keyboard)) for (const stop of pass.failures) console.log(`  keyboard ${path}: ${JSON.stringify(stop)}`);
    for (const check of bad)
      for (const violation of check.violations)
        console.log(`  ${check.path} ${check.at}: ${violation.id} — ${violation.nodes.map((node) => node.target).join(', ')}`);
  }
} finally {
  await browser.close();
  server?.close();
}
writeFileSync(join(out, `axe-${engine.name()}.json`), JSON.stringify(report, null, 2) + '\n');
process.exit(failed ? 1 : 0);
