import { spawn, execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cp, copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { bindCandidateLock, defaultCandidateTarball, readConsumerLock, readPackedManifest } from './local-candidate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const tarball = args.includes('--tarball') ? resolve(root, args[args.indexOf('--tarball') + 1]) : await defaultCandidateTarball(root);
const evidence = resolve(root, 'artifacts/integration');
await mkdir(evidence, { recursive: true });
let npmCli = process.env.npm_execpath;
if (!npmCli) {
  try { npmCli = realpathSync(execFileSync('volta', ['which', 'npm'], { cwd: root, encoding: 'utf8' }).trim()); }
  catch { npmCli = realpathSync(execFileSync('which', ['npm'], { cwd: root, encoding: 'utf8' }).trim()); }
}
if (!npmCli.endsWith('.js')) npmCli = resolve(dirname(npmCli), 'npm-cli.js');
const run = async (cmd, argv, cwd, log) => {
  if (cmd === 'npm') { argv = [npmCli, ...argv]; cmd = process.execPath; }
  console.log(`$ (${cwd}) ${cmd} ${argv.join(' ')}`);
  let output = '';
  const env = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`, NEXT_TELEMETRY_DISABLED: '1', npm_config_registry: 'https://registry.npmjs.org/', npm_config_fetch_retries: '0', npm_config_fetch_timeout: '30000' };
  delete env.NODE_PATH;
  const exit = await new Promise((ok, fail) => {
    const child = spawn(cmd, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', value => { output += value; process.stdout.write(value); });
    child.stderr.on('data', value => { output += value; process.stderr.write(value); });
    child.on('error', fail); child.on('exit', code => ok(code));
  });
  if (log) await writeFile(resolve(evidence, log), output);
  if (exit !== 0) throw new Error(`${cmd} ${argv.join(' ')} exited ${exit}`);
  return output;
};
if (!args.includes('--browser-only')) {
  const archive = await readFile(tarball);
  const packedManifest = readPackedManifest(tarball);
  const localManifest = JSON.parse(await readFile(resolve(root, 'packages/toast/package.json'), 'utf8'));
  assert.equal(packedManifest.name, localManifest.name, 'Consumer archive must be the current local candidate');
  assert.equal(packedManifest.version, localManifest.version, 'Repack the current candidate before integrating');
  const sha512 = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
  const npmVersion = (await run('npm', ['--version'], root)).trim();
  const expectedNpm = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).packageManager.replace('npm@', '');
  if (npmVersion !== expectedNpm) throw new Error(`Expected npm${expectedNpm}, got npm${npmVersion}; select the workspace toolchain before integrating`);
  const directory = await mkdtemp(resolve(tmpdir(), 'cloudlet-consumers-'));
  if ((await realpath(directory)).startsWith(root)) throw new Error('Consumers must be outside workspace dependency ancestry');
  const consumers = [];
  for (const [name, port] of [['vite18', 4280], ['vite19', 4281], ['next', 4282]]) {
    const path = resolve(directory, name);
    const template = resolve(root, 'fixtures/integration', name);
    await cp(template, path, { recursive: true });
    for (const file of ['consumer.tsx', 'consumer.css', 'types.tsx', 'node-import.mjs', 'env.d.ts']) await copyFile(resolve(root, 'fixtures/integration/shared', file), resolve(path, file));
    await mkdir(resolve(path, 'public'), { recursive: true });
    await copyFile(resolve(root, 'fixtures/integration/shared/audit.js'), resolve(path, 'public/audit.js'));
    await copyFile(tarball, resolve(path, 'cloudlet-toast.tgz'));
    const updateLocks = args.includes('--update-locks');
    const lock = await readConsumerLock(resolve(template, 'package-lock.json'), { updateLocks });
    if (lock) {
      bindCandidateLock(lock, packedManifest, sha512, { updateLocks });
      await writeFile(resolve(path, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
    }
    if (updateLocks) {
      await run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], path, `${name}-lock.log`);
      await copyFile(resolve(path, 'package-lock.json'), resolve(template, 'package-lock.json'));
    }
    await run(process.execPath, ['--version'], path, `${name}-toolchain.log`);
    await run('npm', ['--version'], path);
    await run('npm', ['ci', '--no-audit', '--no-fund'], path, `${name}-install.log`);
    const tree = JSON.parse(await run('npm', ['ls', '--depth=0', '--json'], path, `${name}-dependencies.json`));
    await run(process.execPath, ['node-import.mjs'], path, `${name}-node.log`);
    await run('npm', ['run', 'typecheck'], path, `${name}-types.log`);
    await run('npm', ['run', 'build'], path, `${name}-build.log`);
    await copyFile(resolve(path, 'package-lock.json'), resolve(evidence, `${name}-package-lock.json`));
    consumers.push({ name, path, port, dependencies: Object.fromEntries(Object.entries(tree.dependencies).map(([key, value]) => [key, value.version])), lockSha256: createHash('sha256').update(await readFile(resolve(path, 'package-lock.json'))).digest('hex') });
  }
  const report = { tarball, tarballSha256: createHash('sha256').update(archive).digest('hex'), tarballIntegrity: sha512, node: process.version, npm: npmVersion, consumers };
  await writeFile(resolve(evidence, 'consumers.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Prepared isolated tarball matrix: ${resolve(evidence, 'consumers.json')}`);
}
if (!args.includes('--prepare-only')) {
  const prepared = JSON.parse(await readFile(resolve(evidence, 'consumers.json'), 'utf8'));
  const requestedHash = createHash('sha256').update(await readFile(tarball)).digest('hex');
  if (prepared.tarballSha256 !== requestedHash) throw new Error('Prepared consumers use another tarball; run --prepare-only again');
  await run(resolve(root, 'node_modules/.bin/playwright'), ['test', '--config', 'fixtures/integration/playwright.config.ts'], root, 'consumer-browser.log');
  const report = JSON.parse(await readFile(resolve(evidence, 'consumer-browser-results.json'), 'utf8'));
  const audits = [];
  const visit = async suite => {
    for (const spec of suite.specs ?? []) for (const test of spec.tests) for (const result of test.results) {
      for (const attachment of result.attachments ?? []) {
        if (!attachment.body) continue;
        const body = Buffer.from(attachment.body, 'base64');
        if (attachment.name.startsWith('tarball-')) audits.push({ title: spec.title, project: test.projectName, status: result.status, ...JSON.parse(body.toString()) });
        if (attachment.contentType === 'image/png') await writeFile(resolve(evidence, `${test.projectName}-${spec.title.split(':')[0].replaceAll(/[^a-z0-9]/gi, '-')}.png`), body);
      }
    }
    for (const child of suite.suites ?? []) await visit(child);
  };
  for (const suite of report.suites) await visit(suite);
  await writeFile(resolve(evidence, 'consumer-browser-summary.json'), JSON.stringify({ tarballSha256: prepared.tarballSha256, stats: report.stats, audits }, null, 2) + '\n');
}
