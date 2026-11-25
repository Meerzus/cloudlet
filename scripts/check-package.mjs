import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Unpack one archive into `directory/<folder>` and link it into `directory/node_modules`. */
async function addArchive(directory, { packageDir, tarballPath }) {
  const folder = join(directory, basename(packageDir));
  await mkdir(folder);
  let packed;
  let tarball;
  if (tarballPath) {
    tarball = resolve(root, tarballPath);
    const paths = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n');
    assert.ok(paths.every((path) => path.startsWith('package/') && !path.split('/').includes('..')), 'Unexpected archive path');
    packed = { filename: tarball, files: paths.filter((path) => !path.endsWith('/')).map((path) => ({ path: path.slice('package/'.length) })) };
  } else {
    [packed] = JSON.parse(execFileSync('npm', [
      'pack', `./${packageDir}`, '--json', '--ignore-scripts', '--pack-destination', folder,
      '--cache', join(directory, '.npm-cache'),
    ], { cwd: root, encoding: 'utf8' }));
    tarball = join(folder, packed.filename);
  }
  // Either npm generated this archive from the local workspace, or the paths were checked above.
  execFileSync('tar', ['-xzf', tarball, '-C', folder]);
  const packageRoot = join(folder, 'package');
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  await mkdir(join(directory, 'node_modules', dirname(manifest.name)), { recursive: true });
  await symlink(packageRoot, join(directory, 'node_modules', manifest.name), 'dir');
  return { packageDir, packageRoot, manifest, packed, tarball };
}

/**
 * Pack the built packages (or take given archives) into one temporary consumer directory,
 * without running lifecycle scripts or publishing. Each archive is installed under its name in
 * that directory's node_modules, so it wins over the workspace links further up.
 */
export async function createPackedFixtures(prefix, archives) {
  const artifacts = join(root, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(join(artifacts, `${prefix}-`));
  try {
    const packages = [];
    for (const archive of archives) packages.push(await addArchive(directory, archive));
    return { directory, packages, cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/** The Toaster's archive alone; `measure-size.mjs` reads `manifest`, `tarball` and `cleanup`. */
export async function createPackedFixture(prefix, { tarballPath } = {}) {
  const fixture = await createPackedFixtures(prefix, [{ packageDir: 'packages/toast', tarballPath }]);
  return { directory: fixture.directory, ...fixture.packages[0], cleanup: fixture.cleanup };
}

const run = (directory, type, code) => execFileSync(process.execPath, [`--input-type=${type}`, '--eval', code], {
  cwd: directory, encoding: 'utf8', timeout: 20_000,
});

/** Strict consumer typecheck of `fixtures/size/<file>` against the archives in `directory`. */
async function typecheckConsumer(directory, file, lib) {
  const name = `consumer-${basename(file, '.ts')}`;
  await copyFile(join(root, 'fixtures/size', file), join(directory, `${name}.ts`));
  await writeFile(join(directory, `${name}.tsconfig.json`), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
      exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, noEmit: true,
      skipLibCheck: false, lib, types: [],
    },
    files: [`${name}.ts`],
  }));
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/lib/tsc.js'), '-p', join(directory, `${name}.tsconfig.json`)], {
    cwd: directory, encoding: 'utf8', timeout: 20_000,
  });
}

// Probes install resource traps before any runtime dependency import.
// Record calls as well as throwing, so dependency try/catch cannot mask one.
const resourceTraps = `
  const resourceCalls = [];
  const fail = (resource) => () => {
    resourceCalls.push(resource);
    throw new Error('Import/SSR resource access: ' + resource);
  };
  for (const timer of ['setTimeout', 'setInterval', 'setImmediate', 'requestAnimationFrame', 'requestIdleCallback']) {
    globalThis[timer] = fail(timer);
  }
  globalThis.addEventListener = fail('global.addEventListener');
  EventTarget.prototype.addEventListener = fail('EventTarget.addEventListener');
`;
const browserGlobals = `['window', 'document', 'navigator', 'localStorage', 'sessionStorage']`;
const removeBrowserGlobals = `for (const resource of ${browserGlobals}) delete globalThis[resource];`;
// Throwing getters enforce Cloudlet's no-DOM-read boundary: Cloudlet packages have no runtime
// dependencies, so everything evaluated after this line, apart from preloaded peers, is their own.
const guardBrowserGlobals = `for (const resource of ${browserGlobals}) Object.defineProperty(globalThis, resource, { configurable: true, get: fail(resource) });`;

const exportTargets = (manifest) => Object.entries(manifest.exports)
  .map(([subpath, target]) => ({ subpath, target: typeof target === 'string' ? target : target.import }));

/**
 * Checks every Cloudlet archive shares: an ESM-only public manifest without dependencies, only
 * expected files, maps that point at packed files, rejected deep imports and a cold import of
 * every JavaScript export that touches no DOM, timers or listeners.
 */
async function checkArchive(directory, { packageDir, packageRoot, manifest, packed }, expected) {
  const label = manifest.name;
  assert.equal(manifest.type, 'module', `${label} must be ESM`);
  // Public packages; prereleases go to the `next` dist-tag, stable versions to `latest`.
  assert.equal(manifest.private, undefined, `${label}: a public package carries no private flag`);
  assert.notEqual(manifest.version, '0.0.0', `${label}: a publishable version is required`);
  assert.deepEqual(manifest.publishConfig, { access: 'public', tag: /-/u.test(manifest.version) ? 'next' : 'latest' }, `${label}: publishConfig must be public, prereleases under next`);
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.homepage, expected.homepage);
  assert.deepEqual(manifest.repository, { type: 'git', url: 'git+https://github.com/Meerzus/cloudlet.git', directory: packageDir });
  assert.equal(manifest.dependencies, undefined, `${label} must declare no runtime dependencies`);
  assert.ok(!manifest.bundledDependencies?.length && !manifest.bundleDependencies?.length, `${label}: no dependencies may be bundled by npm`);
  assert.deepEqual(Object.keys(manifest.exports).sort(), expected.exports, `${label}: unexpected export keys`);
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (typeof target === 'string') continue;
    // `types` must come first so TypeScript sees it; `default` must come last so it
    // only catches resolvers that arrive without the `import` condition (CommonJS
    // `require()` on Node 22.12+, `require.resolve`, Jest in CJS mode, lint resolvers).
    assert.deepEqual(Object.keys(target), ['types', 'import', 'default'], `${label} ${subpath}: export conditions must be types, import, default in this order`);
    assert.match(target.import, /^\.\/dist\/.+\.js$/u);
    assert.equal(target.types, target.import.replace(/\.js$/u, '.d.ts'), `${label} ${subpath}: types must sit next to the entry`);
    assert.equal(target.default, target.import, `${label} ${subpath}: the default condition must serve the same ESM entry, not a second build`);
  }
  assert.equal(manifest.types, manifest.exports['.'].types);

  const files = packed.files.map(({ path }) => path);
  for (const required of ['LICENSE', 'README.md', 'CHANGELOG.md', 'package.json', ...expected.files]) {
    assert.ok(files.includes(required), `${label}: ${required} must accompany the package`);
  }
  for (const { subpath, target } of exportTargets(manifest)) {
    assert.ok(files.includes(posix.normalize(target)), `${label} ${subpath}: export target missing from the tarball: ${target}`);
    if (target.endsWith('.js')) assert.ok(files.includes(posix.normalize(target.replace(/\.js$/u, '.d.ts'))), `${label} ${subpath}: declarations missing`);
  }
  assert.equal(await readFile(join(packageRoot, 'LICENSE'), 'utf8'), await readFile(join(root, 'LICENSE'), 'utf8'), `${label}: packed own-source license must match the repository MIT text`);
  for (const path of files) {
    assert.ok(/^(?:dist\/|src\/|LICENSE$|THIRD_PARTY_NOTICES\.md$|README\.md$|CHANGELOG\.md$|package\.json$)/u.test(path), `${label}: unexpected package content: ${path}`);
    assert.ok(!/(^|\/)(node_modules|\.env[^/]*|tests?|__tests__)(\/|$)/u.test(path), `${label}: unexpected packed file: ${path}`);
    assert.ok(!/\.(cjs|umd\.js)$/u.test(path), `${label}: unexpected non-ESM output: ${path}`);
  }
  for (const path of files.filter((path) => path.endsWith('.d.ts.map'))) {
    const map = JSON.parse(await readFile(join(packageRoot, path), 'utf8'));
    assert.ok(map.sources.length > 0, `Declaration map must have sources: ${path}`);
    for (const source of map.sources) {
      const sourcePath = resolve(packageRoot, dirname(path), map.sourceRoot ?? '', source);
      const packedPath = relative(packageRoot, sourcePath).replaceAll('\\', '/');
      assert.ok(files.includes(packedPath), `${label}: declaration map points outside packed sources: ${path} → ${source}`);
      assert.ok((await readFile(sourcePath, 'utf8')).length > 0, `${label}: empty mapped source: ${packedPath}`);
    }
  }
  const javascript = files.filter((path) => path.endsWith('.js'));
  for (const path of javascript) {
    const code = await readFile(join(packageRoot, path), 'utf8');
    if (expected.clientEntries.includes(path)) {
      assert.match(code.trimStart(), /^["']use client["'];/u, `${label}: ${path} must preserve its client directive`);
    } else {
      assert.doesNotMatch(code, /["']use client["']/u, `${label}: client directive leaked into ${path}`);
    }
    // Vite emits no map for empty entries or pure forwarding facades.
    // Only imports/reexports of named bindings are allowed without a map;
    // any executable implementation must retain one for the boundary check.
    if (!files.includes(`${path}.map`)) {
      const implementation = code.trimStart().replace(/^["']use client["'];\s*/u, '')
        .replace(/(?:import\s*\{[^{}]*\}\s*from\s*["'][^"']+["']|export\s*\{[^{}]*\}(?:\s*from\s*["'][^"']+["'])?)\s*;/gu, '').trim();
      assert.equal(implementation, '', `${label}: missing source map for implementation in ${path}`);
      continue;
    }
    const map = JSON.parse(await readFile(join(packageRoot, `${path}.map`), 'utf8'));
    assert.ok(Array.isArray(map.sources), 'Source map must identify its inputs');
    for (const source of map.sources) {
      const sourcePath = resolve(packageRoot, dirname(path), map.sourceRoot ?? '', source);
      const packedSource = relative(packageRoot, sourcePath).replaceAll('\\', '/');
      assert.ok(packedSource.startsWith('src/') && files.includes(packedSource),
        `${label}: only packed Cloudlet source may be bundled into ${path}: ${source}`);
    }
  }

  const internalPaths = [...new Set([
    ...expected.extraDeepImports, 'package.json',
    ...files.filter((path) => path.startsWith('dist/')),
  ])].map((path) => `${manifest.name}/${path}`);
  const entries = exportTargets(manifest).filter(({ target }) => target.endsWith('.js'))
    .map(({ subpath }) => posix.join(manifest.name, subpath));
  // A cold import of every JavaScript export with no browser globals: external peers are
  // preloaded first with the timer and listener traps active, then DOM reads throw.
  const coldImport = `
    import assert from 'node:assert/strict';
    ${resourceTraps}
    ${removeBrowserGlobals}
    await Promise.all(${JSON.stringify(expected.preload)}.map((peer) => import(peer)));
    assert.deepEqual(resourceCalls, [], 'External peer preload must not allocate timers or listeners');
    ${guardBrowserGlobals}
    for (const entry of ${JSON.stringify(entries)}) await import(entry);
    for (const specifier of ${JSON.stringify(internalPaths)}) {
      await assert.rejects(import(specifier), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }, specifier);
    }
    assert.deepEqual(resourceCalls, [], 'A cold import must not read the DOM or allocate timers/listeners');
  `;
  run(directory, 'module', coldImport);
  return { files, rejectedDeepImports: internalPaths.length, entries: entries.length };
}

/** Relative static and dynamic imports of `entry`, followed through the packed files. */
async function moduleGraph(packageRoot, entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    const code = await readFile(join(packageRoot, path), 'utf8');
    // Every `import(` must name a literal, or the walk could miss a module.
    assert.doesNotMatch(code, /\bimport\s*\(\s*(?!["'])/u, `Dynamic import with a computed specifier in ${path}`);
    for (const [, specifier] of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/gu)) {
      if (specifier.startsWith('.')) queue.push(posix.join(posix.dirname(path), specifier));
    }
  }
  return seen;
}

const TOAST_RUNTIME = ['CloudletProvider', 'Toaster', 'createCloudlet', 'useCloudlet', 'useOptionalCloudlet'];
const REACT_PEERS = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/server'];
// The adapter and its read port: whoever imports only the package root must not load them.
const AGENT_MODULES = ['dist/agent.js', 'dist/core/agent-port.js'];

async function checkToast(directory, archive) {
  const { manifest, packageRoot } = archive;
  const common = await checkArchive(directory, archive, {
    homepage: 'https://cloudlet.dev/toaster',
    exports: ['.', './agent', './styles.css'],
    files: ['THIRD_PARTY_NOTICES.md', 'dist/index.d.ts', 'dist/styles.css'],
    clientEntries: ['dist/react.js'],
    extraDeepImports: ['react', 'core', 'controller'],
    preload: REACT_PEERS,
  });
  const { files } = common;
  assert.equal(manifest.exports['.'].import, './dist/index.js');
  assert.equal(manifest.exports['./agent'].import, './dist/agent.js');
  assert.equal(manifest.exports['./styles.css'], './dist/styles.css');
  assert.equal(manifest.peerDependencies.react, '^18.2.0 || ^19.0.0');
  assert.equal(manifest.peerDependencies['react-dom'], '^18.2.0 || ^19.0.0');
  assert.ok(manifest.sideEffects.includes('./dist/styles.css') || manifest.sideEffects.includes('**/*.css'), 'Explicit CSS import must survive tree-shaking');
  const javascript = files.filter((path) => path.endsWith('.js'));
  assert.ok(javascript.includes('dist/index.js') && javascript.includes('dist/react.js'));
  const publicEntry = await readFile(join(packageRoot, 'dist/index.js'), 'utf8');
  assert.match(publicEntry, /from\s+["']\.\/react\.js["']/u, 'Root React exports must pass through the client boundary');
  assert.doesNotMatch(publicEntry, /from\s+["'](?:react(?:-dom)?(?:\/[^"']*)?|\.\/react\/[^"']*|\.\/react-[^"']*)["']/u, 'Root must not bypass react.js or execute React implementation directly');

  // Only the importer of `@cloudlet/toast/agent` pays for the adapter: the root's whole graph,
  // dynamic chunks included, stays free of it, and nothing in dist names the bridge package.
  const rootGraph = await moduleGraph(packageRoot, 'dist/index.js');
  assert.ok(rootGraph.has('dist/react.js') && rootGraph.has('dist/react/renderer.js'), 'The graph walk must follow static and dynamic imports');
  for (const module of AGENT_MODULES) assert.ok(!rootGraph.has(module), `The root entry reaches ${module}`);
  const agentGraph = await moduleGraph(packageRoot, 'dist/agent.js');
  assert.ok(AGENT_MODULES.every((module) => agentGraph.has(module)), 'The agent entry must reach its read port');
  for (const path of files.filter((path) => path.startsWith('dist/'))) {
    assert.ok(!(await readFile(join(packageRoot, path), 'utf8')).includes('@cloudlet/agent'), `${path} names @cloudlet/agent`);
  }

  // First test a cold package import and SSR with no browser globals. This
  // includes external React code, so the complete public graph must
  // neither schedule timers nor attach listeners in a normal server environment.
  const serverProbe = `
    import assert from 'node:assert/strict';
    ${resourceTraps}
    ${removeBrowserGlobals}
    const warnings = [];
    console.error = (...args) => warnings.push(args);
    console.warn = (...args) => warnings.push(args);
    const namespace = await import(${JSON.stringify(manifest.name)});
    const { createElement } = await import('react');
    const { renderToString } = await import('react-dom/server');
    const controller = namespace.createCloudlet();
    assert.equal(controller.show({ title: 'Before server render' }).status, 'created');
    const tree = createElement(namespace.CloudletProvider, { controller }, createElement(namespace.Toaster));
    assert.equal(renderToString(tree), '', 'Server render must stay empty even with queued notifications');
    assert.equal(renderToString(tree), '', 'Repeated server output must be stable');
    assert.equal(controller.getSnapshot().notifications.length, 1, 'SSR must preserve pre-mount notifications');
    assert.equal(controller.getServerSnapshot().notifications.length, 0);
    assert.deepEqual(warnings, [], 'SSR must not issue console warnings');
    controller.dispose();
    assert.deepEqual(resourceCalls, [], 'Cold public graph import/SSR must not allocate timers or listeners');
  `;
  run(directory, 'module', serverProbe);
  const probe = `
    import assert from 'node:assert/strict';
    ${resourceTraps}
    ${removeBrowserGlobals}
    // React DOM feature-detects browser globals on import. Preload only the
    // external peers with timer/listener traps already active.
    // Every Cloudlet module is still evaluated for the first time below.
    const [{ createElement }, , , { renderToString }] = await Promise.all(${JSON.stringify(REACT_PEERS)}.map((peer) => import(peer)));
    assert.deepEqual(resourceCalls, [], 'External dependency preload must not allocate timers or listeners');
    ${guardBrowserGlobals}
    const namespace = await import(${JSON.stringify(manifest.name)});
    assert.deepEqual(Object.keys(namespace), ${JSON.stringify(TOAST_RUNTIME)}, 'Only implemented public runtime APIs are exported');
    const client = await import(${JSON.stringify(pathToFileURL(join(packageRoot, 'dist/react.js')).href)});
    for (const name of ['CloudletProvider', 'Toaster', 'useCloudlet', 'useOptionalCloudlet']) {
      assert.equal(typeof namespace[name], 'function', name + ' must be implemented');
      assert.equal(namespace[name], client[name], name + ' must come from the client boundary');
    }
    const controller = namespace.createCloudlet();
    assert.equal(renderToString(createElement(namespace.CloudletProvider, { controller }, createElement(namespace.Toaster))), '', 'Cloudlet SSR must not access DOM or create external resources');
    assert.equal(renderToString(createElement(namespace.CloudletProvider, { controller: null }, createElement('p', null, 'page'), createElement(namespace.Toaster))), '<p>page</p>', 'A pending (null) controller keeps server HTML and renders no Toaster');
    assert.equal(typeof controller.track, 'function', 'The operations runner must be available');
    assert.equal('attach' in controller, false, 'The renderer bridge must remain private');
    const admission = controller.show({ id: 'packed-smoke', title: 'Packed controller' });
    assert.equal(admission.status, 'created');
    assert.equal(controller.getHandle('packed-smoke'), admission.handle);
    assert.equal(controller.update(admission.handle, { title: 'Updated' }).status, 'applied');
    assert.equal(controller.getSnapshot().notifications[0].content.title, 'Updated');
    assert.equal(controller.clear().count, 1);
    let factoryCalls = 0;
    const operation = controller.track(({ signal }) => {
      assert.ok(signal instanceof AbortSignal, 'Public operations must receive a native AbortSignal');
      factoryCalls += 1;
      return Promise.resolve(7);
    }, {
      pending: { title: 'Working' }, success: (value) => ({ title: 'Result ' + value }), error: { title: 'Failed' },
    });
    assert.equal(operation.admission.status, 'created');
    assert.equal(await operation.result, 7);
    assert.equal(factoryCalls, 1);
    assert.equal(operation.getSnapshot().status, 'fulfilled');
    assert.equal(controller.getSnapshot().notifications[0].content.title, 'Result 7');
    const failure = new Error('Packed rejection');
    const rejected = controller.track(() => { throw failure; }, {
      pending: { title: 'Working' }, success: { title: 'Done' }, error: { title: 'Failed' },
    });
    await assert.rejects(rejected.result, (error) => error === failure);
    assert.equal(rejected.getSnapshot().status, 'rejected');
    controller.dispose();
    controller.dispose();
    assert.equal(controller.getSnapshot().disposed, true);
    assert.equal(controller.getSnapshot().notifications.length, 0);
    assert.ok(import.meta.resolve(${JSON.stringify(`${manifest.name}/styles.css`)}).endsWith('/dist/styles.css'));

    // The experimental subpath reads a controller on the server: no DOM, timers or listeners.
    const adapter = await import(${JSON.stringify(`${manifest.name}/agent`)});
    assert.deepEqual(Object.keys(adapter), ['toasterAgent'], 'The agent subpath exports exactly toasterAgent');
    const read = namespace.createCloudlet();
    const view = adapter.toasterAgent(read);
    assert.equal(view.protocol, 1);
    assert.equal(view.name, 'toaster');
    const empty = view.snapshot();
    assert.ok(Object.isFrozen(empty) && empty.length === 1, 'A fresh controller yields the Toaster record alone');
    assert.equal(empty[0].ref, 'toaster');
    assert.equal(empty[0].component, 'toaster');
    assert.equal(empty[0].mounted, false);
    assert.equal(view.snapshot(), empty, 'An unchanged controller returns the same array');
    let notified = 0;
    const unsubscribe = view.subscribe(() => { notified += 1; });
    read.show({ title: 'Read by the agent' });
    assert.ok(notified > 0, 'subscribe reports controller changes');
    const entries = view.snapshot();
    assert.deepEqual(entries.map((entry) => entry.ref), ['toaster', 'toaster:1']);
    assert.equal(entries[1].label, 'Read by the agent');
    assert.deepEqual(structuredClone(entries), JSON.parse(JSON.stringify(entries)), 'The snapshot is plain data');
    unsubscribe();
    read.dispose();
    assert.deepEqual(view.snapshot(), [], 'A disposed controller yields no records');
    assert.deepEqual(resourceCalls, [], 'Cloudlet first import, SSR, unmounted lifecycle and the agent read must not read DOM or allocate timers/listeners');
  `;
  run(directory, 'module', probe);
  const commonJsProbe = `
    const assert = require('node:assert/strict');
    const resolved = require.resolve(${JSON.stringify(manifest.name)});
    assert.ok(resolved.endsWith('/dist/index.js'), 'CommonJS resolution must reach the ESM root through the default condition');
    const namespace = require(${JSON.stringify(manifest.name)});
    assert.deepEqual(Object.keys(namespace).filter((key) => key !== '__esModule').sort(), ${JSON.stringify(TOAST_RUNTIME)}, 'require() must expose the same public runtime API');
    assert.equal(typeof namespace.createCloudlet, 'function');
    assert.equal(require.resolve(${JSON.stringify(`${manifest.name}/styles.css`)}).endsWith('/dist/styles.css'), true);
    assert.ok(require.resolve(${JSON.stringify(`${manifest.name}/agent`)}).endsWith('/dist/agent.js'), 'CommonJS resolution must reach the agent subpath');
    const adapter = require(${JSON.stringify(`${manifest.name}/agent`)});
    assert.deepEqual(Object.keys(adapter).filter((key) => key !== '__esModule'), ['toasterAgent'], 'require() of the agent subpath exposes exactly toasterAgent');
  `;
  run(directory, 'commonjs', commonJsProbe);
  await typecheckConsumer(directory, 'package-contracts.ts', ['ES2022', 'DOM']);
  console.log(`${manifest.name}: ${files.length} packed files, ESM/CSS/agent exports, peer boundaries, navigable declaration maps, client boundary, root graph free of the agent adapter (${rootGraph.size} modules), cold no-DOM import/SSR, CommonJS require() through the default condition, guarded notification/operation lifecycle, server-side agent snapshot, ${common.rejectedDeepImports} rejected deep imports, strict tarball React consumer typecheck.`);
}

async function checkAgent(directory, archive) {
  const { manifest } = archive;
  const common = await checkArchive(directory, archive, {
    homepage: 'https://cloudlet.dev',
    exports: ['.'],
    files: ['dist/index.js', 'dist/index.d.ts'],
    clientEntries: [],
    extraDeepImports: ['agent', 'types', 'src/index.ts'],
    preload: [],
  });
  assert.equal(manifest.exports['.'].import, './dist/index.js');
  assert.equal(manifest.peerDependencies, undefined, 'The bridge has no peer dependencies');
  assert.equal(manifest.sideEffects, false);
  const probe = `
    import assert from 'node:assert/strict';
    ${resourceTraps}
    ${removeBrowserGlobals}
    ${guardBrowserGlobals}
    const namespace = await import(${JSON.stringify(manifest.name)});
    assert.deepEqual(Object.keys(namespace), ['createAgent'], 'The bridge exports exactly createAgent');
    const agent = namespace.createAgent();
    assert.deepEqual(agent.snapshot(), []);
    let state = 1;
    let notify;
    const component = {
      protocol: 1, name: 'fake',
      snapshot: () => [{ ref: 'fake', component: 'fake', actions: [], state }],
      subscribe: (listener) => { notify = listener; return () => { notify = undefined; }; },
    };
    let calls = 0;
    const unsubscribe = agent.subscribe(() => { calls += 1; });
    const disconnect = agent.connect(component);
    assert.equal(calls, 1, 'connect notifies subscribers');
    const first = agent.snapshot();
    assert.ok(Object.isFrozen(first));
    assert.deepEqual(first, [{ ref: 'fake', component: 'fake', actions: [], state: 1 }]);
    assert.equal(agent.snapshot(), first, 'An unchanged bridge returns the same array');
    state = 2;
    notify();
    assert.equal(calls, 2, 'A component change reaches subscribers');
    assert.equal(agent.snapshot()[0].state, 2);
    assert.throws(() => agent.connect(component), TypeError, 'A name connects once');
    disconnect();
    assert.equal(notify, undefined, 'disconnect unsubscribes from the component');
    assert.deepEqual(agent.snapshot(), []);
    unsubscribe();
    assert.deepEqual(resourceCalls, [], 'The bridge must not read the DOM or allocate timers/listeners');
  `;
  run(directory, 'module', probe);
  const commonJsProbe = `
    const assert = require('node:assert/strict');
    assert.ok(require.resolve(${JSON.stringify(manifest.name)}).endsWith('/dist/index.js'));
    const namespace = require(${JSON.stringify(manifest.name)});
    assert.deepEqual(Object.keys(namespace).filter((key) => key !== '__esModule'), ['createAgent']);
  `;
  run(directory, 'commonjs', commonJsProbe);
  await typecheckConsumer(directory, 'agent-contracts.ts', ['ES2022']);
  console.log(`${manifest.name}: ${common.files.length} packed files, ESM export, no dependencies or peers, navigable declaration maps, cold no-DOM import, CommonJS require() through the default condition, connect/snapshot/subscribe without DOM or timers, ${common.rejectedDeepImports} rejected deep imports, strict tarball consumer typecheck without DOM.`);
}

/** Both archives in one node_modules: the bridge reads a Toaster controller, typed from the archives. */
async function checkTogether(directory) {
  const probe = `
    import assert from 'node:assert/strict';
    ${resourceTraps}
    ${removeBrowserGlobals}
    await Promise.all(${JSON.stringify(REACT_PEERS)}.map((peer) => import(peer)));
    ${guardBrowserGlobals}
    const { createAgent } = await import('@cloudlet/agent');
    const { createCloudlet } = await import('@cloudlet/toast');
    const { toasterAgent } = await import('@cloudlet/toast/agent');
    const agent = createAgent();
    const controller = createCloudlet();
    const secondary = createCloudlet();
    agent.connect(toasterAgent(controller));
    const disconnect = agent.connect(toasterAgent(secondary, { name: 'secondary' }));
    let calls = 0;
    agent.subscribe(() => { calls += 1; });
    controller.show({ title: 'Through the bridge' });
    assert.ok(calls > 0, 'A Toaster change reaches the bridge');
    assert.deepEqual(agent.snapshot().map((entry) => entry.ref), ['toaster', 'toaster:1', 'secondary']);
    disconnect();
    assert.deepEqual(agent.snapshot().map((entry) => entry.ref), ['toaster', 'toaster:1']);
    controller.dispose();
    secondary.dispose();
    assert.deepEqual(agent.snapshot(), []);
    assert.deepEqual(resourceCalls, [], 'Reading Toaster through the bridge must not touch the DOM or allocate timers/listeners');
  `;
  run(directory, 'module', probe);
  await typecheckConsumer(directory, 'agent-toaster-contracts.ts', ['ES2022', 'DOM']);
  console.log('@cloudlet/agent + @cloudlet/toast/agent: createAgent().connect(toasterAgent(controller)) runs from both archives and typechecks against their declarations.');
}

const USAGE = 'Usage: node scripts/check-package.mjs [--tarball <toast.tgz>] [--agent-tarball <agent.tgz>]';

function parseFlags(flags) {
  const options = {};
  for (let index = 0; index < flags.length; index += 2) {
    const key = { '--tarball': 'toast', '--agent-tarball': 'agent' }[flags[index]];
    assert.ok(key && flags[index + 1] && !(key in options), USAGE);
    options[key] = flags[index + 1];
  }
  return options;
}

/** Without flags both packages are packed from the built workspace; a flag takes that archive instead. */
export async function checkPackages({ toast, agent } = {}) {
  const fixture = await createPackedFixtures('package-check', [
    { packageDir: 'packages/toast', tarballPath: toast },
    { packageDir: 'packages/agent', tarballPath: agent },
  ]);
  try {
    const [toaster, bridge] = fixture.packages;
    await checkToast(fixture.directory, toaster);
    await checkAgent(fixture.directory, bridge);
    await checkTogether(fixture.directory);
    console.log(`Package guards passed: ${toaster.manifest.name}@${toaster.manifest.version}, ${bridge.manifest.name}@${bridge.manifest.version} and both together.`);
  } finally {
    await fixture.cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkPackages(parseFlags(process.argv.slice(2)));
}
