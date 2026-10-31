import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The CHANGELOG section of one version, without its `## <version> — <date>` heading: the body of
 * the GitHub Release. Throws when the version has no section, so a tag without notes fails.
 */
export function releaseNotes(changelog, version) {
  const lines = changelog.split('\n');
  const escaped = version.replaceAll('.', '\\.');
  const start = lines.findIndex((line) => new RegExp(`^## ${escaped}(?: |$)`, 'u').test(line));
  assert.ok(start >= 0, `CHANGELOG.md has no "## ${version}" section`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
  assert.ok(body, `The "## ${version}" section of CHANGELOG.md is empty`);
  return `${body}\n`;
}

/**
 * `node scripts/release-notes.mjs v1.2.3`: checks that the tag names the version of
 * packages/toast/package.json and prints that version's notes. The release workflow runs it
 * before publishing anything.
 */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const [tag] = process.argv.slice(2);
  assert.ok(tag, 'Usage: node scripts/release-notes.mjs v<version>');
  const { version } = JSON.parse(await readFile(resolve(root, 'packages/toast/package.json'), 'utf8'));
  assert.equal(tag, `v${version}`, `Tag ${tag} does not match @cloudlet/toast ${version}`);
  process.stdout.write(releaseNotes(await readFile(resolve(root, 'CHANGELOG.md'), 'utf8'), version));
}
