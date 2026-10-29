import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { createPackedFixture, root } from './check-package.mjs';
import { packageTarballFilename } from './local-candidate.mjs';

const flags = process.argv.slice(2);
let tarballPath;
for (let index = 0; index < flags.length; index += 1) {
  if (flags[index] === '--tarball') { assert.ok(flags[index + 1], 'Missing --tarball path'); tarballPath = flags[++index]; }
  else assert.ok(['--write-baseline', '--enforce-budgets'].includes(flags[index]), `Unknown size flag: ${flags[index]}`);
}
const fixtureRoot = join(root, 'fixtures/size');
const reportPath = join(root, 'artifacts/size/report.json');
const baselinePath = join(root, 'scripts/size-baseline.json');
const browserTarget = ['chrome111', 'edge111', 'firefox114', 'safari16.4', 'ios16.4'];
// Keep the historical task10 comparison visible. The owner reaffirmed that all
// size limits are informational until final optimization; opt in to enforcement.
const enforceBudgets = flags.includes('--enforce-budgets');
const ownJsAcceptance = { date: '2026-10-16', task: '10', originalTargetBytes: 12 * 1024, source: 'explicit-task10-requirement-task05-ceiling', acceptedBytes: 16508 };
const limits = { ownJsLimitBytes: ownJsAcceptance.acceptedBytes, cssLimitBytes: 3 * 1024, fullDeltaLimitBytes: 45 * 1024 };
const gzipBytes = (source) => gzipSync(source, { level: 9, mtime: 0 }).byteLength;
const version = async (name, from = root) => JSON.parse(await readFile(join(from, 'node_modules', name, 'package.json'), 'utf8')).version;
const ignoreConsumerClientDirective = (warning, defaultHandler) => {
  // Consumer and metric-only rebundles do not implement RSC boundaries.
  // check-package separately verifies the actual published artifact graph.
  if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')) return;
  defaultHandler(warning);
};

function measureOutput(result) {
  const builds = Array.isArray(result) ? result : [result];
  assert.ok(builds.length === 1 && 'output' in builds[0], 'Expected one ESM consumer build');
  const outputs = builds[0].output
    .filter((output) => output.type === 'chunk' || output.fileName.endsWith('.css'))
    .map((output) => {
      const data = Buffer.from(output.type === 'chunk' ? output.code : output.source);
      // A dynamic-entry chunk loads later (the lazily loaded renderer), the rest at start.
      const lazy = output.type === 'chunk' && output.isDynamicEntry;
      return { file: output.fileName, kind: output.type === 'chunk' ? 'js' : 'css', lazy, bytes: data.byteLength, gzipBytes: gzipBytes(data), sha256: createHash('sha256').update(data).digest('hex') };
    }).sort((a, b) => a.file.localeCompare(b.file, 'en'));
  const jsGzipBytes = outputs.filter((file) => file.kind === 'js').reduce((sum, file) => sum + file.gzipBytes, 0);
  const cssGzipBytes = outputs.filter((file) => file.kind === 'css').reduce((sum, file) => sum + file.gzipBytes, 0);
  const jsBytes = outputs.filter((file) => file.kind === 'js').reduce((sum, file) => sum + file.bytes, 0);
  const cssBytes = outputs.filter((file) => file.kind === 'css').reduce((sum, file) => sum + file.bytes, 0);
  const lazyJsGzipBytes = outputs.filter((file) => file.lazy).reduce((sum, file) => sum + file.gzipBytes, 0);
  return { files: outputs, jsBytes, cssBytes, totalBytes: jsBytes + cssBytes, jsGzipBytes, cssGzipBytes, totalGzipBytes: jsGzipBytes + cssGzipBytes,
    startJsGzipBytes: jsGzipBytes - lazyJsGzipBytes, lazyJsGzipBytes };
}

const fixture = await createPackedFixture('size', { tarballPath });
const consumerRoot = await realpath(await mkdtemp(join(tmpdir(), 'cloudlet-size-consumer-')));
try {
  const { manifest } = fixture;
  const archiveFilename = packageTarballFilename(manifest);
  const archive = await readFile(fixture.tarball);
  const sha256 = (source) => createHash('sha256').update(source).digest('hex');
  const workspaceManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const consumerManifest = {
    name: 'cloudlet-isolated-size-consumer', version: '0.0.0', private: true, type: 'module',
    engines: workspaceManifest.engines, packageManager: workspaceManifest.packageManager, volta: workspaceManifest.volta,
    dependencies: {
      ...JSON.parse(await readFile(join(fixtureRoot, 'package.json'), 'utf8')).dependencies,
      [manifest.name]: `file:./${archiveFilename}`,
    },
  };
  const workspaceLock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const consumerLock = { name: consumerManifest.name, version: consumerManifest.version, lockfileVersion: 3, requires: true,
    packages: { '': { name: consumerManifest.name, version: consumerManifest.version, dependencies: consumerManifest.dependencies, engines: consumerManifest.engines } } };
  // Derive exact public dependency resolutions/integrities from the single
  // workspace lock. npm ci then installs a normal isolated node_modules tree.
  const visit = (name) => {
    const key = `node_modules/${name}`;
    if (consumerLock.packages[key]) return;
    const entry = workspaceLock.packages[key];
    assert.ok(entry && !entry.link && entry.integrity && entry.resolved?.startsWith('https://registry.npmjs.org/'), `Missing public locked runtime ${name}`);
    consumerLock.packages[key] = structuredClone(entry);
    delete consumerLock.packages[key].dev;
    delete consumerLock.packages[key].devOptional;
    for (const dependency of Object.keys(entry.dependencies ?? {})) visit(dependency);
  };
  for (const name of Object.keys(consumerManifest.dependencies).filter((name) => name !== manifest.name)) visit(name);
  consumerLock.packages[`node_modules/${manifest.name}`] = {
    version: manifest.version, resolved: `file:${archiveFilename}`,
    integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
    license: manifest.license, dependencies: manifest.dependencies, peerDependencies: manifest.peerDependencies,
  };
  for (const dependency of Object.keys(manifest.dependencies ?? {})) visit(dependency);
  await copyFile(fixture.tarball, join(consumerRoot, archiveFilename));
  await writeFile(join(consumerRoot, 'package.json'), `${JSON.stringify(consumerManifest, null, 2)}\n`);
  const lockText = `${JSON.stringify(consumerLock, null, 2)}\n`;
  await writeFile(join(consumerRoot, 'package-lock.json'), lockText);
  const consumerNpm = execFileSync('npm', ['--version'], { cwd: consumerRoot, encoding: 'utf8' }).trim();
  const consumerNode = execFileSync('node', ['--version'], { cwd: consumerRoot, encoding: 'utf8' }).trim().replace(/^v/u, '');
  assert.equal(consumerNpm, execFileSync('npm', ['--version'], { cwd: root, encoding: 'utf8' }).trim(), 'Isolated npm must use the selected workspace version');
  assert.equal(consumerNode, process.versions.node, 'Isolated npm/node shims must use the selected workspace Node version');
  for (const file of ['react.mjs', 'motion.mjs', 'cloudlet.mjs', 'motion-cloudlet.mjs', 'cloudlet-content.mjs']) await copyFile(join(fixtureRoot, file), join(consumerRoot, file));
  const cache = join(root, 'artifacts/size/.npm-cache');
  // A sandboxed local run can reuse already-downloaded public tarball content
  // without modifying the user's cache. CI simply fetches missing content.
  const existingCache = execFileSync('npm', ['config', 'get', 'cache'], { encoding: 'utf8' }).trim();
  for (const entry of Object.values(consumerLock.packages).filter((entry) => entry.resolved?.startsWith('https://registry.npmjs.org/'))) {
    const digest = Buffer.from(entry.integrity.replace(/^sha512-/u, ''), 'base64').toString('hex');
    const content = join('_cacache/content-v2/sha512', digest.slice(0, 2), digest.slice(2, 4), digest.slice(4));
    try { await mkdir(dirname(join(cache, content)), { recursive: true }); await copyFile(join(existingCache, content), join(cache, content)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', '--cache', cache], { cwd: consumerRoot, encoding: 'utf8', timeout: 120_000 });
  const packageRoot = join(consumerRoot, 'node_modules', manifest.name);
  assert.equal(await realpath(packageRoot), packageRoot, 'Cloudlet must be installed from the archive, never symlinked to workspace sources');
  await mkdir(join(root, 'artifacts/size'), { recursive: true });
  await writeFile(join(root, 'artifacts/size/consumer-package-lock.json'), lockText);
  await writeFile(join(root, 'artifacts/size/consumer-package.json'), `${JSON.stringify(consumerManifest, null, 2)}\n`);
  const rootEntry = join(packageRoot, 'dist/index.js');
  const cssEntry = join(packageRoot, 'dist/styles.css');
  const runtimeExports = Object.keys(await import(pathToFileURL(rootEntry).href));
  assert.deepEqual(runtimeExports, ['CloudletProvider', 'Toaster', 'createCloudlet', 'useCloudlet', 'useOptionalCloudlet'], 'Update the consumer scenario when further runtime exports are implemented');
  const common = {
    configFile: false,
    root: consumerRoot,
    mode: 'production',
    logLevel: 'warn',
  };
  const scenarios = {};
  for (const [name, entry] of Object.entries({
    react: 'react.mjs', reactMotion: 'motion.mjs', reactCloudlet: 'cloudlet.mjs', reactMotionCloudlet: 'motion-cloudlet.mjs',
  })) {
    scenarios[name] = measureOutput(await build({
      ...common,
      build: {
        target: browserTarget,
        minify: 'oxc',
        cssMinify: 'lightningcss',
        sourcemap: false,
        write: false,
        reportCompressedSize: false,
        rolldownOptions: {
          input: join(consumerRoot, entry),
          onwarn: ignoreConsumerClientDirective,
          output: { entryFileNames: 'bundle.js', chunkFileNames: 'chunk-[hash].js', assetFileNames: '[name][extname]' },
        },
      },
    }));
  }
  // Rebundle the packed public ESM with all React subpaths (the peers) external.
  // Since E1 Cloudlet has no runtime dependencies: its generators are part of own JS,
  // and Motion stays in the fixture only as the consumer's own library (already-Motion).
  // preserveEntrySignatures is strict in library mode, retaining all public exports.
  const ownJavaScript = measureOutput(await build({
    ...common,
    build: {
      target: browserTarget,
      minify: 'oxc',
      sourcemap: false,
      write: false,
      reportCompressedSize: false,
      lib: { entry: rootEntry, formats: ['es'], fileName: () => 'cloudlet.js' },
      rolldownOptions: {
        external: (id) => /^(?:react|react-dom)(?:\/|$)/u.test(id),
        onwarn: ignoreConsumerClientDirective,
        // Vite's ES library mode defaults to codegen:false to preserve readable
        // output/annotations for later bundling. This is a final min+gzip metric,
        // so apply the same code formatting minification as a consumer build.
        // Do not mangle properties or remove validation/diagnostics/runtime code.
        output: { minify: { codegen: true }, comments: false },
      },
    },
  }));
  assert.ok(scenarios.react.jsGzipBytes > 0, 'React fixture must retain production React');
  assert.ok(scenarios.reactMotion.jsGzipBytes > scenarios.react.jsGzipBytes, 'Motion fixture must retain used Motion features');
  assert.ok(scenarios.reactCloudlet.cssGzipBytes > 0, 'Explicit Cloudlet CSS must survive bundling');
  assert.ok(ownJavaScript.jsGzipBytes > 20, 'The implemented controller must be retained');
  assert.ok(scenarios.reactCloudlet.jsGzipBytes > scenarios.react.jsGzipBytes, 'Cloudlet consumer must retain its controller');
  assert.equal(scenarios.reactMotionCloudlet.cssGzipBytes, scenarios.reactCloudlet.cssGzipBytes);
  // E5: Toaster loads the renderer after mount, so a consumer must get it as a separate lazy chunk.
  for (const output of [ownJavaScript, scenarios.reactCloudlet]) {
    assert.ok(output.lazyJsGzipBytes > 0 && output.startJsGzipBytes < output.jsGzipBytes, 'The renderer must stay a lazily loaded chunk');
  }
  const report = {
    schemaVersion: 4,
    phase: 'task10-isolated-tarball-consumer',
    runtimeExports,
    toolchain: {
      node: process.versions.node,
      npm: execFileSync('npm', ['--version'], { cwd: root, encoding: 'utf8' }).trim(),
      vite: await version('vite'), react: await version('react', consumerRoot), reactDom: await version('react-dom', consumerRoot), motion: await version('motion', consumerRoot),
      zlib: process.versions.zlib,
    },
    package: { name: manifest.name, version: manifest.version, tarballSha256: sha256(archive) },
    isolatedConsumer: { installation: 'npm ci --ignore-scripts --no-audit --no-fund --prefer-offline', node: consumerNode, npm: consumerNpm, sourceAliases: false, symlinkedPackage: false, lockfileSha256: sha256(lockText), dependencies: Object.fromEntries(Object.entries(consumerLock.packages).filter(([name]) => name).map(([name, entry]) => [name, entry.version])) },
    lockfileSha256: createHash('sha256').update(await readFile(join(root, 'package-lock.json'))).digest('hex'),
    methodology: { mode: 'production', target: browserTarget, jsMinifier: 'oxc', ownJsCodegenMinification: true, ownJsComments: false, cssMinifier: 'lightningcss', compression: 'gzip-level-9-per-file', input: 'npm-pack-tarball-installed-with-npm-ci', cloudletUsage: 'rendered-CloudletProvider-useCloudlet-Toaster-with-pre-mount-show-track-and-explicit-css', motionUsage: 'LazyMotion + m.div + domAnimation' },
    ownJavaScript,
    packedCss: { bytes: (await readFile(cssEntry)).byteLength, gzipBytes: gzipBytes(await readFile(cssEntry)) },
    scenarios,
    deltas: {
      fullConsumerBytes: scenarios.reactCloudlet.totalBytes - scenarios.react.totalBytes,
      fullConsumerGzipBytes: scenarios.reactCloudlet.totalGzipBytes - scenarios.react.totalGzipBytes,
      // What the page loads before the renderer chunk: start JS plus the explicit CSS.
      fullConsumerStartGzipBytes: scenarios.reactCloudlet.startJsGzipBytes + scenarios.reactCloudlet.cssGzipBytes - scenarios.react.totalGzipBytes,
      alreadyMotionBytes: scenarios.reactMotionCloudlet.totalBytes - scenarios.reactMotion.totalBytes,
      alreadyMotionGzipBytes: scenarios.reactMotionCloudlet.totalGzipBytes - scenarios.reactMotion.totalGzipBytes,
    },
  };
  const checks = [
    { metric: 'ownJavaScript.jsGzipBytes', actualBytes: report.ownJavaScript.jsGzipBytes, limitBytes: limits.ownJsLimitBytes },
    { metric: 'packedCss.gzipBytes', actualBytes: report.packedCss.gzipBytes, limitBytes: limits.cssLimitBytes },
    { metric: 'deltas.fullConsumerGzipBytes', actualBytes: report.deltas.fullConsumerGzipBytes, limitBytes: limits.fullDeltaLimitBytes },
  ].map((check) => ({ ...check, passed: check.actualBytes <= check.limitBytes, overBytes: Math.max(0, check.actualBytes - check.limitBytes) }));
  const failures = checks.filter((check) => !check.passed);
  report.budgets = {
    status: failures.length ? 'failed' : 'passed',
    enforcement: enforceBudgets ? 'enforced' : 'report-only',
    deferral: { date: '2026-10-16', source: 'owner-reaffirmed-size-deferral', reason: 'All size limits deferred until final optimization; numeric comparisons remain visible.' },
    ...limits, ownJsAcceptance, checks,
  };
  await mkdir(join(root, 'artifacts/size'), { recursive: true });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(reportPath, serialized);
  if (flags.includes('--write-baseline')) {
    await writeFile(baselinePath, serialized);
    console.log('Wrote scripts/size-baseline.json by explicit request.');
  }
  console.log(`Start (before the lazy renderer): own JS ${ownJavaScript.startJsGzipBytes} B, full consumer delta ${report.deltas.fullConsumerStartGzipBytes} B; renderer chunk ${ownJavaScript.lazyJsGzipBytes} B (gzip).`);
  console.log(`Size comparison ${report.budgets.status} (${report.budgets.enforcement}): own JS ${ownJavaScript.jsGzipBytes} B, packed CSS ${report.packedCss.gzipBytes} B, full consumer delta ${report.deltas.fullConsumerGzipBytes} B, already-Motion delta ${report.deltas.alreadyMotionGzipBytes} B (gzip).`);
  console.log(`Historical comparisons: own JS ${limits.ownJsLimitBytes} B, CSS ${limits.cssLimitBytes} B, full delta ${limits.fullDeltaLimitBytes} B.`);
  for (const failure of failures) console.log(`FAIL ${failure.metric}: ${failure.actualBytes} B exceeds ${failure.limitBytes} B by ${failure.overBytes} B.`);
  console.log('Foundation baseline unchanged unless explicitly requested. Report: artifacts/size/report.json');
  if (failures.length && enforceBudgets) process.exitCode = 1;
} finally {
  await rm(consumerRoot, { recursive: true, force: true });
  await fixture.cleanup();
}
