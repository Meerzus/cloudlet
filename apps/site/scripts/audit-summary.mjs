#!/usr/bin/env node
/**
 * A short Markdown summary of one audit's report, for the job page of the audits workflow
 * (.github/workflows/audits.yml): appended to $GITHUB_STEP_SUMMARY when it is set, printed otherwise.
 * It only reads; the audit's own exit code is the verdict. A report that is missing (the audit died
 * before writing it) is said so, not an error.
 *
 *   node apps/site/scripts/audit-summary.mjs <kind> <report> [--title "…"] [--lines N]
 *
 * Kinds and their reports:
 *   landing     axe-<browser>.json from audit-landing.mjs — scenarios, axe violations, Tab stops, console errors
 *   picker      color-picker-<browser>.json from audit-color-picker.mjs — contrast by route and mode, picker checks
 *   budget      the --json file of first-screen-budget.mjs — each budget line against its limit
 *   lighthouse  lighthouse.json from lighthouse-docs.mjs — the median scores and metrics per page
 *   walk        report.json from record-docs.mjs or record-playground.mjs — failures per scenario
 *   log         any log file — its last lines (default 30) in a code block
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args.splice(index, 2)[1] : fallback;
};
const title = option('--title', null);
const lines = Number(option('--lines', '30'));
const [kind, file] = args;
const KINDS = ['landing', 'picker', 'budget', 'lighthouse', 'walk', 'log'];
if (!KINDS.includes(kind) || !file) {
  console.error(`Usage: node apps/site/scripts/audit-summary.mjs <${KINDS.join('|')}> <report> [--title "…"] [--lines N]`);
  process.exit(2);
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const cell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => ' --- ').join('|')}|`, ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)].join('\n');
const list = (items, limit = 20) => [...items.slice(0, limit).map((item) => `- ${item}`), ...(items.length > limit ? [`- … and ${items.length - limit} more (see the artifact)`] : [])].join('\n');
const mark = (ok) => (ok ? '✅' : '❌');
/** A Lighthouse score as a percentage, a median's half point kept (89.5 is below 90, and must not read as 90). */
const score = (value) => String(Math.round(value * 1000) / 10);

function landing(report) {
  const rows = [];
  const problems = [];
  for (const [scenario, entry] of Object.entries(report)) {
    const bad = entry.checks.filter((check) => check.violations.length);
    const keyboard = Object.entries(entry.keyboard ?? {});
    const keyFailures = keyboard.reduce((sum, [, pass]) => sum + pass.failures.length, 0);
    const still = entry.still ? Object.values(entry.still).every((layout) => !layout.lenis && !layout.pinSpacers && !layout.moved) : null;
    const narrow = entry.narrow ? Object.values(entry.narrow).every((width) => width <= 320) : null;
    // A scenario cut short (the audit threw) is not green, whatever it had checked so far.
    const complete = entry.complete !== false;
    const ok = complete && !bad.length && !keyFailures && !entry.errors.length && still !== false && narrow !== false;
    if (!complete) problems.push(`${scenario}: interrupted before it finished — partial results`);
    rows.push([mark(ok) + ' ' + scenario + (complete ? '' : ' (interrupted)'), entry.checks.length, bad.length, keyboard.map(([path, pass]) => `${path} ${pass.stops}`).join(', '), keyFailures, entry.errors.length, still === null ? '—' : mark(still), narrow === null ? '—' : mark(narrow)]);
    for (const check of bad) for (const violation of check.violations) problems.push(`${scenario} \`${check.path}\` ${check.at}: **${violation.id}** — ${violation.nodes.map((node) => node.target).join(', ')}`);
    for (const [path, pass] of keyboard) for (const stop of pass.failures) problems.push(`${scenario} keyboard \`${path}\`: ${JSON.stringify(stop)}`);
    for (const error of entry.errors) problems.push(`${scenario} console: ${error}`);
  }
  return [
    table(['Scenario', 'axe checks', 'with violations', 'Tab stops', 'keyboard failures', 'console errors', 'still (reduced)', '320 px'], rows),
    problems.length ? `\n**Problems**\n\n${list(problems)}` : '',
  ].join('\n');
}

function picker(report) {
  const out = [];
  if (report.contrast.length) {
    const groups = new Map();
    for (const entry of report.contrast) {
      const key = `${entry.route ?? 'picker'} · ${entry.mode}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    const rows = [...groups].map(([key, entries]) => {
      const passed = entries.filter((entry) => entry.passed).length;
      const worst = [...entries].sort((p, q) => p.p1 - q.p1)[0];
      return [mark(passed === entries.length) + ' ' + key, `${passed}/${entries.length}`, `${worst.p1}:1`, `${worst.label} (${worst.device}-${worst.colorScheme} ${worst.color})`];
    });
    out.push(`**Contrast** (text ≥ 4.5:1 at the 1st percentile of pixels)\n\n${table(['Route · mode', 'lines passed', 'tightest', 'where'], rows)}`);
    if (report.overContent.length) out.push(`Notes, not gates: ${report.overContent.length} header labels under 4.5:1 while content or paint is under the header.`);
  }
  if (report.pickers.length) {
    const checks = report.pickers.flatMap((entry) => Object.values(entry.checks));
    const passed = checks.filter((value) => value === 'passed').length;
    out.push(`**Pickers from the keyboard**: ${mark(passed === checks.length)} ${passed}/${checks.length} checks in ${report.pickers.length} pickers and panels`);
  }
  out.push(report.failures.length ? `**Failures**\n\n${list(report.failures)}` : '**No failures**');
  return out.join('\n\n');
}

function budget(report) {
  if (report.ok === null) return `_Measured only (${Object.keys(report.results).join(', ')}): the budget compares \`/\` with \`/toaster\`, so it was not checked._`;
  // A failing row shows its bytes: 150.0 KB against 150.0 KB would not say why it failed.
  const rows = report.budget.map((line) => [mark(line.ok) + ' ' + line.check, line.ok ? kb(line.value) : `${kb(line.value)} (${line.value} B, ${line.value - line.limit} B over)`, line.ok ? kb(line.limit) : `${kb(line.limit)} (${line.limit} B)`]);
  const js = Object.entries(report.results).map(([path, result]) => `\`${path}\` ${kb(result.js.bytes)} in ${result.js.scripts} scripts`);
  return [table(['Budget', 'value', 'limit'], rows), `\nStart JS (gzip -9): ${js.join(' · ')}`].join('\n');
}

function lighthouse(report) {
  const rows = report.map((entry) => [
    mark(entry.ok) + ' `' + entry.path + '`',
    score(entry.performance) + (entry.runs ? ` (${entry.runs.map((run) => score(run.performance)).join(', ')})` : ''),
    score(entry.accessibility),
    score(entry.bestPractices),
    score(entry.seo),
    `${Math.round(entry.lcp)} ms`,
    `${Math.round(entry.tbt)} ms`,
    entry.cls,
  ]);
  return [
    table(['Page', 'Performance (runs)', 'Accessibility', 'Best practices', 'SEO', 'LCP', 'TBT', 'CLS'], rows),
    '\nMedians of the runs, mobile. A report, not a gate: thresholds are Performance ≥ 90, Accessibility = 100, CLS < 0.01; shared runners make Performance noisy.',
  ].join('\n');
}

function walk(report) {
  const entries = Array.isArray(report) ? report.map((entry) => [entry.name, entry]) : Object.entries(report);
  const rows = [];
  const problems = [];
  for (const [name, entry] of entries) {
    const failures = entry.failures ?? [];
    // The Playground's report names its console messages `errors`, the docs' `console`.
    const errors = entry.errors ?? entry.console ?? [];
    const violations = Object.values(entry.axe ?? {}).flatMap((value) => (Array.isArray(value) ? value : []));
    rows.push([mark(!failures.length && !errors.length && !violations.length) + ' ' + name, failures.length, errors.length, violations.length]);
    for (const failure of failures) problems.push(`${name}: ${typeof failure === 'string' ? failure : JSON.stringify(failure)}`);
    for (const error of errors) problems.push(`${name} console: ${error}`);
  }
  return [table(['Scenario', 'failures', 'console errors', 'axe violations'], rows), problems.length ? `\n**Problems**\n\n${list(problems)}` : ''].join('\n');
}

function log(text) {
  return ['```', ...text.trimEnd().split('\n').slice(-lines), '```'].join('\n');
}

let body;
if (!existsSync(file)) body = `_No report at \`${file}\`: the audit stopped before writing it — see the job's log._`;
else if (kind === 'log') body = log(readFileSync(file, 'utf8'));
else body = { landing, picker, budget, lighthouse, walk }[kind](JSON.parse(readFileSync(file, 'utf8')));

const markdown = `${title ? `### ${title}\n\n` : ''}${body}\n\n`;
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
else process.stdout.write(markdown);
