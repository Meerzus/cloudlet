import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { chromium, firefox, webkit } from '@playwright/test';
import { defaultCandidateTarball, packageTarballFilename, readPackedManifest } from './local-candidate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tarballOption = process.argv.indexOf('--tarball');
const tarball = tarballOption >= 0 ? resolve(root, process.argv[tarballOption + 1]) : await defaultCandidateTarball(root);
const evidencePath = resolve(root, 'artifacts/integration/registry');
await mkdir(evidencePath, { recursive: true });
const readJSON = async (path) => JSON.parse(await readFile(path, 'utf8'));
const tarBytes = await readFile(tarball);
const packageManifest = readPackedManifest(tarball);
const localManifest = await readJSON(resolve(root, 'packages/toast/package.json'));
assert.equal(packageManifest.name, '@cloudlet/toast');
assert.equal(packageManifest.version, localManifest.version, 'Repack the current candidate before registry verification');
assert.equal(packageManifest.private, undefined);
const archivePath = `/npm/${packageTarballFilename(packageManifest)}`;
const tarSha256 = createHash('sha256').update(tarBytes).digest('hex');
const integrity = `sha512-${createHash('sha512').update(tarBytes).digest('base64')}`;
const temporary = await mkdtemp(join(tmpdir(), 'cloudlet-registry-'));
const consumer = join(temporary, 'consumer');
const userNpmrc = join(temporary, 'user.npmrc');
await writeFile(userNpmrc, 'registry=https://registry.npmjs.org/\n');
const env = {
  ...process.env,
  CI: '1', NEXT_TELEMETRY_DISABLED: '1',
  npm_config_userconfig: userNpmrc,
  npm_config_cache: join(temporary, 'npm-cache'),
  npm_config_registry: 'https://registry.npmjs.org/',
  npm_config_audit: 'false', npm_config_fund: 'false',
};
// Fixtures never inherit NODE_PATH, which could hide missing consumer dependencies.
delete env.NODE_PATH;
const commands = [];
const run = async (command, args, cwd, label) => {
  console.log(`registry: ${label}`);
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((resolveExit, reject) => { child.on('error', reject); child.on('exit', resolveExit); });
  const log = resolve(evidencePath, `${label}.log`);
  await writeFile(log, `$ ${command} ${args.join(' ')}\ncwd=${cwd}\n${output}`);
  commands.push({ label, command, args, exitCode: code, log });
  assert.equal(code, 0, `${label} failed; see ${log}\n${output.slice(-6000)}`);
  return output;
};
const requests = [];
let origin;
const registryServer = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, origin).pathname);
  requests.push({ method: request.method, path });
  if (path === '/@cloudlet/toast') {
    const version = {
      ...packageManifest,
      dist: {
        tarball: `${origin}${archivePath}`,
        integrity,
        shasum: createHash('sha1').update(tarBytes).digest('hex'),
      },
    };
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ name: packageManifest.name, 'dist-tags': { latest: packageManifest.version }, versions: { [packageManifest.version]: version } }));
    return;
  }
  if (path === archivePath) {
    response.setHeader('Content-Type', 'application/octet-stream');
    response.end(tarBytes);
    return;
  }
  if (path === '/r/toaster.json' || path === '/r/registry.json') {
    response.setHeader('Content-Type', 'application/json');
    response.end(await readFile(resolve(root, `registry${path}`)));
    return;
  }
  response.statusCode = 404;
  response.end('Not found');
});
let nextServer;
let nextLog = '';
let failure;
const report = {
  node: process.version,
  npm: spawnSync('npm', ['--version'], { encoding: 'utf8' }).stdout.trim(),
  tarball, tarSha256, integrity,
  consumer,
  shadcn: (await readJSON(resolve(root, 'registry/tooling/node_modules/shadcn/package.json'))).version,
  checks: {}, browsers: [], commands,
};
try {
  await run(process.execPath, [resolve(root, 'scripts/registry-build.mjs')], root, 'build');
  await cp(resolve(root, 'registry/consumer'), consumer, {
    recursive: true,
    filter: (source) => !source.includes('/node_modules') && !source.includes('/.next'),
  });
  await new Promise((resolveListen, reject) => { registryServer.once('error', reject); registryServer.listen(0, '127.0.0.1', resolveListen); });
  origin = `http://127.0.0.1:${registryServer.address().port}`;
  await writeFile(join(consumer, '.npmrc'), `registry=https://registry.npmjs.org/\n@cloudlet:registry=${origin}/\nsave-exact=true\n`);
  await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], consumer, 'consumer-ci');
  const consumerNode = spawnSync('node', ['--version'], { cwd: consumer, env, encoding: 'utf8' }).stdout.trim();
  const consumerNpm = spawnSync('npm', ['--version'], { cwd: consumer, env, encoding: 'utf8' }).stdout.trim();
  assert.equal(consumerNode, process.version, 'Consumer Node must match the configured workspace toolchain');
  assert.equal(consumerNpm, report.npm, 'Consumer npm must match the configured workspace toolchain');
  report.consumerToolchain = { node: consumerNode, npm: consumerNpm };
  assert(!(await readJSON(join(consumer, 'package.json'))).dependencies['@cloudlet/toast']);
  await assert.rejects(realpath(join(consumer, 'node_modules/@cloudlet/toast')));
  report.checks.cleanWithoutRuntime = 'passed';
  await run(process.execPath, [resolve(root, 'registry/tooling/node_modules/shadcn/dist/index.js'), 'add', `${origin}/r/toaster.json`, '--yes', '--overwrite', '--cwd', consumer], consumer, 'shadcn-add');
  const installedManifest = await readJSON(join(consumer, 'node_modules/@cloudlet/toast/package.json'));
  const installedLock = await readJSON(join(consumer, 'package-lock.json'));
  const dependency = installedLock.packages['node_modules/@cloudlet/toast'];
  assert.equal(installedManifest.version, packageManifest.version);
  assert.equal(dependency.integrity, integrity);
  assert.equal(dependency.resolved, `${origin}${archivePath}`);
  assert(requests.some((request) => request.path === archivePath));
  assert(!(await realpath(join(consumer, 'node_modules/@cloudlet/toast'))).startsWith(root));
  assert.equal((await readJSON(join(consumer, 'package.json'))).dependencies['@cloudlet/toast'], packageManifest.version);
  const installedWrapper = await readFile(join(consumer, 'components/ui/toaster.tsx'), 'utf8');
  const installedCss = await readFile(join(consumer, 'components/ui/toaster.css'), 'utf8');
  assert(installedWrapper.startsWith('"use client"'));
  assert(installedWrapper.includes('"@cloudlet/toast/styles.css"'));
  assert(installedWrapper.includes('"./toaster.css"'));
  assert(installedCss.includes('var(--popover'));
  assert.deepEqual((await readJSON(join(consumer, 'tsconfig.json'))).compilerOptions.paths, { '@/*': ['./*'] });
  report.checks.runtimeInstalledFromExactTarballByShadcn = 'passed';
  report.checks.publicImportsAndClientDirective = 'passed';
  report.checks.aliasesAndCss = 'passed';
  report.versions = Object.fromEntries(await Promise.all(['next', 'react', 'react-dom', 'typescript', 'tailwindcss'].map(async (name) => [name, (await readJSON(join(consumer, 'node_modules', name, 'package.json'))).version])));
  await run('npm', ['run', 'build'], consumer, 'consumer-build');
  await run('npm', ['run', 'typecheck'], consumer, 'consumer-types');
  report.checks.productionBuild = 'passed';
  report.checks.types = 'passed';
  const reservePort = createServer();
  await new Promise((resolveListen) => { reservePort.listen(0, '127.0.0.1', resolveListen); });
  const nextPort = reservePort.address().port;
  await new Promise((resolveClose) => { reservePort.close(resolveClose); });
  const baseURL = `http://127.0.0.1:${nextPort}`;
  nextServer = spawn(process.execPath, [join(consumer, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(nextPort)], { cwd: consumer, env, stdio: ['ignore', 'pipe', 'pipe'] });
  nextServer.stdout.on('data', (chunk) => { nextLog += chunk; });
  nextServer.stderr.on('data', (chunk) => { nextLog += chunk; });
  let html;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { const response = await fetch(baseURL); if (response.ok) { html = await response.text(); break; } } catch {}
    await new Promise((resolveWait) => { setTimeout(resolveWait, 200); });
  }
  assert(html, `production server did not start: ${nextLog}`);
  assert(html.includes('Server rendered without a controller singleton.'));
  assert(!html.includes('class="cloudlet-host'));
  report.checks.productionSSR = 'passed';
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => { errors.push(error.message); });
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(baseURL);
      const browserReactVersion = await page.locator('[data-registry-react-version]').getAttribute('data-registry-react-version');
      assert(browserReactVersion, 'Consumer must report the React version observed in its client bundle');
      // The collapsed pill names the record admitted before the provider mounted (hydration done).
      await page.locator('.cloudlet-pill[aria-label="Before provider mount"]').waitFor();
      const host = page.locator('.cloudlet-host');
      assert.equal(await host.count(), 1);
      assert.equal(await host.getAttribute('data-theme'), 'light');
      // The shell path takes the bridged shadcn tokens.
      const path = host.locator('.cloudlet-bg path').first();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.cloudlet-bg path')).fill === 'rgb(240, 247, 255)');
      const light = await path.evaluate((element) => getComputedStyle(element).fill);
      await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.cloudlet-bg path')).fill === 'rgb(32, 43, 59)');
      assert.equal(await host.getAttribute('data-theme'), 'dark');
      const dark = await path.evaluate((element) => getComputedStyle(element).fill);
      await page.getByRole('button', { name: 'Notify', exact: true }).click();
      await page.locator('.cloudlet-pill[aria-label="Installed wrapper action, 2 notifications"]').waitFor();
      // Open the Island from the pill, close the current slide: the older record becomes current.
      await page.locator('.cloudlet-pill').click();
      await page.getByRole('region', { name: 'Current notifications', exact: true }).getByRole('heading', { name: 'Installed wrapper action', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Close notification', exact: true }).click();
      await page.getByRole('region', { name: 'Current notifications', exact: true }).getByRole('heading', { name: 'Before provider mount', exact: true }).waitFor();
      await page.waitForFunction(() => {
        const shell = document.querySelector('.cloudlet-stack > .cloudlet-shell');
        const snapshots = document.querySelectorAll('.cloudlet-exit, .cloudlet-slide-out, .cloudlet-chrome-out, .cloudlet-heading-out, .cloudlet-body-out');
        return shell && getComputedStyle(shell).opacity === '1' && [...snapshots].every((element) => element.childElementCount === 0);
      });
      assert.deepEqual(errors, []);
      await page.screenshot({ path: resolve(evidencePath, `${name}-dark.png`), fullPage: true });
      report.browsers.push({ name, version: browser.version(), browserReactVersion, status: 'passed', beforeMount: 'passed', hydrationErrors: errors, explicitRuntimeCss: 'passed', light, dark, wrapperContext: 'passed', settledTransition: 'passed' });
      await page.close();
    } finally { await browser.close(); }
  }
  report.checks.browserThemeHydration = 'passed';
  await cp(join(consumer, 'package-lock.json'), resolve(evidencePath, 'installed-package-lock.json'));
  await cp(join(consumer, 'package.json'), resolve(evidencePath, 'installed-package.json'));
  await cp(join(consumer, 'components'), resolve(evidencePath, 'installed-components'), { recursive: true });
} catch (error) {
  failure = error;
  report.error = error.stack;
} finally {
  if (nextServer) {
    nextServer.kill('SIGTERM');
    await new Promise((resolveExit) => { if (nextServer.exitCode !== null) resolveExit(); else nextServer.once('exit', resolveExit); });
  }
  await new Promise((resolveClose) => { registryServer.close(resolveClose); });
  await writeFile(resolve(evidencePath, 'next-start.log'), nextLog);
  report.registryRequests = requests;
  report.status = failure ? 'failed' : 'passed';
  await writeFile(resolve(evidencePath, 'check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, tarSha256, checks: report.checks, browsers: report.browsers, consumer, evidence: resolve(evidencePath, 'check.json') }, null, 2));
  if (!failure && !process.argv.includes('--keep')) await rm(temporary, { recursive: true, force: true });
}
if (failure) throw failure;
