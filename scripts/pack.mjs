import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Retain the actual npm archive; this never builds, publishes, or runs lifecycle scripts. */
export async function packLocal() {
  const directory = join(root, 'artifacts/integration');
  await mkdir(directory, { recursive: true });
  const [packed] = JSON.parse(execFileSync('npm', [
    'pack', './packages/toast', '--json', '--ignore-scripts', '--pack-destination', directory,
    '--cache', join(directory, '.npm-cache'),
  ], { cwd: root, encoding: 'utf8' }));
  assert.ok(packed.files.some(({ path }) => path === 'dist/index.js'), 'Build the library before packing');
  const tarballPath = join(directory, packed.filename);
  const archive = await readFile(tarballPath);
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const files = await Promise.all(packed.files.map(async (file) => ({
    ...file,
    sha256: hash(await readFile(join(root, 'packages/toast', file.path))),
  })));
  const evidence = {
    schemaVersion: 1,
    command: 'npm pack ./packages/toast --json --ignore-scripts --pack-destination artifacts/integration',
    tarball: relative(root, tarballPath),
    sha256: hash(archive),
    shasum: packed.shasum,
    integrity: packed.integrity,
    bytes: archive.byteLength,
    unpackedBytes: packed.unpackedSize,
    entryCount: packed.entryCount,
    manifest: JSON.parse(await readFile(join(root, 'packages/toast/package.json'), 'utf8')),
    toolchain: { node: process.versions.node, npm: execFileSync('npm', ['--version'], { cwd: root, encoding: 'utf8' }).trim() },
    workspaceLockfileSha256: hash(await readFile(join(root, 'package-lock.json'))),
    files,
  };
  await writeFile(join(directory, 'npm-pack.json'), `${JSON.stringify([packed], null, 2)}\n`);
  await writeFile(join(directory, 'package-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Retained ${evidence.tarball}: ${evidence.bytes} B, ${evidence.entryCount} entries, SHA-256 ${evidence.sha256}.`);
  return { tarballPath, evidence, packed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await packLocal();
