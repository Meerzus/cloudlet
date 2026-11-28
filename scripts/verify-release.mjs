import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidateEvidencePath, defaultCandidateTarball } from './local-candidate.mjs';
import { PACKAGES } from './release-target.mjs';

// Local verification only. No publishing, network Git mutations or release API calls.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Every published package: public, a release version, the dist-tag its version calls for.
const manifests = {};
for (const { key, name, dir } of PACKAGES) {
  const manifest = JSON.parse(await readFile(join(root, dir, 'package.json'), 'utf8'));
  assert.equal(manifest.name, name, `${dir}/package.json names ${name}`);
  assert.equal(manifest.private, undefined, `${name}: the public manifest carries no private flag`);
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/u, `${name}: a release version`);
  assert.deepEqual(manifest.publishConfig, { access: 'public', tag: /-/u.test(manifest.version) ? 'next' : 'latest' }, `${name}: publishConfig`);
  manifests[key] = manifest;
}
const versions = Object.fromEntries(PACKAGES.map(({ key }) => [key, manifests[key].version]));
const versionLabel = PACKAGES.map(({ key }) => `${key}-${versions[key]}`).join('+');
const sha = value => createHash('sha256').update(value).digest('hex');
const output = join(root, 'artifacts/release', versionLabel, new Date().toISOString().replaceAll(':', '-'));
await mkdir(output, { recursive: true });
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run with npm run release:verify to preserve the pinned npm/Node toolchain');
const inputs = async () => {
  const files = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  const paths = [...new Set(files)].filter(path =>
    /^(?:packages\/(?:toast|agent)\/|apps\/lab\/|fixtures\/|registry\/|scripts\/|tests\/|\.github\/)/u.test(path)
    || /^(?:package(?:-lock)?\.json|.*config\.[^/]+|\.nvmrc|\.npmrc|\.gitignore|LICENSE|README\.md|CHANGELOG\.md)$/u.test(path))
    .filter(path => !path.startsWith('registry/r/')).sort();
  const hashes = await Promise.all(paths.map(async path => ({ path, sha256: sha(await readFile(join(root, path))) })));
  return { scope: 'Runtime, both packages, lab, fixtures, registry inputs, scripts, tests, CI, root manifests/config/licenses/README/changelog. Evolving QA/readiness/handoff documents are outside this fingerprint.', sha256: sha(JSON.stringify(hashes)), files: hashes };
};
const report = {
  schemaVersion: 2, versions, publication: 'not authorized; not performed',
  releaseReadiness: 'not ready', startedAt: new Date().toISOString(),
  baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  environment: { platform: process.platform, arch: process.arch, node: process.version, npm: execFileSync(process.execPath, [npmCli, '--version'], { cwd: root, encoding: 'utf8' }).trim() },
  inputsBefore: await inputs(), steps: [],
};
const save = () => writeFile(join(output, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Release verification evidence: ${output}`);
async function run(name, command, args) {
  const started = Date.now();
  const log = createWriteStream(join(output, `${name}.log`));
  console.log(`\n[${name}] ${command} ${args.join(' ')}`);
  const code = await new Promise((ok, fail) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { log.write(data); process.stdout.write(data); });
    child.stderr.on('data', data => { log.write(data); process.stderr.write(data); });
    child.on('error', fail); child.on('close', code => ok(code));
  }).finally(() => new Promise(done => log.end(done)));
  report.steps.push({ name, command: [command === process.execPath ? 'node' : command, ...args.map(arg => arg === npmCli ? '<pinned-npm-cli>' : arg)], exitCode: code, elapsedMs: Date.now() - started });
  await save();
  assert.equal(code, 0, `${name} failed; independent logs are retained in ${output}`);
}
const npm = (name, args) => run(name, process.execPath, [npmCli, ...args]);
try {
  const { chromium, firefox, webkit } = await import('@playwright/test');
  for (const browser of [chromium, firefox, webkit]) await access(browser.executablePath());
  await npm('01-clean-install', ['ci', '--no-audit', '--no-fund', '--prefer-offline']);
  await npm('02-typecheck', ['run', 'typecheck']);
  await npm('03-unit-react', ['test']);
  await npm('04-tooling', ['run', 'test:tooling']);
  await run('05-doc-examples', process.execPath, ['scripts/check-doc-examples.mjs']);
  await npm('06-notices', ['run', 'notices']);
  await run('07-notice-diff', 'git', ['-c', 'core.autocrlf=false', 'diff', '--exit-code', '--', 'packages/toast/LICENSE', 'packages/toast/THIRD_PARTY_NOTICES.md']);
  await npm('08-pack', ['run', 'pack:local']);
  const archives = {};
  for (const { key } of PACKAGES) {
    const path = await defaultCandidateTarball(root, key);
    archives[key] = { path, sha256: sha(await readFile(path)) };
    await copyFile(path, join(output, `${key}-candidate.tgz`));
  }
  const archiveHash = archives.toast.sha256; // the Toaster archive consumers and the registry install
  await run('09-package', process.execPath, ['scripts/check-package.mjs', '--tarball', archives.toast.path, '--agent-tarball', archives.agent.path]);
  await npm('10-runtime-browser', ['run', 'test:e2e', '--', '--workers=3']);
  await cp(join(root, 'playwright-report'), join(output, 'runtime-playwright-report'), { recursive: true });
  await npm('11-consumers', ['run', 'test:consumers']);
  await npm('12-registry-install', ['ci', '--prefix', 'registry/tooling', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline']);
  await npm('13-registry', ['run', 'test:registry']);
  await run('14-repeat-pack', process.execPath, ['scripts/pack.mjs']);
  for (const { key } of PACKAGES) {
    assert.equal(sha(await readFile(archives[key].path)), archives[key].sha256, `Repeated pack of ${key} must be byte-identical`);
    await copyFile(candidateEvidencePath(root, key), join(output, `${key}-evidence.json`));
  }
  for (const [from, to] of [
    ['artifacts/integration/consumers.json', 'consumers.json'],
    ['artifacts/integration/consumer-browser-summary.json', 'consumer-browser-summary.json'],
    ['artifacts/integration/registry/check.json', 'registry-check.json'],
  ]) await copyFile(join(root, from), join(output, to));
  const evidence = {};
  for (const { key } of PACKAGES) {
    evidence[key] = JSON.parse(await readFile(join(output, `${key}-evidence.json`), 'utf8'));
    assert.equal(evidence[key].sha256, archives[key].sha256, `${key} evidence names the checked archive`);
  }
  const consumers = JSON.parse(await readFile(join(output, 'consumers.json'), 'utf8'));
  const registry = JSON.parse(await readFile(join(output, 'registry-check.json'), 'utf8'));
  // Consumers install both archives (the bridge only where a consumer depends on it), and so does the registry consumer.
  assert.equal(consumers.tarballSha256, archiveHash);
  assert.equal(consumers.agentTarballSha256, archives.agent.sha256, 'Consumers installed the checked bridge archive');
  assert.equal(registry.tarSha256, archiveHash);
  assert.equal(registry.agentTarSha256, archives.agent.sha256, 'The registry consumer installed the checked bridge archive');
  report.inputsAfter = await inputs();
  assert.equal(report.inputsAfter.sha256, report.inputsBefore.sha256, 'Release inputs changed during verification');
  await run('15-diff-check', 'git', ['diff', '--check']);
  report.archives = Object.fromEntries(PACKAGES.map(({ key }) => [key, {
    path: archives[key].path, sha256: archives[key].sha256, integrity: evidence[key].integrity,
    bytes: evidence[key].bytes, entries: evidence[key].entryCount, repeatIdentical: true,
  }]));
  report.result = 'passed: available local CI-equivalent checks only';
} catch (error) {
  report.result = 'failed'; report.error = String(error); throw error;
} finally {
  report.finishedAt = new Date().toISOString(); await save();
  await writeFile(join(root, 'artifacts/release', versionLabel, 'latest.json'), `${JSON.stringify({ output, result: report.result }, null, 2)}\n`);
  console.log(`\nEvidence retained: ${output}; stable release readiness remains not ready.`);
}
