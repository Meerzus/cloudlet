import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function packageTarballFilename(manifest) {
  return `${manifest.name.replace(/^@/u, '').replaceAll('/', '-')}-${manifest.version}.tgz`;
}

/**
 * The archive `npm run pack:local` retains for a package of `PACKAGES` (`toast` or `agent`) at the
 * version of its manifest. `release-target.mjs` is imported lazily: it imports this module.
 */
export async function defaultCandidateTarball(root, key = 'toast') {
  const { PACKAGES } = await import('./release-target.mjs');
  const entry = PACKAGES.find((candidate) => candidate.key === key);
  assert.ok(entry, `Unknown package "${key}"; expected one of ${PACKAGES.map((candidate) => candidate.key).join(', ')}`);
  const manifest = JSON.parse(await readFile(resolve(root, entry.dir, 'package.json'), 'utf8'));
  return resolve(root, 'artifacts/integration', packageTarballFilename(manifest));
}

/** The evidence `npm run pack:local` writes next to a package's archive. */
export function candidateEvidencePath(root, key) {
  assert.match(key, /^[a-z]+$/u, `Package keys are lowercase words, got "${key}"`);
  return resolve(root, 'artifacts/integration', `${key}-evidence.json`);
}

export function readPackedManifest(tarball) {
  return JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }));
}

export async function readConsumerLock(path, { updateLocks = false } = {}) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!updateLocks) throw new Error(`Missing committed consumer lockfile: ${path}. Restore it or explicitly use --update-locks to resolve dependencies.`, { cause: error });
    return undefined;
  }
}

/** Ordinary verification changes only the exact local archive's version/integrity. */
export function bindCandidateLock(lock, manifest, integrity, { updateLocks = false } = {}) {
  let entry = lock.packages?.[`node_modules/${manifest.name}`];
  if (!entry) {
    assert.ok(updateLocks, `Consumer lockfile must contain ${manifest.name}; explicitly use --update-locks to resolve dependencies`);
    lock.packages ??= {};
    entry = lock.packages[`node_modules/${manifest.name}`] = { resolved: 'file:cloudlet-toast.tgz' };
  }
  assert.equal(entry.resolved, 'file:cloudlet-toast.tgz', 'Consumer must resolve the local candidate archive');
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta']) {
    if (updateLocks) {
      if (manifest[key] === undefined) delete entry[key];
      else entry[key] = structuredClone(manifest[key]);
    } else {
      assert.deepEqual(entry[key] ?? {}, manifest[key] ?? {}, `Candidate ${key} changed; explicitly use --update-locks to resolve dependencies`);
    }
  }
  entry.version = manifest.version;
  entry.integrity = integrity;
  return lock;
}
