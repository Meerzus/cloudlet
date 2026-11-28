import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { candidateEvidencePath } from './local-candidate.mjs';
import { PACKAGES } from './release-target.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, 'artifacts/integration');
const hash = (value) => createHash('sha256').update(value).digest('hex');

async function packPackage({ key, dir }, { npm, lockfileSha256 }) {
  const [packed] = JSON.parse(execFileSync('npm', [
    'pack', `./${dir}`, '--json', '--ignore-scripts', '--pack-destination', directory,
    '--cache', join(directory, '.npm-cache'),
  ], { cwd: root, encoding: 'utf8' }));
  assert.ok(packed.files.some(({ path }) => path === 'dist/index.js'), `Build ${dir} before packing`);
  const tarballPath = join(directory, packed.filename);
  const archive = await readFile(tarballPath);
  const files = await Promise.all(packed.files.map(async (file) => ({
    ...file,
    sha256: hash(await readFile(join(root, dir, file.path))),
  })));
  const evidence = {
    schemaVersion: 1,
    package: key,
    command: `npm pack ./${dir} --json --ignore-scripts --pack-destination artifacts/integration`,
    tarball: relative(root, tarballPath),
    sha256: hash(archive),
    shasum: packed.shasum,
    integrity: packed.integrity,
    bytes: archive.byteLength,
    unpackedBytes: packed.unpackedSize,
    entryCount: packed.entryCount,
    manifest: JSON.parse(await readFile(join(root, dir, 'package.json'), 'utf8')),
    toolchain: { node: process.versions.node, npm },
    workspaceLockfileSha256: lockfileSha256,
    files,
  };
  await writeFile(candidateEvidencePath(root, key), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Retained ${evidence.tarball}: ${evidence.bytes} B, ${evidence.entryCount} entries, SHA-256 ${evidence.sha256}.`);
  return { key, tarballPath, evidence, packed };
}

/**
 * Retains the actual npm archive of every published package with its evidence
 * (`artifacts/integration/<key>-evidence.json`); this never builds, publishes, or runs lifecycle
 * scripts. `npm-pack.json` holds the raw `npm pack --json` entries of all packages, in `PACKAGES`
 * order. `package-evidence.json` stays a copy of the Toaster's evidence for readers that predate
 * the second package.
 */
export async function packLocal() {
  await mkdir(directory, { recursive: true });
  const context = {
    npm: execFileSync('npm', ['--version'], { cwd: root, encoding: 'utf8' }).trim(),
    lockfileSha256: hash(await readFile(join(root, 'package-lock.json'))),
  };
  const results = [];
  for (const entry of PACKAGES) results.push(await packPackage(entry, context));
  await writeFile(join(directory, 'npm-pack.json'), `${JSON.stringify(results.map(({ packed }) => packed), null, 2)}\n`);
  await copyFile(candidateEvidencePath(root, 'toast'), join(directory, 'package-evidence.json'));
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await packLocal();
