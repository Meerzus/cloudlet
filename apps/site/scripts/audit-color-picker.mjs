#!/usr/bin/env node
/**
 * Accessibility audit of the color picker on the static export (COLOR_PICKER §5, §8.2, §10).
 * audit-landing.mjs covers both routes at rest; this one opens every picker and checks what a
 * keyboard and screen reader user meets, and measures the landing's text against the paint's pixels.
 *
 * 1. Contrast by pixels over the whole landing: axe cannot see a canvas, so the page is walked one
 *    screen at a time (the paint is fixed to the window) and every line of text on the screen — the
 *    hero, the sections, the header, the footer — is compared with a shot of the same screen with all
 *    text made transparent; the score is the 1st percentile of the per-pixel ratio (a few grain pixels
 *    may fall below). Text ≥ 4.5:1. Both themes, desktop and phone, reduced motion (a still paint), for
 *    every curated start color, the extremes, and a few palettes (dark, light, high-contrast); the
 *    Opacity section also at 20 % and 80 %. Three ways the paint can be drawn:
 *    - `fixed`: a GPU Chromium (ANGLE on Metal), the canvas fixed to the window — what visitors see;
 *      local only, on a Mac: a Linux runner has no GPU and no Metal, so the audits workflow
 *      (.github/workflows/audits.yml) runs `page` and `flat` and leaves this mode to a local run;
 *    - `page`: Chromium with SwiftShader, the canvas over the whole page, drawn once (software WebGL);
 *    - `flat`: WebGL 2 taken away, a flat background of the page color.
 *    The kit's landing (`/`) is measured the same way over its two painted sections, the hero and the
 *    color picker chapter, whose paint lies in the section's bounds (paint-section.tsx, one WebGL
 *    context between them): the section is scrolled near so the paint loads, then walked one screen
 *    at a time; its text is the gate, the header over it a note (its contrast on `/` is not a
 *    gate). There `flat` is the still frame of the paint drawn without WebGL 2. The color comes from
 *    `?c=`, which the page reads but never writes.
 * 2. Every picker on /color-picker and /docs/components/color-picker, desktop 1440×900 and phone 390×844, light
 *    and dark: Enter on the swatch opens a named dialog with focus in the area; axe on the open panel;
 *    the panel inside the viewport; arrows, Shift and Home/End against the promised values
 *    ("Saturation 40%, Brightness 80%", "Hue 48°", "Opacity 50%"); the Tab order inside the panel;
 *    Tab out of the panel closes it; the format radios re-emit the value; copy announces itself;
 *    Escape (twice from an edited field) returns focus to the swatch; a press outside closes without
 *    moving focus there; target sizes; reduced motion opens without animations; forced colors draw
 *    the thumb and the frames (Chromium only).
 *
 *   npm run build && npm run build:site
 *   node apps/site/scripts/audit-color-picker.mjs <out-dir> [--browser chromium|webkit] [--skip-contrast] [--skip-pickers]
 *     [--modes fixed,page,flat] [--routes picker,kit,kit-hero,kit-sky] [--quick] [--base URL]
 *
 * --quick measures three colors and one palette instead of all. --routes picks the pages measured for
 * contrast: the color picker landing (`picker`), the kit's chapter (`kit`), the kit's hero (`kit-hero`), the rest of the kit's landing over the sky
 * (`kit-sky`, once: the sky has no modes); all by default. Writes color-picker-<browser>.json
 * (with an ARIA snapshot of each open panel); exits 1 on any failure.
 */
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, webkit } from '@playwright/test';
import { serve } from './serve-out.mjs';

/** The curated start colors, read from lib/picker-start.ts so the list cannot drift. */
const START_COLORS = [.../START_COLORS = \[([^\]]+)\]/u.exec(readFileSync(new URL('../src/lib/picker-start.ts', import.meta.url), 'utf8'))[1].matchAll(/'(#[0-9a-f]{6})'/gu)].map((match) => match[1].slice(1));
/** Not curated, but reachable: the extremes, a greyish blue, mid grey, pure yellow, deep red and green. */
const EXTRA_COLORS = ['3d5a80', 'ffffff', '000000', 'ffff00', '808080', '0b5693', '99291d', '336128'];
/** Palettes someone made (a link with more than one color is the visitor's own): the paint takes their ramp. */
const PALETTES = { 'palette-dark': '1b1f4a,3b2a6b,0f3d5c', 'palette-light': 'fff3c4,f7d6e0,dff5e1', 'palette-contrast': '000000,ffffff,ff0000,0000ff' };
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const TEXT_MIN = 4.5;
/** WCAG 2.5.8 (AA): a target at least 24 px across through its centre, both ways. */
const TARGET_MIN = 24;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args.splice(index, 2)[1] : fallback;
};
const engine = { chromium, webkit }[option('--browser', 'chromium')];
const modes = option('--modes', 'fixed,page,flat').split(',');
const routes = option('--routes', 'picker,kit,kit-hero,kit-sky').split(',');
const skipContrast = args.includes('--skip-contrast');
const skipPickers = args.includes('--skip-pickers');
const quick = args.includes('--quick');
const [outDir] = args.filter((arg) => !arg.startsWith('--'));
if (!outDir || !engine) {
  console.error('Usage: node apps/site/scripts/audit-color-picker.mjs <out-dir> [--browser chromium|webkit] [--skip-contrast] [--skip-pickers] [--modes fixed,page,flat] [--routes picker,kit,kit-hero,kit-sky] [--quick]');
  process.exit(2);
}
const out = resolve(outDir);
mkdirSync(out, { recursive: true });
const external = option('--base', null);
const server = external ? null : await serve();
const base = external ?? `http://127.0.0.1:${server.address().port}`;
const report = { contrast: [], overContent: [], pickers: [] };
const failures = [];
const fail = (where, what) => {
  failures.push(`${where}: ${what}`);
  console.log(`  FAIL ${where}: ${what}`);
};

// --- 1. Contrast over the whole landing -----------------------------------------------------------

/**
 * In the page: every line of visible text on the screen, grouped by its element, with the ink it is
 * drawn in (the element's color, its alpha times the opacity of its ancestors). Lines cut by the
 * window's edge are left to the screen that shows them whole.
 */
const textTargets = (page, scope = null) =>
  page.evaluate((scope) => {
    const height = window.innerHeight;
    const width = document.documentElement.clientWidth;
    // Lines that have scrolled under the fixed header are blurred behind it, not read there.
    const under = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
    const groups = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.textContent.trim() || parent.closest('script, style, noscript, nextjs-portal, [hidden], [aria-hidden="true"] svg')) continue;
      // A scope keeps the text of one part of the page (and the header over it).
      if (scope && !parent.closest(scope) && !parent.closest('.site-header')) continue;
      const style = getComputedStyle(parent);
      // Not rendered: a closed answer (<details> keeps its content in a content-visibility: hidden slot).
      if (style.visibility !== 'visible' || !parent.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })) continue;
      // A visually hidden label (sr-only: 1 px, clipped) still reports its full line boxes.
      const own = parent.getBoundingClientRect();
      if (own.width <= 1 || own.height <= 1) continue;
      let opacity = 1;
      for (let element = parent; element; element = element.parentElement) opacity *= Number(getComputedStyle(element).opacity);
      if (opacity < 0.05) continue;
      // What the boxes are clipped to: every scrolling or clipping ancestor (a code block that scrolls sideways).
      let clip = { left: 0, top: 0, right: width, bottom: height };
      for (let element = parent; element && element !== document.body; element = element.parentElement) {
        const { overflowX, overflowY } = getComputedStyle(element);
        if (overflowX === 'visible' && overflowY === 'visible') continue;
        const r = element.getBoundingClientRect();
        clip = { left: Math.max(clip.left, r.left), top: Math.max(clip.top, r.top), right: Math.min(clip.right, r.right), bottom: Math.min(clip.bottom, r.bottom) };
      }
      const inHeader = Boolean(parent.closest('.site-header'));
      if (!inHeader) clip.top = Math.max(clip.top, under);
      const range = document.createRange();
      range.selectNodeContents(node);
      const boxes = [];
      for (const { left, top, right, bottom, width: w, height: h } of range.getClientRects()) {
        if (w <= 2 || h <= 2 || top < clip.top || bottom > clip.bottom) continue;
        const box = { left: Math.max(left, clip.left), top, right: Math.min(right, clip.right), bottom };
        // Mostly cut off sideways: left to a wider window.
        if (box.right - box.left < w * 0.5) continue;
        // Something else on top of the line (a panel that opened over it, a sticky bar): not this text's background.
        const hit = document.elementFromPoint((box.left + box.right) / 2, (top + bottom) / 2);
        if (hit && !parent.contains(hit) && !hit.contains(parent)) continue;
        boxes.push(box);
      }
      if (boxes.length === 0) continue;
      let group = groups.get(parent);
      if (!group) {
        const where = parent.closest('.site-header') ? 'header' : parent.closest('footer, .docs-footer, .cp-paint-footer') ? 'footer' : parent.closest('section[id]')?.id ?? (parent.closest('.cp-hero') ? 'hero' : 'page');
        group = { header: inHeader, label: `${where} ${parent.tagName.toLowerCase()} “${parent.textContent.trim().replace(/\s+/gu, ' ').slice(0, 28)}”`, color: style.color, opacity, boxes: [] };
        groups.set(parent, group);
      }
      group.boxes.push(...boxes);
    }
    return [...groups.values()];
  }, scope);

/** In the page: per-pixel contrast of each text box against a shot of the screen without its text. */
const measure = (page, shot, targets) =>
  page.evaluate(async ({ shot, targets }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${shot}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const scale = image.width / document.documentElement.clientWidth;
    const { data } = context.getImageData(0, 0, image.width, image.height);
    // A CSS color (oklch included) as straight sRGB with alpha, through a 1×1 canvas.
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgba = (color) => {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = color;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return targets.map(({ label, color, opacity, boxes }) => {
      const ink = rgba(color);
      const alpha = ink.a * opacity;
      const ratios = [];
      for (const box of boxes) {
        const x0 = Math.max(0, Math.floor(box.left * scale));
        const x1 = Math.min(image.width, Math.ceil(box.right * scale));
        const y0 = Math.max(0, Math.floor(box.top * scale));
        const y1 = Math.min(image.height, Math.ceil(box.bottom * scale));
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const index = (y * image.width + x) * 4;
            const bg = [data[index], data[index + 1], data[index + 2]];
            const fg = [ink.r, ink.g, ink.b].map((channel, i) => channel * alpha + bg[i] * (1 - alpha));
            const [lighter, darker] = [lum(...fg), lum(...bg)].sort((p, q) => q - p);
            ratios.push((lighter + 0.05) / (darker + 0.05));
          }
        }
      }
      ratios.sort((p, q) => p - q);
      const at = (share) => ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * share))] ?? 0;
      return { label, pixels: ratios.length, p1: Math.round(at(0.01) * 100) / 100, min: Math.round((ratios[0] ?? 0) * 100) / 100 };
    });
  }, { shot, targets });

/** Takes WebGL 2 away before the page runs: the landing must keep its flat background. */
const NO_WEBGL = () => {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    return type === 'webgl2' ? null : original.call(this, type, ...rest);
  };
};
/** Hides the glyphs only: `color` stays, so borders and fills drawn in currentColor stay too. */
/** Everything under the header but the paint: the page's content. */
const BARE = 'main *, footer *, .cp-paint-footer *';
/** The paint layers kept in the shot of the header against the paint alone. */
const PAINT_LAYERS = '.cp-paint, .cp-veil, .paint-section, .paint-section *';
const HIDE_TEXT = '*, *::before, *::after { -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }';
/** The glyphs only, their halo kept: on the kit's sky a halo is what the text stands on over a cloud. */
const HIDE_GLYPHS = '*, *::before, *::after { -webkit-text-fill-color: transparent !important; text-decoration-color: transparent !important; caret-color: transparent !important; }';

/** How the paint ended up drawn, once it has settled: 'fixed', 'page' or 'flat'; null when it never drew. */
const settledMode = (page) =>
  page
    .waitForFunction(() => {
      const canvas = document.querySelector('.cp-paint');
      if (canvas?.dataset.mode === 'flat') return 'flat';
      const img = document.querySelector('picture img[src*="material-page"]');
      const mode = document.documentElement.dataset.cpPaint;
      return mode && img?.complete && img.naturalWidth > 0 ? mode : false;
    }, null, { timeout: 15_000 })
    .then((handle) => handle.jsonValue())
    .catch(() => null);

/** Scores one screen at the current scroll position. */
async function scoreScreen(page, meta, where, { scope = null, headerGate = true, halo = false } = {}) {
  const targets = await textTargets(page, scope);
  const style = await page.addStyleTag({ content: halo ? HIDE_GLYPHS : HIDE_TEXT });
  await page.waitForTimeout(60);
  const shot = (await page.screenshot()).toString('base64');
  // The header against the paint alone (§8.2): the page's content hidden, the paint and the Opacity veil kept.
  // Content that scrolls under the header is scored apart (`overContent`), as a note rather than a gate.
  const bare = await page.addStyleTag({ content: `${BARE} { visibility: hidden !important; } ${PAINT_LAYERS} { visibility: visible !important; }` });
  await page.waitForTimeout(60);
  const paintShot = (await page.screenshot()).toString('base64');
  await bare.evaluate((node) => node.remove());
  await style.evaluate((node) => node.remove());
  const header = targets.filter((target) => target.header);
  const headerResults = await measure(page, paintShot, header);
  // Where the header is not a gate (the kit's landing), its labels over the paint are a note.
  if (!headerGate) for (const result of headerResults) if (result.pixels && result.p1 < TEXT_MIN) report.overContent.push({ ...meta, ...result, note: 'header over the paint' });
  const results = [...(await measure(page, shot, targets.filter((target) => !target.header))), ...(headerGate ? headerResults : [])];
  for (const result of await measure(page, shot, header)) {
    if (result.pixels && result.p1 < TEXT_MIN) report.overContent.push({ ...meta, ...result });
  }
  let saved = false;
  for (const result of results) {
    if (result.pixels === 0) continue;
    const entry = { ...meta, ...result, passed: result.p1 >= TEXT_MIN };
    report.contrast.push(entry);
    if (entry.passed) continue;
    fail(where, `${result.label} ${result.p1}:1 at the 1st percentile (needs ${TEXT_MIN}:1)`);
    // The screen as measured (text hidden) and as seen, to look at what failed.
    if (!saved) {
      saved = true;
      const name = where.replace(/[^a-z0-9]+/giu, '-');
      writeFileSync(join(out, `${name}.png`), Buffer.from(shot, 'base64'));
      await page.screenshot({ path: join(out, `${name}-seen.png`) });
    }
  }
}

const scrollTo = async (page, y) => {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
  // The paint follows on the next frames (and the page mode needs none); the header settles.
  await page.waitForTimeout(250);
};

/** Sets the Opacity section's panel to an alpha in tens (Home, then Shift+→). */
async function setAlpha(page, percent) {
  const slider = page.locator('#opacity .color-picker-alpha');
  await slider.focus();
  await page.keyboard.press('Home');
  for (let step = 0; step < percent / 10; step += 1) await page.keyboard.press('Shift+ArrowRight');
  await page.evaluate(() => document.activeElement?.blur());
}

async function landingContrast(mode) {
  const browser = await chromium.launch({
    args: mode === 'fixed' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const colors = quick ? ['ff6a3d', 'ffffff', '1b1f4a'] : [...START_COLORS, ...EXTRA_COLORS];
  const palettes = quick ? { 'palette-contrast': PALETTES['palette-contrast'] } : mode === 'page' ? {} : PALETTES;
  // The software paint shares the shader with the fixed one: the curated colors are enough there.
  const cases = [...(mode === 'page' && !quick ? START_COLORS : colors).map((color) => [color, color]), ...Object.entries(palettes).map(([name, list]) => [name, list])];
  try {
    for (const [device, options] of Object.entries({ desktop: DESKTOP, phone: PHONE })) {
      for (const colorScheme of ['light', 'dark']) {
        const context = await browser.newContext({ ...options, colorScheme, reducedMotion: 'reduce' });
        if (mode === 'flat') await context.addInitScript(NO_WEBGL);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(String(error)));
        for (const [name, c] of cases) {
          await page.goto(`${base}/color-picker?c=${c}`, { waitUntil: 'networkidle' });
          const where = `contrast ${mode} ${device}-${colorScheme} ${name}`;
          const drawn = await settledMode(page);
          if (drawn !== mode) {
            fail(where, `the paint was drawn as ${drawn ?? 'nothing'}, not ${mode}`);
            continue;
          }
          await page.waitForTimeout(200);
          const meta = { mode, device, colorScheme, color: name };
          const total = await page.evaluate(() => document.documentElement.scrollHeight);
          const height = options.viewport.height;
          // Screens overlap by a quarter so that every line is whole on one of them.
          const step = Math.round(height * 0.75);
          let screens = 0;
          for (let y = 0; ; y += step, screens += 1) {
            await scrollTo(page, Math.min(y, total - height));
            await scoreScreen(page, { ...meta, y }, `${where} @${y}`);
            if (y + height >= total) break;
          }
          // The Opacity section between 0 and 100 %: the theme's background over the paint, part-way.
          for (const percent of [20, 80]) {
            await setAlpha(page, percent);
            await page.locator('#opacity').evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
            await page.waitForTimeout(250);
            await scoreScreen(page, { ...meta, alpha: percent }, `${where} opacity ${percent} %`);
          }
          process.stdout.write('.');
        }
        process.stdout.write('\n');
        if (errors.length) fail(`contrast ${mode} ${device}-${colorScheme}`, `page errors: ${errors.join(' | ')}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  const entries = report.contrast.filter((entry) => !entry.route && entry.mode === mode);
  const passed = entries.filter((entry) => entry.passed).length;
  const worst = [...entries].sort((p, q) => p.p1 - q.p1)[0];
  console.log(`contrast (${mode}): ${passed}/${entries.length} lines passed; tightest ${worst?.label} ${worst?.p1}:1 (${worst?.device}-${worst?.colorScheme} ${worst?.color})`);
  const over = report.overContent.filter((entry) => !entry.route && entry.mode === mode);
  if (over.length) console.log(`  note: ${over.length} header labels under 4.5:1 while content scrolls under the header (not on the paint)`);
}

/** A painted section of the kit's landing: how its paint ended up drawn once the frame is in ('fixed', 'page' or 'still'); null when it never drew. */
const settledSection = (page, id) =>
  page
    .waitForFunction((id) => {
      const box = document.querySelector(`#${id} .paint-section`);
      const img = box?.querySelector('picture img');
      return box?.dataset.state === 'drawn' && img?.complete && img.naturalWidth > 0 ? box.dataset.paint : false;
    }, id, { timeout: 15_000 })
    .then((handle) => handle.jsonValue())
    .catch(() => null);

/** On the kit's landing the audit's `flat` (no WebGL 2) is the section's still frame. */
const CHAPTER_MODE = { fixed: 'fixed', page: 'page', flat: 'still' };
/** The painted sections of the kit's landing: the color picker's chapter (`kit`) and the hero (`kit-hero`), one WebGL context between them. */
const KIT_PAINTED = { kit: { id: 'color-picker', name: 'kit chapter' }, 'kit-hero': { id: 'hero', name: 'kit hero' } };

async function kitContrast(mode, route = 'kit') {
  const { id, name: section } = KIT_PAINTED[route];
  const browser = await chromium.launch({
    args: mode === 'fixed' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const colors = quick ? ['ff6a3d', 'ffffff', '1b1f4a'] : [...START_COLORS, ...EXTRA_COLORS];
  const palettes = quick ? { 'palette-contrast': PALETTES['palette-contrast'] } : PALETTES;
  const cases = [...colors.map((color) => [color, color]), ...Object.entries(palettes)];
  try {
    for (const [device, options] of Object.entries({ desktop: DESKTOP, phone: PHONE })) {
      for (const colorScheme of ['light', 'dark']) {
        const context = await browser.newContext({ ...options, colorScheme, reducedMotion: 'reduce' });
        if (mode === 'flat') await context.addInitScript(NO_WEBGL);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(String(error)));
        for (const [name, c] of cases) {
          await page.goto(`${base}/?c=${c}`, { waitUntil: 'networkidle' });
          const where = `${section} contrast ${mode} ${device}-${colorScheme} ${name}`;
          // Near the section: the renderer and the frame load as it comes within a screen (the hero is there at once).
          await page.locator(`#${id}`).evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
          const drawn = await settledSection(page, id);
          if (drawn !== CHAPTER_MODE[mode]) {
            fail(where, `the ${section}'s paint was drawn as ${drawn ?? 'nothing'}, not ${CHAPTER_MODE[mode]}`);
            continue;
          }
          const written = await page.evaluate(() => new URLSearchParams(location.search).get('c'));
          if (written !== c) fail(where, `the address changed to ?c=${written}`);
          await page.waitForTimeout(300);
          const meta = { route, mode, device, colorScheme, color: name };
          const { top, bottom } = await page.locator(`#${id}`).evaluate((element) => {
            const box = element.getBoundingClientRect();
            return { top: box.top + window.scrollY, bottom: box.bottom + window.scrollY };
          });
          const height = options.viewport.height;
          const step = Math.round(height * 0.75);
          for (let y = Math.max(0, Math.round(top - height * 0.25)); ; y += step) {
            await scrollTo(page, y);
            await scoreScreen(page, { ...meta, y }, `${where} @${y}`, { scope: `#${id}`, headerGate: false });
            if (y + height >= bottom) break;
          }
          process.stdout.write('.');
        }
        process.stdout.write('\n');
        if (errors.length) fail(`${section} contrast ${mode} ${device}-${colorScheme}`, `page errors: ${errors.join(' | ')}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  const entries = report.contrast.filter((entry) => entry.route === route && entry.mode === mode);
  const passed = entries.filter((entry) => entry.passed).length;
  const worst = [...entries].sort((p, q) => p.p1 - q.p1)[0];
  console.log(`${section} contrast (${mode}): ${passed}/${entries.length} lines passed; tightest ${worst?.label} ${worst?.p1}:1 (${worst?.device}-${worst?.colorScheme} ${worst?.color})`);
  const notes = report.overContent.filter((entry) => entry.route === route && entry.mode === mode);
  if (notes.length) console.log(`  note: ${notes.length} header labels under 4.5:1 over the ${section} (a note, not a gate)`);
}

/**
 * The rest of the kit's landing: its text over the sky (the Toaster's scene, Install,
 * Principles, the FAQ with every answer open, Star, the footer), walked one screen at a time like the
 * chapter. axe cannot see the sky (a fixed layer the hit test skips) and takes the page's base blue for
 * the background; the pixels are what the text sits on, its halo at night included. Reduced motion holds the sky
 * still; the hero's and the chapter's own text is measured above, the header over the page is a note.
 */
/** Waits until two shots 400 ms apart are the same (at most ~6 s), so the screen is scored at rest. */
async function screenAtRest(page) {
  let previous = await page.screenshot();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.waitForTimeout(400);
    const next = await page.screenshot();
    if (next.equals(previous)) return true;
    previous = next;
  }
  return false;
}

async function kitSkyContrast() {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const [device, options] of Object.entries({ desktop: DESKTOP, phone: PHONE })) {
      for (const colorScheme of ['light', 'dark']) {
        const context = await browser.newContext({ ...options, colorScheme, reducedMotion: 'reduce' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto(`${base}/`, { waitUntil: 'networkidle' });
        const where = `kit sky contrast ${device}-${colorScheme}`;
        await page.evaluate(() => {
          for (const details of document.querySelectorAll('#faq details')) details.open = true;
        });
        const meta = { route: 'kit-sky', mode: 'sky', device, colorScheme, color: 'sky' };
        const height = options.viewport.height;
        const step = Math.round(height * 0.75);
        for (let y = 0; ; y += step) {
          const total = await page.evaluate(() => document.documentElement.scrollHeight);
          await scrollTo(page, Math.min(y, total - height));
          // Lazy clouds and images settle before the shot.
          await page.waitForTimeout(250);
          // The Toaster scene plays one step by itself the first time it is on screen, adding toasts on timers:
          // measured mid-step, a line is scored against the background of a stack that has since moved.
          if (!(await screenAtRest(page))) {
            fail(`${where} @${y}`, 'the screen did not come to rest in 6 s (reduced motion holds the sky still): not scored');
            if (y + height >= total) break;
            continue;
          }
          await scoreScreen(page, { ...meta, y }, `${where} @${y}`, { scope: 'main > section:not(#color-picker, #hero), footer', headerGate: false, halo: true });
          if (y + height >= total) break;
        }
        if (errors.length) fail(where, `page errors: ${errors.join(' | ')}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  const entries = report.contrast.filter((entry) => entry.route === 'kit-sky');
  const passed = entries.filter((entry) => entry.passed).length;
  const worst = [...entries].sort((p, q) => p.p1 - q.p1)[0];
  console.log(`kit sky contrast: ${passed}/${entries.length} lines passed; tightest ${worst?.label} ${worst?.p1}:1 (${worst?.device}-${worst?.colorScheme})`);
  const notes = report.overContent.filter((entry) => entry.route === 'kit-sky');
  if (notes.length) console.log(`  note: ${notes.length} header labels under 4.5:1 over the page (a note, not a gate)`);
}

// --- 2. Pickers -------------------------------------------------------------------------------------

/** What the focus is on, for the Tab order: the accessible name the picker gives each stop. */
const focusName = (page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return 'body';
    if (element.matches('input[type="radio"]')) return `radio ${element.value}`;
    return element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 30) ?? element.tagName;
  });
const valueText = (locator) => locator.getAttribute('aria-valuetext');
const settle = (page, ms = 900) => page.waitForTimeout(ms);
/** Safari (and WebKit) tab only to text fields by default; Option+Tab reaches buttons and radios too. */
const TAB = engine === webkit ? 'Alt+Tab' : 'Tab';

/** Extent through the centre, in each direction, over which a press lands on the control (its own hit area included). */
const hitExtent = (locator) =>
  locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const control = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      return hit === element || element.contains(hit) || (element.control && hit?.closest('label') === element);
    };
    const reach = (dx, dy) => {
      let d = 0;
      while (d < 40 && control(cx + dx * (d + 1), cy + dy * (d + 1))) d += 1;
      return d;
    };
    const width = reach(-1, 0) + reach(1, 0) + 1;
    const height = reach(0, -1) + reach(0, 1) + 1;
    if (control(cx, cy)) return { width, height };
    // Not even the centre lands on the control: say what does, so a failure shows its cause.
    const describe = (node) => (node ? `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${typeof node.className === 'string' && node.className ? `.${node.className.trim().split(/\s+/u).slice(0, 3).join('.')}` : ''}` : 'nothing');
    const hit = document.elementFromPoint(cx, cy);
    return { width, height, centre: `${describe(hit)} in ${describe(hit?.parentElement)} at ${Math.round(cx)},${Math.round(cy)} of ${window.innerWidth}×${window.innerHeight}` };
  });

async function checkPopover(page, trigger, where, { reduced, forced, browserName }) {
  const entry = { where, checks: {} };
  report.pickers.push(entry);
  const check = (name, ok, detail) => {
    entry.checks[name] = ok ? 'passed' : `failed: ${detail}`;
    if (!ok) fail(where, `${name} — ${detail}`);
  };
  await trigger.scrollIntoViewIfNeeded();
  // Room below and beside the swatch is the page's business; centre it the way a reader would have it.
  await trigger.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(300);
  const name = await trigger.getAttribute('aria-label');
  // The trigger's size while closed: open, the panel's own swatch covers it.
  const swatchExtent = await hitExtent(trigger);
  check('swatch is a collapsed button', (await trigger.getAttribute('aria-expanded')) === 'false', `aria-expanded=${await trigger.getAttribute('aria-expanded')}`);
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(50);
  const dialogId = await trigger.getAttribute('aria-controls');
  const dialog = page.locator(`[id="${dialogId}"]`);
  check('Enter opens a named dialog', (await trigger.getAttribute('aria-expanded')) === 'true' && (await dialog.getAttribute('role')) === 'dialog' && Boolean(await dialog.getAttribute('aria-label')), `controls ${dialogId}`);
  if (reduced) {
    const running = await dialog.evaluate((element) => [element, ...element.querySelectorAll('*'), element.parentElement].flatMap((node) => node.getAnimations()).filter((animation) => animation.playState === 'running').length);
    check('reduced motion: opens without animations', running === 0, `${running} animations running`);
  }
  await settle(page);
  const area = dialog.locator('.color-picker-area');
  check('focus starts in the area', await area.evaluate((element) => element === document.activeElement), await focusName(page));

  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  check('panel inside the viewport', box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, JSON.stringify(box));

  const axe = await new AxeBuilder({ page }).include(`[id="${dialogId}"]`).analyze();
  check('axe on the open panel', axe.violations.length === 0, axe.violations.map((violation) => `${violation.id} (${violation.nodes.map((node) => node.target.join(' ')).join(', ')})`).join('; '));
  entry.aria = await dialog.ariaSnapshot();

  if (forced) {
    const drawn = await dialog.evaluate((element) => {
      const thumb = getComputedStyle(element.querySelector('.color-picker-thumb'));
      const area = getComputedStyle(element.querySelector('.color-picker-area'));
      return thumb.borderTopStyle === 'solid' && parseFloat(thumb.borderTopWidth) >= 2 && parseFloat(area.borderTopWidth) >= 1;
    });
    check('forced colors: thumb and area framed', drawn, 'no border');
  }

  // The area: arrows, Shift, and the words a screen reader hears.
  const AREA = /^Saturation (\d+)%, Brightness (\d+)%$/u;
  const before = AREA.exec((await valueText(area)) ?? '');
  check('area value text', Boolean(before), await valueText(area));
  if (before) {
    const [s, v] = [Number(before[1]), Number(before[2])];
    await page.keyboard.press(s > 0 ? 'ArrowLeft' : 'ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    const after = AREA.exec((await valueText(area)) ?? '');
    const expected = [s > 0 ? s - 1 : s + 1, Math.max(0, v - 10)];
    check('area ←/→ by 1 %, Shift+↓ by 10 %', after && Number(after[1]) === expected[0] && Number(after[2]) === expected[1], `${await valueText(area)} after ${s}/${v}`);
    check('area aria-valuenow is the saturation', Number(await area.getAttribute('aria-valuenow')) === expected[0], await area.getAttribute('aria-valuenow'));
  }

  // Tab order from the panel's own swatch to the last tool, then out.
  await dialog.locator('.color-picker-head .color-picker-swatch').focus();
  const order = [await focusName(page)];
  for (let index = 0; index < 10; index += 1) {
    await page.keyboard.press(TAB);
    await page.waitForTimeout(60);
    const inside = await dialog.evaluate((element) => element.contains(document.activeElement)).catch(() => false);
    if (!inside) break;
    order.push(await focusName(page));
  }
  entry.tabOrder = order;
  const alpha = (await dialog.locator('.color-picker-alpha').count()) > 0;
  const eyedropper = await page.evaluate(() => typeof window.EyeDropper === 'function');
  const expected = ['Close', 'Color value', 'Saturation and brightness', 'Hue', ...(alpha ? ['Opacity'] : []), 'radio', ...(eyedropper ? ['Pick from screen'] : []), 'Copy'];
  const matches = order.length === expected.length && order.every((stop, index) => stop.startsWith(expected[index]));
  check('Tab order inside the panel', matches, order.join(' → '));
  await page.waitForTimeout(500);
  check('Tab out of the panel closes it', (await trigger.getAttribute('aria-expanded')) === 'false', `still open, focus on ${await focusName(page)}`);
  await settle(page);

  // Hue and opacity: Home/End and steps, against "Hue 48°" and "Opacity 50%".
  await trigger.focus();
  await page.keyboard.press('Enter');
  await settle(page);
  const hue = dialog.locator('.color-picker-hue');
  await hue.focus();
  await page.keyboard.press('Home');
  const hueHome = await valueText(hue);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const hueStep = await valueText(hue);
  await page.keyboard.press('End');
  const hueEnd = await valueText(hue);
  check('hue value text, Home, → +1°, Shift+→ +10°, End', hueHome === 'Hue 0°' && hueStep === 'Hue 11°' && hueEnd === 'Hue 360°', `${hueHome} / ${hueStep} / ${hueEnd}`);
  if (alpha) {
    const opacity = dialog.locator('.color-picker-alpha');
    await opacity.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+ArrowLeft');
    check('opacity value text', (await valueText(opacity)) === 'Opacity 90%', await valueText(opacity));
  }

  // The format radios: arrows move and re-emit the value in the new format.
  const checked = dialog.locator('input[type="radio"]:checked');
  if ((await checked.count()) > 0) {
    await checked.focus();
    const from = await checked.inputValue();
    await page.keyboard.press('ArrowRight');
    const to = await dialog.locator('input[type="radio"]:checked').inputValue();
    const value = await dialog.locator('.color-picker-value').inputValue();
    const shape = { hex: /^#[0-9a-f]{6}([0-9a-f]{2})?$/u, rgb: /^rgb\(/u, hsl: /^hsl\(/u, oklch: /^oklch\(/u }[to];
    check('format radios: arrow moves and re-emits', to !== from && shape?.test(value), `${from} → ${to}, field ${value}`);
    await page.keyboard.press('ArrowLeft');
  }

  // Copy: the live region says so (a blocked clipboard stays silent by design).
  const copy = dialog.getByRole('button', { name: 'Copy' });
  await copy.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const live = await dialog.locator('[aria-live="polite"]').textContent();
  const clipboard = browserName === 'chromium' ? await page.evaluate(() => navigator.clipboard.readText()).catch(() => null) : null;
  entry.copy = { live, clipboard };
  if (browserName === 'chromium') check('copy writes and announces', live === 'Copied' && clipboard === (await dialog.locator('.color-picker-value').inputValue()), `live “${live}”, clipboard ${clipboard}`);

  // Target sizes through the centre (own hit areas included), on the panel at rest: its clip grows on animations
  // (fill: both), and a slow page (the paint drawn in software) can still be running them here.
  const rest = await dialog.evaluate(async (element) => {
    const running = () => element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running');
    const deadline = Date.now() + 5000;
    while (running().length && Date.now() < deadline) await new Promise((done) => setTimeout(done, 100));
    return { running: running().length, clip: getComputedStyle(element).clipPath };
  });
  const targets = { value: dialog.locator('.color-picker-value'), hue, copy, segment: dialog.locator('.color-picker-segment').first() };
  entry.targets = {};
  for (const [label, locator] of [['swatch', null], ...Object.entries(targets)]) {
    if (locator && !(await locator.count())) continue;
    const extent = locator ? await hitExtent(locator) : swatchExtent;
    entry.targets[label] = extent;
    check(`target ${label} ≥ ${TARGET_MIN} px`, extent.width >= TARGET_MIN && extent.height >= TARGET_MIN, `${extent.width}×${extent.height}${extent.centre ? `, the centre hits ${extent.centre}${locator ? `; panel clip ${rest.clip}, ${rest.running} animations still running` : ''}` : ''}`);
  }

  // Escape from the area: closed, focus back on the swatch.
  await area.focus();
  await page.keyboard.press('Escape');
  await settle(page);
  check('Escape closes and returns focus to the swatch', (await trigger.getAttribute('aria-expanded')) === 'false' && (await trigger.evaluate((element) => element === document.activeElement)), await focusName(page));

  // The field: an unparsable draft, Escape reverts and stays; a second Escape closes.
  await page.keyboard.press('Enter');
  await settle(page);
  const field = dialog.locator('.color-picker-value');
  const kept = await field.inputValue();
  await field.focus();
  await page.keyboard.type('zz');
  await page.keyboard.press('Escape');
  const reverted = (await field.inputValue()) === kept && (await field.evaluate((element) => element === document.activeElement));
  await page.keyboard.press('Escape');
  await settle(page);
  check('field: Escape reverts, second Escape closes to the swatch', reverted && (await trigger.evaluate((element) => element === document.activeElement)), `field ${await field.inputValue().catch(() => 'gone')}, focus ${await focusName(page)}`);

  // A press outside closes and does not move focus to the swatch.
  await page.keyboard.press('Enter');
  await settle(page);
  await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })));
  await settle(page);
  check('press outside closes without focusing the swatch', (await trigger.getAttribute('aria-expanded')) === 'false' && !(await trigger.evaluate((element) => element === document.activeElement)), await focusName(page));
  console.log(`  ${where}: ${name} — ${Object.values(entry.checks).filter((value) => value === 'passed').length}/${Object.keys(entry.checks).length}`);
}

async function checkInline(page, panel, where) {
  const entry = { where, checks: {} };
  report.pickers.push(entry);
  await panel.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const axe = await new AxeBuilder({ page }).include('.color-picker-inline').analyze();
  entry.checks.axe = axe.violations.length ? `failed: ${axe.violations.map((violation) => violation.id).join(', ')}` : 'passed';
  if (axe.violations.length) fail(where, `axe on the inline panel — ${axe.violations.map((violation) => violation.id).join(', ')}`);
  entry.aria = await panel.ariaSnapshot();
  console.log(`  ${where}: inline panel — axe ${entry.checks.axe}`);
}

async function pickers(browser) {
  const scenarios = {};
  for (const [device, options] of Object.entries({ desktop: DESKTOP, phone: PHONE })) for (const colorScheme of ['light', 'dark']) scenarios[`${device}-${colorScheme}`] = { ...options, colorScheme };
  scenarios['desktop-light-reduced'] = { ...DESKTOP, colorScheme: 'light', reducedMotion: 'reduce' };
  if (engine === chromium) scenarios['desktop-dark-forced'] = { ...DESKTOP, colorScheme: 'dark', forcedColors: 'active' };
  for (const [scenario, options] of Object.entries(scenarios)) {
    console.log(`${scenario}:`);
    const context = await browser.newContext({
      ...options,
      ...(engine === chromium ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}),
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    for (const path of ['/color-picker?c=ff6a3d', '/docs/components/color-picker']) {
      await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      const triggers = page.locator('main .color-picker > .color-picker-swatch');
      for (let index = 0; index < (await triggers.count()); index += 1) {
        await checkPopover(page, triggers.nth(index), `${scenario} ${path} #${index + 1}`, { reduced: options.reducedMotion === 'reduce', forced: options.forcedColors === 'active', browserName: engine.name() });
      }
      const inline = page.locator('main .color-picker-inline');
      for (let index = 0; index < (await inline.count()); index += 1) await checkInline(page, inline.nth(index), `${scenario} ${path} inline #${index + 1}`);
    }
    if (errors.length) fail(scenario, `page errors: ${errors.join(' | ')}`);
    await context.close();
  }
}

try {
  if (!skipContrast && engine === chromium) {
    for (const mode of modes) {
      if (routes.includes('picker')) await landingContrast(mode);
      if (routes.includes('kit')) await kitContrast(mode, 'kit');
      if (routes.includes('kit-hero')) await kitContrast(mode, 'kit-hero');
    }
    if (routes.includes('kit-sky')) await kitSkyContrast();
  }
  if (!skipPickers) {
    const browser = await engine.launch(engine === chromium ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {});
    try {
      await pickers(browser);
    } finally {
      await browser.close();
    }
  }
} finally {
  server?.close();
}
report.failures = failures;
writeFileSync(join(out, `color-picker-${engine.name()}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(failures.length ? `\n${failures.length} failures` : '\nNo failures');
process.exit(failures.length ? 1 : 0);
