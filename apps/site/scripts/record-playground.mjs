#!/usr/bin/env node
/**
 * Walks /playground group by group in headless Chromium against the static export and
 * records it: every button must present a visible notification in the
 * page Toaster, Copy code must copy the catalog snippet, the console must stay clean and
 * axe must find no violations.
 *
 *   npm run build && npm run build:site
 *   node apps/site/scripts/record-playground.mjs <out-dir> [scenario ...]
 *
 * Writes <scenario>.webm, a PNG per group and report.json; exits 1 on any failure.
 */
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { serve } from './serve-out.mjs';

const GROUPS = ['Kinds', 'Content', 'Actions', 'Promises', 'Attention', 'Stack'];
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const SCENARIOS = {
  'desktop-light': { context: { ...DESKTOP, colorScheme: 'light' }, settings: true },
  'desktop-dark': { context: { ...DESKTOP, colorScheme: 'dark' } },
  'mobile-light': { context: { ...PHONE, colorScheme: 'light' } },
  'mobile-dark': { context: { ...PHONE, colorScheme: 'dark' } },
};

const wait = (page, ms) => page.waitForTimeout(ms);

/** What the page Toaster presents right now: its state and the titles on screen. */
function presented(page) {
  return page.evaluate(() => {
    const host = document.querySelector('.cloudlet-host');
    const visible = (element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
    };
    const titles = [...(host?.querySelectorAll('.cloudlet-shell .cloudlet-title') ?? [])]
      .filter(visible)
      .map((title) => title.textContent?.trim() ?? '');
    return {
      state: host?.getAttribute('data-state') ?? null,
      edge: host?.getAttribute('data-edge') ?? null,
      dir: host?.getAttribute('dir') ?? null,
      pill: host?.querySelector('.cloudlet-pill')?.getAttribute('aria-label') ?? null,
      titles,
    };
  });
}

async function axe(page) {
  const audit = await new AxeBuilder({ page }).analyze();
  return audit.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}

const dismissAll = async (page) => {
  await page.getByRole('button', { name: 'Dismiss all', exact: true }).click();
  await wait(page, 700);
};

/** Buttons of one group card, in page order (the Copy code buttons excluded). */
async function demoButtons(page, group) {
  const card = page.getByRole('region', { name: group, exact: true });
  const labels = await card.getByRole('listitem').evaluateAll((items) =>
    items.map((item) => item.querySelector('button')?.textContent?.trim() ?? ''),
  );
  return { card, labels };
}

async function walkGroup(page, group, still, failures) {
  const { card, labels } = await demoButtons(page, group);
  await card.scrollIntoViewIfNeeded();
  const results = [];
  for (const label of labels) {
    if (label !== 'Dismiss all') await dismissAll(page);
    await card.getByRole('button', { name: label, exact: true }).click();
    // Attention opens the Island 600 ms after admission; promises need a moment to show pending.
    await wait(page, label === 'Overflow' ? 1600 : 1100);
    const shown = await presented(page);
    const ok = label === 'Dismiss all' ? shown.titles.length === 0 : shown.titles.length > 0;
    if (!ok) failures.push(`${group} / ${label}: ${JSON.stringify(shown)}`);
    results.push({ label, ok, ...shown });
    await wait(page, 700);
  }
  await still(group.toLowerCase());
  return results;
}

/** A few flows past the first card: cancellation, the settings, and the failing command. */
async function interactions(page, still, failures) {
  const notes = {};
  const host = page.locator('.cloudlet-host');

  await dismissAll(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await wait(page, 1300);
  await host.getByRole('button', { name: 'Request cancellation', exact: true }).click();
  await wait(page, 1200);
  notes.cancelled = await presented(page);
  if (!notes.cancelled.titles.includes('Landed early')) failures.push(`cancel: ${JSON.stringify(notes.cancelled)}`);
  await still('cancelled');

  // Settings apply live to the same stack: no remount, nothing lost.
  await dismissAll(page);
  await page.getByRole('button', { name: 'Burst ×5', exact: true }).click();
  await wait(page, 900);
  for (const [label, expect] of [
    ['Bottom', { edge: 'bottom' }],
    ['RTL', { dir: 'rtl' }],
    ['Top', { edge: 'top' }],
  ]) {
    await page.locator('label', { hasText: new RegExp(`^${label}$`) }).click();
    await wait(page, 1000);
    const shown = await presented(page);
    notes[`setting-${label}`] = shown;
    if (Object.entries(expect).some(([key, value]) => shown[key] !== value) || !shown.pill?.includes('Altocumulus')) {
      failures.push(`setting ${label}: ${JSON.stringify(shown)}`);
    }
    await still(`setting-${label.toLowerCase()}`);
  }
  await page.locator('label', { hasText: /^Dark$/ }).click();
  await wait(page, 800);
  notes.themeDark = await page.evaluate(() => [
    document.documentElement.classList.contains('dark'),
    document.querySelector('.cloudlet-host')?.getAttribute('data-theme'),
  ]);
  if (notes.themeDark.join() !== 'true,dark') failures.push(`theme: ${notes.themeDark}`);
  await still('setting-dark');
  await page.locator('label', { hasText: /^LTR$/ }).click();
  await page.locator('label', { hasText: /^Auto$/ }).click();
  await page.locator('label', { hasText: /^System$/ }).click();

  // Last: the failing command. Its card changes under a still pointer, which used to leave the
  // host's hover pause set (fixed in the package): the next auto-open is reported.
  await dismissAll(page);
  await page.getByRole('button', { name: 'Share fails → Retry', exact: true }).click();
  await wait(page, 1200);
  await host.getByRole('button', { name: 'Share', exact: true }).click();
  await wait(page, 1400);
  notes.failedCommand = await presented(page);
  await still('action-failed');
  await host.getByRole('button', { name: 'Share', exact: true }).click();
  await wait(page, 1600);
  notes.afterRetry = await presented(page);
  if (!notes.afterRetry.titles.includes('Album shared with the sky')) failures.push(`retry: ${JSON.stringify(notes.afterRetry)}`);
  await still('action-retried');
  await dismissAll(page);
  await page.getByRole('button', { name: 'auto', exact: true }).click();
  await wait(page, 1500);
  notes.autoOpenAfterRetry = (await presented(page)).state;
  return notes;
}

async function copyCheck(page, failures) {
  const card = page.getByRole('region', { name: 'Kinds', exact: true });
  const copy = card.getByRole('button', { name: 'Copy code for Success', exact: true });
  await copy.click();
  await wait(page, 200);
  const label = await card.getByRole('button', { name: 'Copied code for Success', exact: true }).count();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  const expected = `cloudlet.show({ title: 'Synced to the cloud', kind: 'success' });`;
  if (text !== expected || label !== 1) failures.push(`copy: ${JSON.stringify({ text, label })}`);
  return { copied: text === expected, confirmed: label === 1 };
}

const out = resolve(process.argv[2] ?? 'artifacts/landing-06');
const names = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(SCENARIOS);
mkdirSync(out, { recursive: true });
const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const report = {};
let failed = false;

for (const name of names) {
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`Unknown scenario ${name}`);
  const dir = join(out, `${name}-video`);
  const context = await browser.newContext({
    ...scenario.context,
    permissions: ['clipboard-read', 'clipboard-write'],
    recordVideo: { dir, size: scenario.context.viewport },
  });
  const page = await context.newPage();
  const errors = [];
  const failures = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await page.goto(`${origin}/toaster/playground`, { waitUntil: 'load' });
  await wait(page, 800);
  const still = (label) => page.screenshot({ path: join(out, `${name}-${label}.png`) });
  await still('page');

  const entry = { axe: { page: await axe(page) } };
  entry.copy = await copyCheck(page, failures);
  entry.groups = {};
  for (const group of GROUPS) entry.groups[group] = await walkGroup(page, group, still, failures);
  await dismissAll(page);
  await page.getByRole('button', { name: 'open', exact: true }).click();
  await wait(page, 1300);
  entry.axe.island = await axe(page);
  if (scenario.settings) entry.interactions = await interactions(page, still, failures);
  await dismissAll(page);

  const video = page.video();
  await context.close();
  if (video) renameSync(await video.path(), join(out, `${name}.webm`));
  const violations = [...entry.axe.page, ...entry.axe.island];
  entry.errors = errors;
  entry.failures = failures;
  report[name] = entry;
  const buttons = Object.values(entry.groups).flat();
  const ok = !errors.length && !failures.length && !violations.length;
  failed ||= !ok;
  console.log(
    name,
    ok ? 'ok' : 'FAILED',
    `buttons ${buttons.filter((button) => button.ok).length}/${buttons.length}`,
    errors.length ? errors : 'no console errors',
    violations.length ? violations : 'axe clean',
    failures,
  );
}

await browser.close();
server.close();
writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.exit(failed ? 1 : 0);
