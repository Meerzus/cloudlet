#!/usr/bin/env node
/**
 * axe on the static export of the landings: the kit's `/`, the Toaster's `/toaster` and `/toaster/frame`,
 * `/color-picker` and its docs,
 * desktop 1440×900 and phone 390×844, light and dark, with motion and with reduced motion.
 * Scenes are pinned and fade text in and out, so the component landings are checked at every section
 * and at points inside scenes 2 and 3, not only at the top. Text caught mid-fade (opacity
 * between 0 and 1 along its ancestors) is a passing frame, not a resting state: it is
 * excluded from that check and counted in the report.
 *
 *   npm run build && npm run build:site
 *   node apps/site/scripts/audit-landing.mjs <out-dir> [--base URL] [--browser chromium|firefox|webkit] [scenario ...]
 *
 * Besides axe, on `/`, `/toaster`, `/color-picker` and its docs: a keyboard pass (Tab from the top until focus leaves the
 * page or cycles; every stop must show a focus ring and be scrolled into view) and, with reduced
 * motion, the still layout of `/` and `/toaster` (no Lenis, no pin spacers, sky and scenes untransformed).
 * The kit's `/` is checked at every section, then with each of its live places open (KIT_LIVE). On
 * the phone, every page is also loaded 320 px wide and must not scroll sideways.
 *
 * WebKit on Linux runs without WebGL 2 (its software WebGL runs out of memory on the paint): the pages show
 * their fallback there; Safari on a Mac draws the paint. It also leaves out /color-picker (see PAGES).
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
    // The color picker landing wraps its neutral sections in a tinted block.
    for (const section of document.querySelectorAll('main > section, footer')) {
      const top = section.getBoundingClientRect().top + window.scrollY;
      const label = section.id || section.tagName.toLowerCase();
      stops.push({ label, y: Math.max(0, top - 80) });
      const range = section.offsetHeight - window.innerHeight;
      if (range > window.innerHeight) for (const p of points) stops.push({ label: `${label}@${p}`, y: top + range * p });
    }
    return stops;
  }, SCENE_POINTS);

/**
 * Live places on the kit's landing, checked after its sections: each opens what the visitor would open
 * (a notification from the hero's Toaster, in the scene and from the live code, a picker's panel in the
 * comparisons, a theme, an answer) and is checked open, in page order on one load of the page.
 */
const KIT_LIVE = [
  { label: 'hero toast sent', click: '#hero .kh-send', wait: 1600 },
  { label: 'hero loading sent', click: ['#hero .kh-kind[data-kind="loading"]', '#hero .kh-send'], wait: 1200 },
  { label: 'toaster sent three', click: '#toaster .kt-control >> text=Send three', wait: 1600 },
  { label: 'picker compare open', click: '#color-picker .color-picker-swatch[aria-label="Pick the accent"]' },
  { label: 'palette compare open', click: '#color-picker .color-palette .color-picker-swatch' },
  { label: 'install code run', click: '#install .ki-run', wait: 1600 },
  { label: 'install picker open', click: ['#install button[aria-pressed] >> text=Color picker', '#install .color-picker-swatch[aria-label="Change accent"]'] },
  { label: 'principles motion open', click: '#principles .color-picker-swatch[aria-label^="Open the picker to catch"]' },
  { label: 'principles theme paper', click: '#principles label:has(input[type="radio"]) >> nth=1' },
  { label: 'principles theme picker open', click: '#principles .color-picker-swatch[aria-label="Pick the themed accent"]' },
  // axe cannot see the sky behind an open answer (a fixed layer its hit test skips) and takes the page's
  // base blue for it: the answers' contrast is measured by pixels in audit-color-picker.mjs (kit-sky).
  { label: 'faq answer open', click: '#faq summary >> nth=0', pixels: true },
];

/** Scrolls a live place's control to the middle of the screen, presses it and lets it settle. */
async function openLive(page, live) {
  for (const selector of [live.click].flat()) {
    const control = page.locator(selector).first();
    const y = await control.evaluate((element) => element.getBoundingClientRect().top + window.scrollY - window.innerHeight / 2);
    await scrollTo(page, Math.max(0, y));
    await control.click();
    await page.waitForTimeout(live.wait ?? 900);
  }
}

/** Marks text whose effective opacity is strictly between 0 and 1, or under a running fade; returns where it sits (aria-hidden counts as decorative). */
const markFading = (page) =>
  page.evaluate(() => {
    const where = new Set();
    for (const element of document.querySelectorAll('[data-audit-fading]')) element.removeAttribute('data-audit-fading');
    // A fade that is running (or about to) passes through every opacity before axe gets to it.
    const fadingNow = document.getAnimations()
      .filter((animation) => animation.playState !== 'finished' && Number.isFinite(animation.effect?.getComputedTiming().endTime) && animation.effect.getKeyframes().some((frame) => 'opacity' in frame))
      .map((animation) => animation.effect.target)
      .filter((target) => target instanceof Element);
    for (const element of document.querySelectorAll('main *')) {
      let opacity = 1;
      for (let node = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      const animated = fadingNow.some((target) => target.contains(element));
      if (((opacity > 0.01 && opacity < 0.99) || animated) && element.childElementCount === 0 && element.textContent?.trim()) {
        element.setAttribute('data-audit-fading', '');
        const owner = element.closest('[aria-hidden="true"]') ? 'decorative' : (element.closest('[class]')?.className.split(' ')[0] ?? '?');
        where.add(owner);
      }
    }
    return [...where];
  });

const SOFTWARE_WEBKIT = (engine === webkit && process.platform === 'linux') || process.env.AUDIT_NO_WEBGL === '1';
/**
 * The pages audited. Linux WebKit leaves out /color-picker: scrolling it there ran the runner out of memory again and
 * again (3 → 16 GB in a minute or two, a different scenario each run, with WebGL and without), while a Mac's WebKit
 * holds steady and every other page passes. That page stays covered by Chromium and Firefox here, by the WebKit picker
 * audit (audit-color-picker.mjs) in CI, and by Safari on a Mac locally.
 */
const ALL_PAGES = ['/', '/toaster', '/toaster/frame', '/color-picker', '/docs/components/color-picker'];
const SKIPPED = SOFTWARE_WEBKIT ? ['/color-picker'] : [];
const PAGES = ALL_PAGES.filter((path) => !SKIPPED.includes(path));
/** Takes WebGL 2 away before the page runs (the same switch as the `flat` mode of audit-color-picker.mjs). */
const NO_WEBGL = () => {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    return type === 'webgl2' ? null : original.call(this, type, ...rest);
  };
};
/** Step by step in the log when AUDIT_TRACE is set (the WebKit job: its runner runs out of memory on one page). */
const trace = (line) => process.env.AUDIT_TRACE && console.log(`    ${new Date().toISOString().slice(11, 19)} ${line}`);

/**
 * Opens a page and waits for the network to go quiet. A shared CI runner sometimes keeps Firefox from getting
 * there in 30 s on a page that loads at once elsewhere: one more try with a longer wait; a second timeout fails.
 */
async function visit(page, path) {
  try {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  } catch (error) {
    if (error?.name !== 'TimeoutError') throw error;
    console.log(`  ${path} did not go quiet in 30 s, loading it again`);
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle', timeout: 60_000 });
  }
}

/**
 * Marks the text caught mid-fade and runs axe without it; returns both from the same attempt. axe itself sometimes
 * dies in Firefox ("too much recursion" while it writes its results' messages): a crash of the tool, not a finding.
 * One more attempt, marked afresh (text that finished fading meanwhile is checked); a second crash fails the audit.
 */
async function axe(page, { pixels = false } = {}) {
  const attempt = async () => {
    const fading = await markFading(page);
    const builder = new AxeBuilder({ page }).exclude('[data-audit-fading]');
    if (pixels) builder.disableRules(['color-contrast']);
    return { fading, audit: await builder.analyze() };
  };
  let result;
  try {
    result = await attempt();
  } catch (error) {
    console.log(`  axe crashed (${String(error.message).split('\n')[0]}), running it again`);
    await page.waitForTimeout(500);
    result = await attempt();
  }
  return {
    fading: result.fading,
    violations: result.audit.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({ target: node.target.join(' '), summary: node.failureSummary?.split('\n').slice(1).join(' ').trim() })),
    })),
  };
}

/** Safari (and WebKit) tab only to controls by default; Option+Tab reaches links too. */
const TAB = engine === webkit ? 'Alt+Tab' : 'Tab';

/** More stops than any audited page has (the color picker's docs page, with a picker in every example, has about 135): past it the pass is a focus trap. */
const MAX_STOPS = 200;

/** Tab through `path` from the top; returns the stops and the failures among them. */
async function keyboard(page, path) {
  await visit(page, path);
  await page.waitForTimeout(600);
  const stops = [];
  const failures = [];
  for (let index = 0; index < MAX_STOPS; index += 1) {
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
      // Some controls ring a part of themselves (a chapter's dot, a slider's thumb): a 3 px spread inside counts.
      const ring =
        (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
        style.boxShadow !== 'none' ||
        [...element.querySelectorAll('*')].some((node) => /0px 0px 0px 3px/u.test(getComputedStyle(node).boxShadow));
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
  if (stops.length >= MAX_STOPS) failures.push({ name: `no end after ${MAX_STOPS} stops (focus trap?)` });
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
    const errors = [];
    let context = null;
    let page = null;
    /**
     * A context and page for the scenario. Linux WebKit gets a fresh one before every page: in one long-lived
     * process its memory sat at ~3 GB page after page, then ran away by ~180 MB/s at a different point each run
     * until the runner died; a Mac's WebKit holds steady. Elsewhere the scenario keeps one page throughout.
     */
    const renew = async (viewport = null) => {
      if (page && !SOFTWARE_WEBKIT) return;
      await context?.close();
      // Firefox has no mobile emulation: its phone scenarios are a narrow touch window.
      context = await browser.newContext(engine === firefox ? { ...options, isMobile: undefined } : options);
      // WebKit on Linux draws WebGL in software, and there the paint's shader ran the runner out of memory. The paint
      // is not what this audit checks — audit-color-picker.mjs measures the text over it — so on that engine the
      // pages get no WebGL 2 and show their own fallback, as a browser without it would.
      if (SOFTWARE_WEBKIT) await context.addInitScript(NO_WEBGL);
      page = await context.newPage();
      if (viewport) await page.setViewportSize(viewport);
      page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
      page.on('pageerror', (error) => errors.push(String(error)));
    };
    await renew();
    const entry = (report[name] = { errors, checks: [], complete: false, skipped: SKIPPED });
    for (const path of PAGES) {
      // Progress in the log: when a runner dies mid-scenario (the WebKit job ran out of memory), it names the page.
      console.log(`  ${name} ${path}`);
      await renew();
      await visit(page, path);
      await page.waitForTimeout(600);
      const stops = path === '/' || path === '/toaster' || path === '/color-picker' ? await homeStops(page) : [{ label: 'top', y: 0 }];
      for (const stop of stops) {
        await scrollTo(page, stop.y);
        trace(`${name} ${path} ${stop.label}: axe`);
        const { fading, violations } = await axe(page);
        trace(`${name} ${path} ${stop.label}: axe done`);
        entry.checks.push({ path, at: stop.label, fading, violations });
        if (violations.length) failed = true;
      }
      if (path === '/') {
        for (const live of KIT_LIVE) {
          await openLive(page, live);
          const { fading, violations } = await axe(page, live);
          entry.checks.push({ path, at: live.label, fading, violations });
          if (violations.length) failed = true;
          // Close what opened (a panel, a popover); a theme and an answer stay as they are.
          await page.keyboard.press('Escape');
          await page.waitForTimeout(400);
        }
      }
    }
    entry.keyboard = {};
    for (const path of PAGES.filter((path) => path !== '/toaster/frame')) {
      trace(`${name} ${path}: keyboard`);
      await renew();
      entry.keyboard[path] = await keyboard(page, path);
      if (entry.keyboard[path].failures.length) failed = true;
    }
    // The narrowest phone (320 px): no page scrolls sideways.
    if (name.startsWith('phone') && options.reducedMotion !== 'reduce') {
      entry.narrow = {};
      await page.setViewportSize({ width: 320, height: 640 });
      for (const path of PAGES.filter((path) => path !== '/toaster/frame')) {
        trace(`${name} ${path}: 320 px`);
        await renew({ width: 320, height: 640 });
        await visit(page, path);
        await page.waitForTimeout(400);
        const width = (entry.narrow[path] = await page.evaluate(() => document.documentElement.scrollWidth));
        if (width > 320) {
          failed = true;
          // What sticks out, so the failure shows its cause: the outermost elements whose right edge passes 320 px
          // and that no ancestor clips.
          const over = await page.evaluate(() => {
            // An ancestor's overflow-x clips a static or relative element always, an absolute one only when the
            // ancestor is (or holds) its containing block. A fixed element never makes the page scroll sideways (it
            // only stretches with a page that already does), so it is left out too.
            const clipped = (element) => {
              const position = getComputedStyle(element).position;
              // Fixed to the viewport, and not to a transformed or filtered ancestor that would hold it in the page.
              const holds = (node) => {
                const style = getComputedStyle(node);
                return style.transform !== 'none' || style.filter !== 'none' || (style.backdropFilter ?? 'none') !== 'none' || style.perspective !== 'none' || /paint|layout|strict|content/u.test(style.contain) || /transform|filter|perspective/u.test(style.willChange);
              };
              for (let node = element; node && node !== document.body; node = node.parentElement) {
                if (getComputedStyle(node).position !== 'fixed') continue;
                let held = false;
                for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) if (holds(parent)) held = true;
                if (!held) return true;
              }
              const block = element.offsetParent;
              for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
                if (!['hidden', 'clip'].includes(getComputedStyle(parent).overflowX)) continue;
                if (position !== 'absolute' || (block && (parent === block || parent.contains(block)))) return true;
              }
              return false;
            };
            return [...document.body.querySelectorAll('*')]
              .map((element) => ({ element, right: element.getBoundingClientRect().right + window.scrollX }))
              .filter(({ element, right }) => right > 320.5 && !(element.parentElement && element.parentElement.getBoundingClientRect().right + window.scrollX > 320.5) && !clipped(element))
              .slice(0, 5)
              .map(({ element, right }) => `${element.tagName.toLowerCase()}${typeof element.className === 'string' && element.className ? `.${element.className.trim().split(/\s+/u).slice(0, 3).join('.')}` : ''} → ${right.toFixed(1)} px`);
          });
          (entry.overflow ??= {})[path] = over;
          console.log(`  ${name} ${path} at 320 px: ${over.join('; ') || 'no element past the edge (a margin or a transform?)'}`);
        }
      }
      await page.setViewportSize(options.viewport);
    }
    if (options.reducedMotion === 'reduce') {
      entry.still = {};
      for (const path of ['/', '/toaster']) {
        trace(`${name} ${path}: still layout`);
        await renew(options.viewport);
        await visit(page, path);
        await scrollTo(page, 3000);
        const still = (entry.still[path] = await stillLayout(page));
        if (still.lenis || still.pinSpacers || still.moved) failed = true;
      }
    }
    if (errors.length) failed = true;
    // The summary counts a scenario green only when it ran to here: one cut short keeps its partial results.
    entry.complete = true;
    await context.close();
    const bad = entry.checks.filter((check) => check.violations.length);
    const fading = [...new Set(entry.checks.flatMap((check) => check.fading))];
    const keys = Object.entries(entry.keyboard).map(([path, pass]) => `${path} ${pass.stops} tab stops, ${pass.failures.length} failing`);
    console.log(
      `${name}: ${entry.checks.length} checks, ${bad.length} with violations (mid-fade text skipped in: ${fading.join(', ') || 'none'}); ${keys.join('; ')}; ${errors.length} console errors` +
        (entry.still ? `; still layout ${JSON.stringify(entry.still)}` : '') +
        (entry.narrow ? `; scrollWidth at 320 px ${JSON.stringify(entry.narrow)}` : ''),
    );
    for (const [path, pass] of Object.entries(entry.keyboard)) for (const stop of pass.failures) console.log(`  keyboard ${path}: ${JSON.stringify(stop)}`);
    for (const check of bad)
      for (const violation of check.violations)
        console.log(`  ${check.path} ${check.at}: ${violation.id} — ${violation.nodes.map((node) => node.target).join(', ')}`);
  }
} finally {
  await browser.close();
  server?.close();
  // Written even when a scenario throws, so the results collected before it are kept.
  writeFileSync(join(out, `axe-${engine.name()}.json`), JSON.stringify(report, null, 2) + '\n');
}
process.exit(failed ? 1 : 0);
