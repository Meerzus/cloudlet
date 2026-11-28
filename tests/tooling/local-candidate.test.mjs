import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { bindCandidateLock, candidateEvidencePath, consumerArchiveFilename, defaultCandidateTarball, packageTarballFilename, readConsumerLock } from '../../scripts/local-candidate.mjs';

const manifest = { name: '@cloudlet/toast', version: '1.0.0-rc.0', dependencies: { motion: '14.3.0' }, peerDependencies: { react: '^18.2.0 || ^19.0.0' } };
const fixture = () => ({ lockfileVersion: 3, packages: {
  '': { name: 'isolated-consumer', dependencies: { '@cloudlet/toast': 'file:./cloudlet-toast.tgz', react: '19.3.1' } },
  'node_modules/@cloudlet/toast': { version: '0.0.0', resolved: 'file:cloudlet-toast.tgz', integrity: 'sha512-old', dependencies: { motion: '14.3.0' }, peerDependencies: { react: '^18.2.0 || ^19.0.0' } },
  'node_modules/motion': { version: '14.3.0', resolved: 'https://registry.npmjs.org/motion/-/motion-14.3.0.tgz', integrity: 'sha512-locked-motion' },
  'node_modules/react': { version: '19.3.1', resolved: 'https://registry.npmjs.org/react/-/react-19.3.1.tgz', integrity: 'sha512-locked-react' },
} });

test('missing committed locks fail ordinary verification and need explicit update consent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cloudlet-lock-guard-'));
  try {
    const path = join(directory, 'package-lock.json');
    await assert.rejects(readConsumerLock(path), /Missing committed consumer lockfile:.*--update-locks/u);
    assert.equal(await readConsumerLock(path, { updateLocks: true }), undefined);
    await writeFile(path, JSON.stringify(fixture()));
    assert.deepEqual(await readConsumerLock(path), fixture());
    await writeFile(path, '{broken');
    await assert.rejects(readConsumerLock(path, { updateLocks: true }), SyntaxError);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('prerelease verification updates only archive version/integrity, preserving all locked resolutions', () => {
  const lock = fixture();
  const expected = structuredClone(lock);
  expected.packages['node_modules/@cloudlet/toast'].version = manifest.version;
  expected.packages['node_modules/@cloudlet/toast'].integrity = 'sha512-candidate';
  assert.deepEqual(bindCandidateLock(lock, manifest, 'sha512-candidate'), expected);
  assert.equal(packageTarballFilename(manifest), 'cloudlet-toast-1.0.0-rc.0.tgz');
});

test('ordinary verification rejects a changed runtime graph rather than resolving dependencies', () => {
  const lock = fixture();
  assert.throws(() => bindCandidateLock(lock, { ...manifest, dependencies: { motion: '15.0.0' } }, 'sha512-candidate'), /dependencies changed.*--update-locks/u);
  assert.deepEqual(lock, fixture());
  const explicit = bindCandidateLock(lock, { ...manifest, dependencies: { motion: '15.0.0' } }, 'sha512-candidate', { updateLocks: true });
  assert.deepEqual(explicit.packages['node_modules/@cloudlet/toast'].dependencies, { motion: '15.0.0' });
});

test('a missing candidate entry requires explicit lock resolution', () => {
  const lock = fixture();
  delete lock.packages['node_modules/@cloudlet/toast'];
  assert.throws(() => bindCandidateLock(lock, manifest, 'sha512-candidate'), /must contain.*--update-locks/u);
  bindCandidateLock(lock, manifest, 'sha512-candidate', { updateLocks: true });
  assert.deepEqual(lock.packages['node_modules/@cloudlet/toast'], {
    resolved: 'file:cloudlet-toast.tgz', version: manifest.version, integrity: 'sha512-candidate',
    dependencies: manifest.dependencies, peerDependencies: manifest.peerDependencies,
  });
});

test('every package has its own archive and evidence path under artifacts/integration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cloudlet-candidate-'));
  try {
    for (const [dir, name, version] of [['packages/toast', '@cloudlet/toast', '1.4.0-rc.1'], ['packages/agent', '@cloudlet/agent', '0.1.0-rc.1']]) {
      await mkdir(join(directory, dir), { recursive: true });
      await writeFile(join(directory, dir, 'package.json'), JSON.stringify({ name, version }));
    }
    const integration = join(directory, 'artifacts/integration');
    assert.equal(await defaultCandidateTarball(directory), join(integration, 'cloudlet-toast-1.4.0-rc.1.tgz'));
    assert.equal(await defaultCandidateTarball(directory, 'toast'), join(integration, 'cloudlet-toast-1.4.0-rc.1.tgz'));
    assert.equal(await defaultCandidateTarball(directory, 'agent'), join(integration, 'cloudlet-agent-0.1.0-rc.1.tgz'));
    await assert.rejects(defaultCandidateTarball(directory, 'kit'), /Unknown package "kit"; expected one of toast, agent/u);
    assert.equal(candidateEvidencePath(directory, 'toast'), join(integration, 'toast-evidence.json'));
    assert.equal(candidateEvidencePath(directory, 'agent'), join(integration, 'agent-evidence.json'));
    assert.throws(() => candidateEvidencePath(directory, '../toast'), /lowercase words/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a second package in the same consumer lock binds its own archive entry', () => {
  const agent = { name: '@cloudlet/agent', version: '0.1.0' };
  assert.equal(consumerArchiveFilename(agent), 'cloudlet-agent.tgz');
  assert.equal(consumerArchiveFilename(manifest), 'cloudlet-toast.tgz');
  const lock = fixture();
  lock.packages['node_modules/@cloudlet/agent'] = { version: '0.0.0', resolved: 'file:cloudlet-agent.tgz', integrity: 'sha512-old' };
  bindCandidateLock(lock, manifest, 'sha512-toast');
  bindCandidateLock(lock, agent, 'sha512-agent');
  assert.deepEqual(lock.packages['node_modules/@cloudlet/agent'], { version: '0.1.0', resolved: 'file:cloudlet-agent.tgz', integrity: 'sha512-agent' });
  assert.equal(lock.packages['node_modules/@cloudlet/toast'].integrity, 'sha512-toast');
  lock.packages['node_modules/@cloudlet/agent'].resolved = 'file:cloudlet-toast.tgz';
  assert.throws(() => bindCandidateLock(lock, agent, 'sha512-agent'), /local @cloudlet\/agent candidate archive/u);
});
