import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { releaseNotes } from '../../scripts/release-notes.mjs';

const root = resolve(import.meta.dirname, '../..');
const script = resolve(root, 'scripts/release-notes.mjs');

const CHANGELOG = [
  '# Changelog',
  '',
  '## 1.2.0 — 2026-11-02',
  '',
  'A minor release.',
  '',
  '### Fixes',
  '- One fix.',
  '',
  '## 1.2.0-rc.1 — 2026-11-01',
  '',
  'The candidate.',
  '',
  '## 1.1.0 — 2026-10-30',
  '',
  'The previous one.',
].join('\n');

test('returns the section of the version, without its heading', () => {
  assert.equal(releaseNotes(CHANGELOG, '1.2.0'), 'A minor release.\n\n### Fixes\n- One fix.\n');
  assert.equal(releaseNotes(CHANGELOG, '1.2.0-rc.1'), 'The candidate.\n');
  assert.equal(releaseNotes(CHANGELOG, '1.1.0'), 'The previous one.\n');
});

test('fails for a version without a section', () => {
  assert.throws(() => releaseNotes(CHANGELOG, '1.3.0'), /no "## 1\.3\.0" section/u);
  assert.throws(() => releaseNotes(CHANGELOG, '1.1'), /no "## 1\.1" section/u);
});

test('the CLI accepts only the tag of the package version', async () => {
  const { version } = JSON.parse(await readFile(resolve(root, 'packages/toast/package.json'), 'utf8'));
  const ok = spawnSync(process.execPath, [script, `v${version}`], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(ok.stdout.length > 0);
  const wrong = spawnSync(process.execPath, [script, 'v0.0.1'], { encoding: 'utf8' });
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /does not match/u);
});
