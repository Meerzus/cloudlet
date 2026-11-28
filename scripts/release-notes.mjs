import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readReleaseTarget } from './release-target.mjs';

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
 * The notes of the version a release tag names, read from the CHANGELOG of that tag's package.
 * Fails when the tag is not a release tag, does not match the package's manifest, or the version
 * has no section; the message names the package's CHANGELOG.
 */
export async function releaseNotesForTag(tag, { root }) {
  const target = await readReleaseTarget(tag, { root });
  const changelog = await readFile(resolve(root, target.changelog), 'utf8');
  try {
    return releaseNotes(changelog, target.version);
  } catch (error) {
    throw new Error(`${target.changelog}: ${error.message}`, { cause: error });
  }
}

/**
 * `node scripts/release-notes.mjs toast-v1.2.3`: checks that the tag names the version of the
 * package's manifest and prints that version's notes from the package's CHANGELOG. The release
 * workflow runs it before publishing anything.
 */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const [tag] = process.argv.slice(2);
  try {
    if (!tag) throw new Error('Usage: node scripts/release-notes.mjs <toast-vX.Y.Z | agent-vX.Y.Z>');
    process.stdout.write(await releaseNotesForTag(tag, { root }));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
