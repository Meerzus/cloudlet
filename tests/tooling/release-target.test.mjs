import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PACKAGES, formatReleaseTarget, parseReleaseTag, readReleaseTarget } from '../../scripts/release-target.mjs';

const root = resolve(import.meta.dirname, '../..');
const script = resolve(root, 'scripts/release-target.mjs');

test('lists both packages of the repository', () => {
  assert.deepEqual(PACKAGES.map(({ key, name, dir }) => [key, name, dir]), [
    ['toast', '@cloudlet/toast', 'packages/toast'],
    ['agent', '@cloudlet/agent', 'packages/agent'],
  ]);
  assert.ok(Object.isFrozen(PACKAGES) && PACKAGES.every(Object.isFrozen));
});

test('a stable Toaster tag goes to latest and takes the Latest mark', () => {
  assert.deepEqual(parseReleaseTag('toast-v1.4.0'), {
    key: 'toast', name: '@cloudlet/toast', dir: 'packages/toast', version: '1.4.0', distTag: 'latest',
    prerelease: false, latest: true, tarball: 'cloudlet-toast-1.4.0.tgz', changelog: 'packages/toast/CHANGELOG.md',
  });
});

test('a prerelease goes to next and never takes the Latest mark', () => {
  assert.deepEqual(parseReleaseTag('toast-v1.4.0-rc.1'), {
    key: 'toast', name: '@cloudlet/toast', dir: 'packages/toast', version: '1.4.0-rc.1', distTag: 'next',
    prerelease: true, latest: false, tarball: 'cloudlet-toast-1.4.0-rc.1.tgz', changelog: 'packages/toast/CHANGELOG.md',
  });
  assert.deepEqual(parseReleaseTag('agent-v0.1.0-rc.1'), {
    key: 'agent', name: '@cloudlet/agent', dir: 'packages/agent', version: '0.1.0-rc.1', distTag: 'next',
    prerelease: true, latest: false, tarball: 'cloudlet-agent-0.1.0-rc.1.tgz', changelog: 'packages/agent/CHANGELOG.md',
  });
});

test('a stable bridge release goes to latest on npm but leaves the Latest mark to the Toaster', () => {
  const target = parseReleaseTag('agent-v0.1.0');
  assert.equal(target.distTag, 'latest');
  assert.equal(target.latest, false);
  assert.equal(target.tarball, 'cloudlet-agent-0.1.0.tgz');
});

test('refuses every other tag, including the old vX.Y.Z form', () => {
  for (const tag of ['v1.3.0', 'toast-1.4.0', 'toast-v1.4', 'toast-v1.4.0-next.0', 'foo-v1.0.0', 'toast-v1.4.0-rc', 'agent-v0.1.0 ', '', undefined]) {
    assert.throws(() => parseReleaseTag(tag), /release tags are toast-vX\.Y\.Z or agent-vX\.Y\.Z/u, String(tag));
  }
});

test('prints key=value lines for $GITHUB_OUTPUT', () => {
  assert.equal(formatReleaseTarget(parseReleaseTag('agent-v0.1.0-rc.1')), [
    'package=agent', 'name=@cloudlet/agent', 'dir=packages/agent', 'version=0.1.0-rc.1', 'dist-tag=next',
    'prerelease=true', 'latest=false', 'tarball=cloudlet-agent-0.1.0-rc.1.tgz', 'changelog=packages/agent/CHANGELOG.md', '',
  ].join('\n'));
});

test('checks the tag against the package manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cloudlet-release-target-'));
  try {
    await mkdir(join(directory, 'packages/agent'), { recursive: true });
    await writeFile(join(directory, 'packages/agent/package.json'), JSON.stringify({ name: '@cloudlet/agent', version: '0.1.0-rc.1' }));
    assert.equal((await readReleaseTarget('agent-v0.1.0-rc.1', { root: directory })).version, '0.1.0-rc.1');
    await assert.rejects(readReleaseTarget('agent-v0.1.0', { root: directory }), /does not match @cloudlet\/agent 0\.1\.0-rc\.1/u);
    await writeFile(join(directory, 'packages/agent/package.json'), JSON.stringify({ name: '@cloudlet/other', version: '0.1.0-rc.1' }));
    await assert.rejects(readReleaseTarget('agent-v0.1.0-rc.1', { root: directory }), /is @cloudlet\/other, not @cloudlet\/agent/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the CLI passes the tags of both manifests and refuses the rest', async () => {
  for (const { key, dir } of PACKAGES) {
    const { version } = JSON.parse(await readFile(resolve(root, dir, 'package.json'), 'utf8'));
    const ok = spawnSync(process.execPath, [script, `${key}-v${version}`], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, new RegExp(`^package=${key}\\n(?:.*\\n)*version=${version.replaceAll('.', '\\.')}\\n`, 'u'));
  }
  const old = spawnSync(process.execPath, [script, 'v1.3.0'], { encoding: 'utf8' });
  assert.notEqual(old.status, 0);
  assert.equal(old.stdout, '');
  assert.match(old.stderr, /release tags are toast-vX\.Y\.Z or agent-vX\.Y\.Z/u);
  const mismatch = spawnSync(process.execPath, [script, 'toast-v0.0.1'], { encoding: 'utf8' });
  assert.notEqual(mismatch.status, 0);
  assert.equal(mismatch.stdout, '');
  assert.match(mismatch.stderr, /does not match @cloudlet\/toast/u);
  const usage = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.notEqual(usage.status, 0);
  assert.match(usage.stderr, /Usage/u);
});
