import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultCandidateTarball } from './local-candidate.mjs';

// Local verification only. No publishing, network Git mutations or release API calls.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'packages/toast/package.json'), 'utf8'));
assert.equal(manifest.private, undefined, 'The public manifest carries no private flag (launch P02)');
assert.deepEqual(manifest.publishConfig, { access: 'public', tag: /-/u.test(manifest.version) ? 'next' : 'latest' });
assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/u);
const sha = value => createHash('sha256').update(value).digest('hex');
const output = join(root, 'artifacts/release', manifest.version, new Date().toISOString().replaceAll(':', '-'));
await mkdir(output, { recursive: true });
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run with npm run release:verify to preserve the pinned npm/Node toolchain');
const inputs = async () => {
  const files = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  const paths = [...new Set(files)].filter(path =>
    /^(?:packages\/toast\/|apps\/lab\/|fixtures\/|registry\/|scripts\/|tests\/|\.github\/)/u.test(path)
    || /^(?:package(?:-lock)?\.json|.*config\.[^/]+|\.nvmrc|\.npmrc|\.gitignore|LICENSE|README\.md|CHANGELOG\.md)$/u.test(path))
    .filter(path => !path.startsWith('registry/r/')).sort();
  const hashes = await Promise.all(paths.map(async path => ({ path, sha256: sha(await readFile(join(root, path))) })));
  return { scope: 'Runtime, package, lab, fixtures, registry inputs, scripts, tests, CI, root manifests/config/licenses/README/changelog. Evolving QA/readiness/handoff documents are outside this fingerprint.', sha256: sha(JSON.stringify(hashes)), files: hashes };
};
const report = {
  schemaVersion: 1, version: manifest.version, publication: 'not authorized; not performed',
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
  await run('04-tooling', process.execPath, ['--test', 'tests/tooling/local-candidate.test.mjs']);
  await run('05-doc-examples', process.execPath, ['scripts/check-doc-examples.mjs']);
  await npm('06-notices', ['run', 'notices']);
  await run('07-notice-diff', 'git', ['-c', 'core.autocrlf=false', 'diff', '--exit-code', '--', 'packages/toast/LICENSE', 'packages/toast/THIRD_PARTY_NOTICES.md']);
  await npm('08-pack', ['run', 'pack:local']);
  const tarball = await defaultCandidateTarball(root);
  const archiveHash = sha(await readFile(tarball));
  await copyFile(tarball, join(output, 'candidate.tgz'));
  await run('09-package', process.execPath, ['scripts/check-package.mjs', '--tarball', tarball]);
  await npm('10-runtime-browser', ['run', 'test:e2e', '--', '--workers=3']);
  await cp(join(root, 'playwright-report'), join(output, 'runtime-playwright-report'), { recursive: true });
  await npm('11-consumers', ['run', 'test:consumers']);
  await npm('12-registry-install', ['ci', '--prefix', 'registry/tooling', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline']);
  await npm('13-registry', ['run', 'test:registry']);
  await run('14-size', process.execPath, ['scripts/measure-size.mjs', '--tarball', tarball]);
  await copyFile(join(root, 'artifacts/size/report.json'), join(output, 'size-report.json'));
  await run('15-repeat-pack', process.execPath, ['scripts/pack.mjs']);
  assert.equal(sha(await readFile(tarball)), archiveHash, 'Repeated pack must be byte-identical');
  for (const [from, to] of [
    ['artifacts/integration/package-evidence.json', 'package-evidence.json'],
    ['artifacts/integration/consumers.json', 'consumers.json'],
    ['artifacts/integration/consumer-browser-summary.json', 'consumer-browser-summary.json'],
    ['artifacts/integration/registry/check.json', 'registry-check.json'],
  ]) await copyFile(join(root, from), join(output, to));
  const packageEvidence = JSON.parse(await readFile(join(output, 'package-evidence.json'), 'utf8'));
  const consumers = JSON.parse(await readFile(join(output, 'consumers.json'), 'utf8'));
  const registry = JSON.parse(await readFile(join(output, 'registry-check.json'), 'utf8'));
  const size = JSON.parse(await readFile(join(output, 'size-report.json'), 'utf8'));
  assert.equal(packageEvidence.sha256, archiveHash);
  assert.equal(consumers.tarballSha256, archiveHash);
  assert.equal(registry.tarSha256, archiveHash);
  assert.equal(size.package.tarballSha256, archiveHash);
  report.inputsAfter = await inputs();
  assert.equal(report.inputsAfter.sha256, report.inputsBefore.sha256, 'Release inputs changed during verification');
  await run('16-diff-check', 'git', ['diff', '--check']);
  report.archive = { path: tarball, sha256: archiveHash, integrity: packageEvidence.integrity, bytes: packageEvidence.bytes, entries: packageEvidence.entryCount, repeatIdentical: true };
  report.result = 'passed: available local CI-equivalent checks only';
} catch (error) {
  report.result = 'failed'; report.error = String(error); throw error;
} finally {
  report.finishedAt = new Date().toISOString(); await save();
  await writeFile(join(root, 'artifacts/release', manifest.version, 'latest.json'), `${JSON.stringify({ output, result: report.result }, null, 2)}\n`);
  console.log(`\nEvidence retained: ${output}; stable release readiness remains not ready.`);
}
