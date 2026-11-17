#!/usr/bin/env node
/**
 * Lighthouse mobile on the static export of the documentation: `/docs` and one
 * Guides page must reach Performance ≥ 90, Accessibility = 100 and CLS ≈ 0 (< 0.01). Lighthouse
 * runs through `npx` (not a dependency of the workspace) in Playwright's Chromium.
 *
 *   npm run build && npm run build:site
 *   node apps/site/scripts/lighthouse-docs.mjs <out-dir> [--runs N] [--report-only] [path ...]
 *
 * --runs runs each page N times and judges the median (per score and per metric): Performance moves by
 * a few points between runs, more so on shared CI runners. --report-only prints the thresholds but
 * never fails on them (the audits workflow uses it: there Lighthouse is a report, not a gate); a run
 * that cannot finish still fails.
 *
 * Writes `<slug>[-<run>].report.html` / `.report.json` per run and lighthouse.json (the median of each
 * page and its runs); exits 1 below a threshold.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { serve } from './serve-out.mjs';

const LIGHTHOUSE = 'lighthouse@13.5.0';
const PATHS = ['/docs/components/toaster', '/docs/components/toaster/notifications'];
const THRESHOLDS = { performance: 0.9, accessibility: 1, cls: 0.01 };
const USAGE = 'Usage: node apps/site/scripts/lighthouse-docs.mjs <out-dir> [--runs N] [--report-only] [path ...]';

const args = process.argv.slice(2);
const runsFlag = args.indexOf('--runs');
const runs = runsFlag >= 0 ? Number(args.splice(runsFlag, 2)[1]) : 1;
const reportOnlyFlag = args.indexOf('--report-only');
const reportOnly = reportOnlyFlag >= 0 && Boolean(args.splice(reportOnlyFlag, 1));
const [outDir, ...only] = args;
if (!outDir || !Number.isInteger(runs) || runs < 1) {
  console.error(USAGE);
  process.exit(2);
}
const out = resolve(outDir);
mkdirSync(out, { recursive: true });

/** The middle value (the mean of the two middle ones for an even count). */
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const NUMBERS = ['performance', 'accessibility', 'bestPractices', 'seo', 'fcp', 'lcp', 'tbt', 'cls', 'si'];

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  for (const path of only.length ? only : PATHS) {
    const name = path.replace(/^\//u, '').replaceAll('/', '-') || 'root';
    const samples = [];
    for (let run = 1; run <= runs; run += 1) {
      const prefix = join(out, runs > 1 ? `${name}-${run}` : name);
      // Mobile is Lighthouse's default form factor (Moto G Power, slow 4G, 4× CPU throttling).
      // Asynchronous: the static server lives in this process and must keep answering.
      await promisify(execFile)(
        'npx',
        ['--yes', LIGHTHOUSE, `${base}${path}`, '--quiet', '--output=json', '--output=html', `--output-path=${prefix}`, '--chrome-flags=--headless=new', '--only-categories=performance,accessibility,best-practices,seo'],
        { env: { ...process.env, CHROME_PATH: chromium.executablePath() }, maxBuffer: 64 * 1024 * 1024 },
      );
      const report = JSON.parse(readFileSync(`${prefix}.report.json`, 'utf8'));
      const metric = (id) => report.audits[id]?.numericValue;
      samples.push({
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
      });
    }
    const entry = { path, ...Object.fromEntries(NUMBERS.map((key) => [key, median(samples.map((sample) => sample[key]))])) };
    entry.failedAccessibility = [...new Set(samples.flatMap((sample) => sample.failedAccessibility))];
    entry.ok = entry.performance >= THRESHOLDS.performance && entry.accessibility >= THRESHOLDS.accessibility && entry.cls < THRESHOLDS.cls;
    if (runs > 1) entry.runs = samples;
    results.push(entry);
    const spread = runs > 1 ? ` (median of ${runs}: performance ${samples.map((sample) => Math.round(sample.performance * 100)).join(', ')})` : '';
    console.log(`${path}: ${entry.ok ? 'ok' : 'FAILED'} — performance ${Math.round(entry.performance * 100)}, accessibility ${Math.round(entry.accessibility * 100)}, best practices ${Math.round(entry.bestPractices * 100)}, SEO ${Math.round(entry.seo * 100)}; FCP ${Math.round(entry.fcp)} ms, LCP ${Math.round(entry.lcp)} ms, TBT ${Math.round(entry.tbt)} ms, CLS ${entry.cls}, SI ${Math.round(entry.si)} ms${entry.failedAccessibility.length ? `; a11y: ${entry.failedAccessibility.join(', ')}` : ''}${spread}`);
  }
} finally {
  server.close();
}
writeFileSync(join(out, 'lighthouse.json'), JSON.stringify(results, null, 2) + '\n');
const passed = results.every((entry) => entry.ok);
if (!passed && reportOnly) console.log('\nBelow a threshold — reported only (--report-only), not failed.');
process.exit(passed || reportOnly ? 0 : 1);
