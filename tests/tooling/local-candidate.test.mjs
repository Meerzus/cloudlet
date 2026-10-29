import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { bindCandidateLock, packageTarballFilename, readConsumerLock } from '../../scripts/local-candidate.mjs';

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
