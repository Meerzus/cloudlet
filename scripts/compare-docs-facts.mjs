#!/usr/bin/env node
/**
 * Facts of the Toaster docs that a rewrite lost: reads a snapshot of the old `llms-full.txt`,
 * takes three kinds of facts from the old pages and looks for each one in the new text.
 *
 *   - code: inline code spans of the prose and tables (`attention: 'open'`), and the API names of
 *     fenced blocks: identifiers, member and property names, short string literals, CSS custom
 *     properties and shell arguments (`acknowledgeOverflow`, `'assertive'`, `--cloudlet-gap`);
 *   - number: numbers in prose and tables, with their unit when they have one (`600ms`,
 *     `6 seconds`, `48rem`, `100`, `16.4`);
 *   - heading: page titles and section headings of the old pages.
 *
 * A code span is found when the same text (whitespace collapsed, quotes unified) is anywhere in the
 * new text; a name from a fenced block, when it is in the new text as a whole word; a number, when
 * the new text has the same value with the same unit (`600 ms` = `600ms`, `6 s` = `6 seconds`),
 * a bare number with any unit; a heading, when the new text has it as a heading or as a phrase.
 * The search covers the whole new text, so a fact moved to another page is found. The script
 * guards tokens, not sentences: a rule written only in words is checked by reading.
 *
 * Usage:
 *   node scripts/compare-docs-facts.mjs [--pages <slug,…>] [--old <file>] [--new <file>] [--json <file>]
 *
 *   --pages  old pages to check, by their address under /docs/components/toaster: `index` (the
 *            component page), `installation`, `api/toaster`, …; default: every Toaster page.
 *   --old    the snapshot (default artifacts/docs-facts/baseline/llms-full.txt).
 *   --new    the text to check (default apps/site/out/llms-full.txt, after `npm run build:site`).
 *   --json   also write the full report, every place of every fact, to this file.
 *
 * Reading the report: the first line counts the facts by kind and the missing ones; then each
 * missing fact with its old place — page › heading :line in the snapshot — and how many more
 * places in the old text had it. Every missing fact is either found reworded in the new text or
 * written down with its reason. Exit code 0 whenever a report is printed: this is a report, not a
 * gate; 1 only for wrong arguments or a missing file.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The old pages are the Toaster's: every page whose source address starts here. */
const TOASTER_URL = 'https://cloudlet.dev/docs/components/toaster';

/**
 * Lines and sections that are not facts, each with its reason. A line is tested after trimming.
 */
const IGNORED_LINES = [
  // Generated above the first demo block of a page (docs-ui-strings.ts, demoNoteBefore): output, not content.
  [/^Snippets assume /u, 'demo note of the docs output'],
  // The page header of the output: title (kept as a heading fact), description and address.
  [/^Source: https?:\/\//u, 'page address in the output header'],
  // Page separator of llms-full.txt.
  [/^---$/u, 'page separator'],
];
/** The description line right under a page title (`> …`) is the page's metadata, not its content. */
const IGNORE_PAGE_DESCRIPTION = true;
/** Whole sections whose content repeats the sidebar: their links and words are not facts. */
const IGNORED_SECTIONS = [/^next steps$/iu];
/** Names from fenced blocks that any TypeScript, JSX, CSS or shell text has: not facts about the Toaster. */
const COMMON_NAMES = new Set([
  'import', 'from', 'export', 'default', 'const', 'let', 'var', 'function', 'return', 'if', 'else', 'await',
  'async', 'new', 'true', 'false', 'null', 'undefined', 'typeof', 'type', 'interface', 'extends', 'as', 'of',
  'in', 'for', 'while', 'try', 'catch', 'finally', 'throw', 'void', 'this', 'class', 'satisfies', 'keyof',
  'string', 'number', 'boolean', 'unknown', 'never', 'object', 'any', 'Promise', 'Error', 'console', 'log',
  'warn', 'error', 'React', 'props', 'children', 'div', 'span', 'button', 'svg', 'path', 'className', 'onClick',
  'npm', 'npx', 'install', 'add', 'pnpm', 'yarn', 'bun', 'use', 'client', 'app', 'src', 'tsx', 'ts', 'css',
]);
/** Units a number may carry, with the canonical name both texts are compared by. */
const UNITS = [
  [/^(?:ms|milliseconds?)$/u, 'ms'],
  [/^(?:s|secs?|seconds?)$/u, 's'],
  [/^(?:min|minutes?)$/u, 'min'],
  [/^(?:h|hours?)$/u, 'h'],
  [/^(?:days?)$/u, 'day'],
  [/^(?:px|rem|em|vh|vw|dvh|svh|fps|hz|deg)$/iu, null],
  [/^(?:%|percent)$/u, '%'],
  [/^(?:b|bytes?)$/iu, 'B'],
  [/^(?:kb|kib)$/iu, 'KB'],
  [/^(?:mb|mib)$/iu, 'MB'],
  [/^(?:m|km)$/u, null],
  [/^(?:x|×)$/u, 'x'],
];
const UNIT_WORD = /^(?:\s?(%|×|[A-Za-z]+))?/u;

function fail(message) {
  console.error(`compare-docs-facts: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { old: 'artifacts/docs-facts/baseline/llms-full.txt', new: 'apps/site/out/llms-full.txt' };
  for (let index = 0; index < argv.length; index += 2) {
    const [name, value] = [argv[index], argv[index + 1]];
    if (!['--pages', '--old', '--new', '--json'].includes(name) || value === undefined || value.startsWith('--')) {
      fail(`unknown or incomplete argument "${name}"\nusage: node scripts/compare-docs-facts.mjs [--pages <slug,…>] [--old <file>] [--new <file>] [--json <file>]`);
    }
    options[name.slice(2)] = value;
  }
  return options;
}

function readText(file) {
  const path = resolve(ROOT, file);
  if (!existsSync(path)) fail(`${file} is missing${file.includes('apps/site/out') ? ' — run npm run build:site first' : ''}`);
  return readFileSync(path, 'utf8');
}

/** Collapsed whitespace and one kind of quotes: `{ kind:"text" }` and `{ kind: 'text' }` are the same span. */
const normalizeCode = (code) => code.replace(/["`]/gu, "'").replace(/\s+/gu, ' ').replace(/\s*([{}()[\],:;=])\s*/gu, '$1').trim();
/** A heading as words: no code marks or emphasis, lower case, `&` as `and`. */
const normalizeWords = (text) => text.replace(/[`*_]/gu, '').replace(/&/gu, ' and ').replace(/[^\p{L}\p{N}.'+-]+/gu, ' ').toLowerCase().trim();
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

function unitOf(word) {
  if (!word) return '';
  for (const [pattern, canonical] of UNITS) if (pattern.test(word)) return canonical ?? word.toLowerCase();
  return undefined;
}

/**
 * Numbers of a line of prose: links, URLs and code spans removed first, list markers too.
 * `10,000` is `10000`; a version such as `1.3.0` is one token. A number glued to letters that
 * are not a unit (`h1`, `3rd`) is not a number.
 */
function numbersOf(line) {
  const prose = line
    .replace(/\]\([^)]*\)/gu, ']')
    .replace(/https?:\/\/\S+/gu, '')
    .replace(/`[^`]*`/gu, ' ')
    .replace(/^\s*(?:[-*]|\d+\.)\s+/u, '')
    .replace(/#[\w-]+/gu, '');
  const result = [];
  for (const match of prose.matchAll(/(?<![\p{L}\d.,_-])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)*)/gu)) {
    const rest = prose.slice(match.index + match[0].length);
    if (/^[.,]\d/u.test(rest)) continue;
    const word = UNIT_WORD.exec(rest)?.[1];
    const glued = word !== undefined && !/^\s/u.test(rest);
    let unit = unitOf(word);
    if (unit === undefined) {
      if (glued) continue;
      unit = '';
    }
    result.push({ value: match[1].replace(/,/gu, ''), unit, text: unit ? `${match[1]}${/^\s/u.test(rest) ? ' ' : ''}${word}` : match[1] });
  }
  return result;
}

/** Names of a fenced block that say something about the API, by the block's language. */
function codeNamesOf(line, language) {
  const names = new Set();
  if (['css', 'html'].includes(language)) {
    // Quoted paths (`@import "…/styles.css"`) are not class names; custom properties are not plain properties.
    const code = line.replace(/'[^']*'|"[^"]*"/gu, ' ');
    for (const match of code.matchAll(/--[\w-]+|(?<![\w-])\.[a-z][\w-]*|(?<![\w-])data-[\w-]+/gu)) names.add(match[0]);
    if (language === 'css') for (const match of code.matchAll(/(?<![\w-])[a-z][\w-]*(?=\s*:)/gu)) names.add(match[0]);
  } else if (['sh', 'bash', 'shell', 'text'].includes(language)) {
    for (const match of line.matchAll(/@[\w-]+\/[\w./-]+|--[\w-]+|[\w./-]+\.(?:css|json|tsx?|mjs)\b/gu)) names.add(match[0]);
  } else {
    // String literals without spaces are values of the API (`'open'`, `'@cloudlet/toast/styles.css'`);
    // sentences in quotes are sample copy.
    // A capitalised word in quotes is sample copy too (`'Cumulus'`, `'Saved'`).
    for (const match of line.matchAll(/'([^'\s]{1,60})'|"([^"\s]{1,60})"/gu)) {
      const value = match[1] ?? match[2];
      if (!/^\p{Lu}\p{Ll}*$/u.test(value)) names.add(value);
    }
    // Template literals are sample copy too, except the expressions inside them.
    // Comments and the text between JSX tags (`>Save forecast<`) are prose of the example.
    const code = line
      .replace(/\/\*.*?\*\//gu, ' ')
      .replace(/(?<![=-])>([^<>{}]*)</gu, '><')
      .replace(/^\s*[\p{L}][\p{L}\s,.!?'’-]*$/u, ' ')
      .replace(/`([^`]*)`/gu, (_, body) => ` ${[...body.matchAll(/\$\{([^}]*)\}/gu)].map((part) => part[1]).join(' ')} `)
      .replace(/'[^']*'|"[^"]*"|\/\/.*$/gu, ' ');
    for (const match of code.matchAll(/[A-Za-z_$][\w$]*/gu)) names.add(match[0]);
  }
  return [...names].filter((name) => name.length > 1 && !COMMON_NAMES.has(name) && !/^\d/u.test(name));
}

/** Pages of an llms-full.txt: a `# Title` line followed by its `Source:` line opens a page. */
function pagesOf(text) {
  const lines = text.split('\n');
  const pages = [];
  for (const [index, line] of lines.entries()) {
    const title = /^# (.+)$/u.exec(line)?.[1];
    if (!title) continue;
    const sourceLine = lines.slice(index + 1, index + 6).find((next) => next.startsWith('Source: '));
    if (!sourceLine) continue;
    const url = sourceLine.slice('Source: '.length).trim();
    pages.push({ title, url, start: index });
  }
  return pages.map((page, index) => ({ ...page, end: pages[index + 1]?.start ?? lines.length, lines }));
}

const slugOf = (url) => (url === TOASTER_URL ? 'index' : url.slice(TOASTER_URL.length + 1));

/** Every fact of one old page with its place. */
function factsOf(page) {
  const facts = [];
  const place = (line, heading) => ({ page: slugOf(page.url), title: page.title, heading, line: line + 1 });
  facts.push({ kind: 'heading', value: page.title, ...place(page.start, page.title) });
  let heading = page.title;
  let skipping = null;
  let fence = null;
  let afterTitle = true;
  for (let index = page.start + 1; index < page.end; index += 1) {
    const raw = page.lines[index];
    const line = raw.trim();
    const open = /^(`{3,}|~{3,})\s*([\w-]*)/u.exec(line);
    if (fence) {
      if (line.startsWith(fence.marker) && line.replace(/[`~]/gu, '') === '') fence = null;
      else if (!skipping) for (const name of codeNamesOf(raw, fence.language)) facts.push({ kind: 'code', value: name, block: true, ...place(index, heading) });
      continue;
    }
    if (open) {
      fence = { marker: open[1], language: open[2].toLowerCase() };
      continue;
    }
    const sectionTitle = /^(#{2,6}) (.+)$/u.exec(line);
    if (sectionTitle) {
      const level = sectionTitle[1].length;
      if (skipping && level <= skipping.level) skipping = null;
      if (!skipping && IGNORED_SECTIONS.some((pattern) => pattern.test(sectionTitle[2].trim()))) skipping = { level };
      if (skipping) continue;
      heading = sectionTitle[2].trim();
      facts.push({ kind: 'heading', value: heading, ...place(index, heading) });
      continue;
    }
    if (skipping || !line) continue;
    if (IGNORED_LINES.some(([pattern]) => pattern.test(line))) continue;
    if (afterTitle && IGNORE_PAGE_DESCRIPTION && line.startsWith('> ')) {
      afterTitle = false;
      continue;
    }
    afterTitle = false;
    for (const match of line.matchAll(/`([^`]+)`/gu)) facts.push({ kind: 'code', value: match[1], ...place(index, heading) });
    for (const number of numbersOf(line)) facts.push({ kind: 'number', value: number.text, number, ...place(index, heading) });
  }
  return facts;
}

/** What the new text offers to search in, built once. */
function indexOf(text) {
  const values = new Set();
  const valueUnits = new Set();
  for (const line of text.replace(/`/gu, ' ').split('\n')) {
    for (const number of numbersOf(line)) {
      values.add(number.value);
      valueUnits.add(`${number.value}|${number.unit}`);
    }
  }
  const headings = new Set(text.split('\n').flatMap((line) => {
    const heading = /^#{1,6} (.+)$/u.exec(line.trim())?.[1];
    return heading ? [normalizeWords(heading)] : [];
  }));
  return { text, code: normalizeCode(text), words: ` ${normalizeWords(text.replace(/\n/gu, ' '))} `, values, valueUnits, headings };
}

function isFound(fact, index) {
  if (fact.kind === 'code' && fact.block) return new RegExp(`(?<![\\w$-])${escape(fact.value)}(?![\\w$])`, 'u').test(index.text);
  if (fact.kind === 'code') return index.code.includes(normalizeCode(fact.value));
  if (fact.kind === 'number') return fact.number.unit ? index.valueUnits.has(`${fact.number.value}|${fact.number.unit}`) : index.values.has(fact.number.value);
  const words = normalizeWords(fact.value);
  return index.headings.has(words) || index.words.includes(` ${words} `);
}

/** One fact per kind and value, with every place of it in the old text. */
function group(facts) {
  const byKey = new Map();
  for (const fact of facts) {
    const key = fact.kind === 'number' ? `number|${fact.number.value}|${fact.number.unit}` : `${fact.kind}${fact.block ? '-block' : ''}|${fact.kind === 'code' && !fact.block ? normalizeCode(fact.value) : fact.value}`;
    const entry = byKey.get(key) ?? { kind: fact.kind, value: fact.value, fromBlock: Boolean(fact.block), fact, places: [] };
    entry.places.push({ page: fact.page, heading: fact.heading, line: fact.line });
    byKey.set(key, entry);
  }
  return [...byKey.values()];
}

const options = parseArgs(process.argv.slice(2));
const oldText = readText(options.old);
const newText = readText(options.new);
const toasterPages = pagesOf(oldText).filter((page) => page.url === TOASTER_URL || page.url.startsWith(`${TOASTER_URL}/`));
if (!toasterPages.length) fail(`${options.old} has no Toaster pages (no "Source: ${TOASTER_URL}…" line)`);
const wanted = options.pages?.split(',').map((slug) => slug.trim()).filter(Boolean);
const unknown = wanted?.filter((slug) => !toasterPages.some((page) => slugOf(page.url) === slug)) ?? [];
if (unknown.length) fail(`no such page in the snapshot: ${unknown.join(', ')}; pages: ${toasterPages.map((page) => slugOf(page.url)).join(', ')}`);
const pages = wanted ? toasterPages.filter((page) => wanted.includes(slugOf(page.url))) : toasterPages;

const index = indexOf(newText);
const facts = group(pages.flatMap(factsOf));
const missing = facts.filter((entry) => !isFound(entry.fact, index));
const count = (list, kind) => list.filter((entry) => entry.kind === kind).length;

console.log(
  `compare-docs-facts: ${pages.length} old page(s), ${facts.length} facts (${count(facts, 'code')} code, ${count(facts, 'number')} numbers, ${count(facts, 'heading')} headings); ${missing.length} missing` +
    (missing.length ? ` (${count(missing, 'code')} code, ${count(missing, 'number')} numbers, ${count(missing, 'heading')} headings)` : ''),
);
console.log(`  old: ${options.old}\n  new: ${options.new}`);
let lastPage;
for (const entry of missing.sort((a, b) => a.places[0].line - b.places[0].line)) {
  const [first, ...rest] = entry.places;
  if (first.page !== lastPage) {
    console.log(`\n${first.page}`);
    lastPage = first.page;
  }
  const what = entry.kind === 'code' && entry.fromBlock ? 'name' : entry.kind;
  console.log(`  ${what.padEnd(7)} ${entry.kind === 'code' && !entry.fromBlock ? `\`${entry.value}\`` : entry.value}  — ${first.heading} :${first.line}${rest.length ? ` (+${rest.length} more)` : ''}`);
}

if (options.json) {
  const report = {
    old: options.old,
    new: options.new,
    pages: pages.map((page) => slugOf(page.url)),
    facts: facts.length,
    missing: missing.map(({ kind, value, fromBlock, places }) => ({ kind: kind === 'code' && fromBlock ? 'name' : kind, value, places })),
  };
  writeFileSync(resolve(ROOT, options.json), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nreport: ${options.json}`);
}
