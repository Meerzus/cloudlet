import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Fails when private material is tracked or referenced: the private docs folder, agent instructions,
 * local settings and env files must never be committed, and public files must not point into them.
 * Patterns for internal names live in .leakcheck.json; add one whenever the private docs gain a new
 * kind of name. Run from the repository root: `node scripts/check-leaks.mjs`.
 */
const PRIVATE_PATHS = [/^docs\//u, /^CLAUDE\.md$/u, /(^|\/)CLAUDE\.local\.md$/u, /^\.claude\/settings\.local\.json$/u, /(^|\/)\.env(?!\.example$)(\..+)?$/u];
const config = existsSync('.leakcheck.json') ? JSON.parse(readFileSync('.leakcheck.json', 'utf8')) : {};
const patterns = (config.patterns ?? []).map((source) => new RegExp(source, 'u'));
const skip = new Set(['scripts/check-leaks.mjs', '.leakcheck.json', ...(config.skip ?? [])]);

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const problems = [];
for (const file of files) {
  if (PRIVATE_PATHS.some((path) => path.test(file))) problems.push(`${file}: private file is tracked`);
  if (skip.has(file) || !patterns.length) continue;
  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue; // binary
  bytes.toString('utf8').split('\n').forEach((line, index) => {
    for (const pattern of patterns) if (pattern.test(line)) problems.push(`${file}:${index + 1}: matches ${pattern.source}`);
  });
}

if (problems.length) {
  console.error(`Private material in the public repository:\n${problems.map((line) => `  ${line}`).join('\n')}`);
  process.exit(1);
}
console.log(`Leak check: ${files.length} tracked files, nothing private.`);
