import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Export coverage of the documentation: every name the package entry exports —
 * values, explicit `export type {…}` and everything `export type *` brings from the contracts —
 * must appear in the site's documentation pages. The names are read from the sources (the
 * installed TypeScript 7 has no compiler API), so there is no second list to maintain.
 *
 * A name counts only inside code (an inline code span or a fenced block) and only as a whole
 * word: prose and table headers say "Description" or "Priority" as English words, and
 * `DiagnosticCode` is not a mention of `Diagnostic`.
 */

const DECLARATION = /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:interface|type|const|let|var|function\*?|class|enum)\s+([A-Za-z_$][\w$]*)/gmu;
const LIST = /^export\s+(?:type\s+)?\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/gmu;
const STAR = /^export\s+(?:type\s+)?\*\s+from\s*['"]([^'"]+)['"]/gmu;

/** A relative import of the sources (`./x.js` → `./x.ts`). */
function resolveModule(from, specifier) {
  if (!specifier.startsWith('.')) throw new Error(`${from}: only relative re-exports are supported (${specifier})`);
  return resolve(dirname(from), specifier.replace(/\.js$/u, '.ts'));
}

/**
 * Exported names of a TypeScript module, sorted: declarations, `export {…}` / `export type {…}`
 * lists (the exported alias of `a as b`), and every name of a module re-exported with
 * `export *` / `export type *`, recursively. Enough for a barrel of declarations, which is
 * what the package entry and its contracts are; anything it cannot read is an error.
 */
export async function exportedNames(entry, seen = new Set()) {
  if (seen.has(entry)) return [];
  seen.add(entry);
  // Comments may mention `export`; strings never start a line with it in these files.
  const source = (await readFile(entry, 'utf8')).replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');
  const names = new Set();
  for (const match of source.matchAll(DECLARATION)) names.add(match[1]);
  for (const match of source.matchAll(LIST)) {
    for (const item of match[1].split(',').map((part) => part.trim()).filter(Boolean)) {
      names.add(item.replace(/^type\s+/u, '').split(/\s+as\s+/u).at(-1).trim());
    }
  }
  for (const match of source.matchAll(STAR)) {
    for (const name of await exportedNames(resolveModule(entry, match[1]), seen)) names.add(name);
  }
  if (/^export\s+default\b/mu.test(source)) names.add('default');
  return [...names].sort();
}

/** The text of every code span and fenced block of a Markdown / MDX document. */
export function codeText(markdown) {
  const parts = [];
  const prose = [];
  let fence;
  for (const line of markdown.split('\n')) {
    if (!fence) {
      const start = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
      if (start) fence = start[1];
      else prose.push(line);
      continue;
    }
    if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`, 'u').test(line)) fence = undefined;
    else parts.push(line);
  }
  // Inline code: a run of backticks closed by a run of the same length (CommonMark).
  for (const match of prose.join('\n').matchAll(/(`+)([\s\S]*?[^`])\1(?!`)/gu)) parts.push(match[2]);
  return parts.join('\n');
}

/** Names that no document mentions in code. */
export function undocumented(names, documents) {
  const code = documents.map(codeText).join('\n');
  return names.filter((name) => !new RegExp(`(?<![\\w$])${name.replaceAll('$', '\\$')}(?![\\w$])`, 'u').test(code));
}

/** Checks `entry` against every `.mdx` file under `content`; returns the counts and the missing names. */
export async function checkCoverage(entry, content) {
  const files = (await readdir(content, { recursive: true })).filter((file) => file.endsWith('.mdx')).sort();
  const documents = await Promise.all(files.map((file) => readFile(resolve(content, file), 'utf8')));
  const names = await exportedNames(entry);
  return { names: names.length, files: files.length, missing: undocumented(names, documents) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const [entry = 'packages/toast/src/index.ts', content = 'apps/site/content/docs/en'] = process.argv.slice(2);
  const result = await checkCoverage(resolve(root, entry), resolve(root, content));
  if (result.missing.length) {
    console.error(`Documentation coverage: ${result.missing.length} of ${result.names} exports of ${entry} are not mentioned in code in ${content}/**/*.mdx:`);
    for (const name of result.missing) console.error(`  ${name}`);
    process.exit(1);
  }
  console.log(`Documentation coverage: all ${result.names} exports of ${entry} are documented in ${result.files} pages`);
}
