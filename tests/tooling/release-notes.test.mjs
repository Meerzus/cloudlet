import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { releaseNotes, releaseNotesForTag } from '../../scripts/release-notes.mjs';

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

test('reads the notes from the changelog of the tag\'s package', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cloudlet-release-notes-'));
  try {
    await mkdir(join(directory, 'packages/agent'), { recursive: true });
    await writeFile(join(directory, 'packages/agent/package.json'), JSON.stringify({ name: '@cloudlet/agent', version: '0.1.0-rc.1' }));
    await writeFile(join(directory, 'packages/agent/CHANGELOG.md'), '# Changelog\n\n## 0.1.0-rc.1 — 2026-12-01\n\nThe bridge.\n');
    await writeFile(join(directory, 'CHANGELOG.md'), '# Changelog\n\n## 0.1.0-rc.1 — 2026-12-01\n\nNot this one.\n');
    assert.equal(await releaseNotesForTag('agent-v0.1.0-rc.1', { root: directory }), 'The bridge.\n');
    await writeFile(join(directory, 'packages/agent/CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n- Pending.\n');
    await assert.rejects(releaseNotesForTag('agent-v0.1.0-rc.1', { root: directory }), /^Error: packages\/agent\/CHANGELOG\.md: CHANGELOG\.md has no "## 0\.1\.0-rc\.1" section/u);
    await assert.rejects(releaseNotesForTag('v0.1.0-rc.1', { root: directory }), /release tags are toast-vX\.Y\.Z or agent-vX\.Y\.Z/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the CLI prints the Toaster notes for its tag and refuses the old form and a mismatch', async () => {
  const { version } = JSON.parse(await readFile(resolve(root, 'packages/toast/package.json'), 'utf8'));
  const ok = spawnSync(process.execPath, [script, `toast-v${version}`], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, releaseNotes(await readFile(resolve(root, 'packages/toast/CHANGELOG.md'), 'utf8'), version));
  const old = spawnSync(process.execPath, [script, `v${version}`], { encoding: 'utf8' });
  assert.notEqual(old.status, 0);
  assert.match(old.stderr, /release tags are toast-vX\.Y\.Z or agent-vX\.Y\.Z/u);
  const wrong = spawnSync(process.execPath, [script, 'toast-v0.0.1'], { encoding: 'utf8' });
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /does not match/u);
});

test('the CLI names the bridge changelog when its version has no section yet', async () => {
  const { version } = JSON.parse(await readFile(resolve(root, 'packages/agent/package.json'), 'utf8'));
  const changelog = await readFile(resolve(root, 'packages/agent/CHANGELOG.md'), 'utf8');
  const result = spawnSync(process.execPath, [script, `agent-v${version}`], { encoding: 'utf8' });
  if (changelog.includes(`\n## ${version} `)) {
    assert.equal(result.status, 0, result.stderr);
  } else {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`^packages/agent/CHANGELOG\\.md: .*"## ${version.replaceAll('.', '\\.')}" section`, 'u'));
  }
});
