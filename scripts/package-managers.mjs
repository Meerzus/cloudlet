import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Installs the packed archive with npm, pnpm, yarn (node_modules and Plug'n'Play) and bun into a
 * minimal consumer each, then imports the package and resolves its stylesheet through `exports` the
 * way that manager's runtime does. Every manager installs from the npm registry, so this is what
 * "works with pnpm, yarn and bun" rests on.
 *
 * Usage: node scripts/package-managers.mjs [--tarball <archive>] [--only pnpm,bun]
 * Without --tarball it checks the archive `npm run pack:local` made for the current version.
 */
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const { version } = JSON.parse(await readFile(new URL('../packages/toast/package.json', import.meta.url), 'utf8'));
const archive = resolve(option('--tarball') ?? `artifacts/integration/cloudlet-toast-${version}.tgz`);
assert.ok(existsSync(archive), `${archive} does not exist: run npm run pack:local first`);

const CHECK = `import { createRequire } from 'node:module';
const toast = await import('@cloudlet/toast');
for (const name of ['createCloudlet', 'CloudletProvider', 'Toaster', 'useCloudlet']) {
  if (typeof toast[name] !== 'function' && typeof toast[name] !== 'object') throw new Error(name + ' is missing');
}
const css = createRequire(import.meta.url).resolve('@cloudlet/toast/styles.css');
if (!css.endsWith('styles.css')) throw new Error('styles.css resolved to ' + css);
console.log('ok', Object.keys(toast).length, 'exports;', 'styles.css resolved');
`;

// pnpm and yarn come through corepack at these versions, so the check needs no global installs.
const PNPM = 'pnpm@10.11.0';
const YARN = 'yarn@4.9.1';
const MANAGERS = {
  npm: { install: ['npm', ['install', '--no-audit', '--no-fund']], run: ['node', ['check.mjs']] },
  pnpm: { install: ['corepack', ['pnpm', 'install']], run: ['node', ['check.mjs']], packageManager: PNPM },
  yarn: { install: ['corepack', ['yarn', 'install']], run: ['node', ['check.mjs']], packageManager: YARN, files: { '.yarnrc.yml': 'nodeLinker: node-modules\n' } },
  'yarn-pnp': { install: ['corepack', ['yarn', 'install']], run: ['corepack', ['yarn', 'node', 'check.mjs']], packageManager: YARN, files: { '.yarnrc.yml': 'nodeLinker: pnp\npnpMode: strict\n' } },
  bun: { install: ['bun', ['install']], run: ['bun', ['check.mjs']] },
};
const only = option('--only')?.split(',');
const selected = Object.entries(MANAGERS).filter(([name]) => !only || only.includes(name) || only.includes(name.split('-')[0]));

const root = await mkdtemp(join(tmpdir(), 'cloudlet-managers-'));
const failures = [];
for (const [name, manager] of selected) {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  const manifest = {
    name: `consumer-${name}`,
    private: true,
    type: 'module',
    dependencies: { '@cloudlet/toast': `file:${archive}`, react: '^19.0.0', 'react-dom': '^19.0.0' },
    ...(manager.packageManager ? { packageManager: manager.packageManager } : {}),
  };
  await writeFile(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(dir, 'check.mjs'), CHECK);
  for (const [file, content] of Object.entries(manager.files ?? {})) await writeFile(join(dir, file), content);
  // Yarn Berry needs an empty lockfile to treat the folder as its own project.
  if (name.startsWith('yarn')) await writeFile(join(dir, 'yarn.lock'), '');
  for (const [command, commandArgs] of [manager.install, manager.run]) {
    const result = spawnSync(command, commandArgs, { cwd: dir, encoding: 'utf8', env: { ...process.env, CI: 'true', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0', COREPACK_ENABLE_STRICT: '0', YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' } });
    if (result.status !== 0) {
      failures.push(`${name}: ${command} ${commandArgs.join(' ')} failed\n${(result.stderr || result.stdout).trim().slice(-2000)}`);
      break;
    }
    if (command === manager.run[0] && commandArgs === manager.run[1]) console.log(`${name}: ${result.stdout.trim()}`);
  }
}
await rm(root, { recursive: true, force: true });
if (failures.length) {
  console.error(failures.join('\n\n'));
  process.exit(1);
}
