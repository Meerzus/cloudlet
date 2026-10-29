#!/usr/bin/env node
/**
 * Lighthouse mobile on the static export of the documentation (DOCS.md §12): `/docs` and one
 * Guides page must reach Performance ≥ 90, Accessibility = 100 and CLS ≈ 0 (< 0.01). Lighthouse
 * runs through `npx` (not a dependency of the workspace) in Playwright's Chromium.
 *
 *   npm run build && npm run build:site
 *   node apps/site/scripts/lighthouse-docs.mjs <out-dir> [path ...]
 *
 * Writes `<slug>.report.html` / `.report.json` per page and lighthouse.json; exits 1 below a threshold.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { serve } from './serve-out.mjs';

const LIGHTHOUSE = 'lighthouse@13.5.0';
const PATHS = ['/toaster/docs', '/toaster/docs/notifications'];
const THRESHOLDS = { performance: 0.9, accessibility: 1, cls: 0.01 };

const [outDir, ...only] = process.argv.slice(2);
if (!outDir) {
  console.error('Usage: node apps/site/scripts/lighthouse-docs.mjs <out-dir> [path ...]');
  process.exit(2);
}
const out = resolve(outDir);
mkdirSync(out, { recursive: true });
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  for (const path of only.length ? only : PATHS) {
    const name = path.replace(/^\//u, '').replaceAll('/', '-') || 'root';
    const prefix = join(out, name);
    // Mobile is Lighthouse's default form factor (Moto G Power, slow 4G, 4× CPU throttling).
    // Asynchronous: the static server lives in this process and must keep answering.
    await promisify(execFile)(
      'npx',
      ['--yes', LIGHTHOUSE, `${base}${path}`, '--quiet', '--output=json', '--output=html', `--output-path=${prefix}`, '--chrome-flags=--headless=new', '--only-categories=performance,accessibility,best-practices,seo'],
      { env: { ...process.env, CHROME_PATH: chromium.executablePath() }, maxBuffer: 64 * 1024 * 1024 },
    );
    const report = JSON.parse(readFileSync(`${prefix}.report.json`, 'utf8'));
    const metric = (id) => report.audits[id]?.numericValue;
    const entry = {
      path,
      performance: report.categories.performance.score,
      accessibility: report.categories.accessibility.score,
      bestPractices: report.categories['best-practices'].score,
      seo: report.categories.seo.score,
      fcp: Math.round(metric('first-contentful-paint')),
      lcp: Math.round(metric('largest-contentful-paint')),
      tbt: Math.round(metric('total-blocking-time')),
      cls: Number(metric('cumulative-layout-shift').toFixed(4)),
      si: Math.round(metric('speed-index')),
      failedAccessibility: Object.values(report.audits).filter((audit) => audit.score === 0 && report.categories.accessibility.auditRefs.some((ref) => ref.id === audit.id)).map((audit) => audit.id),
    };
    entry.ok = entry.performance >= THRESHOLDS.performance && entry.accessibility >= THRESHOLDS.accessibility && entry.cls < THRESHOLDS.cls;
    results.push(entry);
    console.log(`${path}: ${entry.ok ? 'ok' : 'FAILED'} — performance ${entry.performance * 100}, accessibility ${entry.accessibility * 100}, best practices ${entry.bestPractices * 100}, SEO ${entry.seo * 100}; FCP ${entry.fcp} ms, LCP ${entry.lcp} ms, TBT ${entry.tbt} ms, CLS ${entry.cls}, SI ${entry.si} ms${entry.failedAccessibility.length ? `; a11y: ${entry.failedAccessibility.join(', ')}` : ''}`);
  }
} finally {
  server.close();
}
writeFileSync(join(out, 'lighthouse.json'), JSON.stringify(results, null, 2) + '\n');
process.exit(results.every((entry) => entry.ok) ? 0 : 1);
