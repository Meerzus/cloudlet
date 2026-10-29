import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Pack exactly the built package, without running lifecycle scripts or publishing. */
export async function createPackedFixture(prefix, { tarballPath } = {}) {
  const artifacts = join(root, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(join(artifacts, `${prefix}-`));
  try {
    let packed;
    let tarball;
    if (tarballPath) {
      tarball = resolve(root, tarballPath);
      const paths = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n');
      assert.ok(paths.every((path) => path.startsWith('package/') && !path.split('/').includes('..')), 'Unexpected archive path');
      packed = { filename: tarball, files: paths.filter((path) => !path.endsWith('/')).map((path) => ({ path: path.slice('package/'.length) })) };
    } else {
      [packed] = JSON.parse(execFileSync('npm', [
        'pack', './packages/toast', '--json', '--ignore-scripts', '--pack-destination', directory,
        '--cache', join(directory, '.npm-cache'),
      ], { cwd: root, encoding: 'utf8' }));
      tarball = join(directory, packed.filename);
    }
    // npm generated this archive from the local workspace, not from an external input.
    execFileSync('tar', ['-xzf', tarball, '-C', directory]);
    const packageRoot = join(directory, 'package');
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    const scopeRoot = join(directory, 'node_modules', dirname(manifest.name));
    await mkdir(scopeRoot, { recursive: true });
    await symlink(packageRoot, join(directory, 'node_modules', manifest.name), 'dir');
    return {
      directory, packageRoot, manifest, packed, tarball,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function checkPackage(tarballPath) {
  const fixture = await createPackedFixture('package-check', { tarballPath });
  try {
    const { manifest, packed, packageRoot, directory } = fixture;
    assert.equal(manifest.type, 'module', 'Package must be ESM');
    // The package is public; prereleases go to the `next` dist-tag, stable versions to `latest`.
    assert.equal(manifest.private, undefined, 'A public package carries no private flag');
    assert.notEqual(manifest.version, '0.0.0', 'A publishable version is required');
    assert.deepEqual(manifest.publishConfig, { access: 'public', tag: /-/u.test(manifest.version) ? 'next' : 'latest' }, 'publishConfig must be public, prereleases under next');
    assert.equal(manifest.homepage, 'https://cloudlet.dev/toaster');
    assert.deepEqual(manifest.repository, { type: 'git', url: 'git+https://github.com/Meerzus/cloudlet.git', directory: 'packages/toast' });
    assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './styles.css']);
    // `types` must come first so TypeScript sees it; `default` must come last so it
    // only catches resolvers that arrive without the `import` condition (CommonJS
    // `require()` on Node 22.12+, `require.resolve`, Jest in CJS mode, lint resolvers).
    assert.deepEqual(Object.keys(manifest.exports['.']), ['types', 'import', 'default'], 'Root export conditions must be types, import, default in this order');
    assert.equal(manifest.exports['.'].types, './dist/index.d.ts');
    assert.equal(manifest.exports['.'].import, './dist/index.js');
    assert.equal(manifest.exports['.'].default, './dist/index.js', 'The default condition must serve the same ESM entry, not a second build');
    assert.equal(manifest.exports['./styles.css'], './dist/styles.css');
    assert.equal(manifest.types, './dist/index.d.ts');
    assert.equal(manifest.peerDependencies.react, '^18.2.0 || ^19.0.0');
    assert.equal(manifest.peerDependencies['react-dom'], '^18.2.0 || ^19.0.0');
    // E1: the generators are Cloudlet's own, Motion is no runtime dependency.
    assert.equal(manifest.dependencies, undefined, 'Cloudlet must declare no runtime dependencies');
    assert.ok(!manifest.dependencies?.react && !manifest.dependencies?.['react-dom'], 'React must remain a peer');
    assert.ok(manifest.sideEffects.includes('./dist/styles.css') || manifest.sideEffects.includes('**/*.css'), 'Explicit CSS import must survive tree-shaking');
    assert.ok(!manifest.bundledDependencies?.length, 'No dependencies may be bundled by npm');
    assert.ok(!manifest.bundleDependencies?.length, 'No dependencies may be bundled by npm');

    const files = packed.files.map(({ path }) => path);
    assert.ok(files.includes('LICENSE'), 'Own source license must accompany the package');
    assert.ok(files.includes('CHANGELOG.md'), 'Release history must accompany the candidate');
    assert.ok(files.includes('THIRD_PARTY_NOTICES.md') && files.includes('README.md'), 'Installation docs and dependency notices must accompany the package');
    assert.equal(await readFile(join(packageRoot, 'LICENSE'), 'utf8'), await readFile(join(root, 'LICENSE'), 'utf8'), 'Packed own-source license must match the repository MIT text');
    assert.equal(manifest.license, 'MIT');
    assert.ok(files.includes('dist/index.d.ts'), 'Root declaration export must exist in tarball');
    assert.ok(files.includes('dist/styles.css'), 'CSS export must exist in tarball');
    for (const path of files) {
      assert.ok(/^(?:dist\/|src\/|LICENSE$|THIRD_PARTY_NOTICES\.md$|README\.md$|CHANGELOG\.md$|package\.json$)/u.test(path), `Unexpected package content: ${path}`);
      assert.ok(!/(^|\/)(node_modules|\.env[^/]*|tests?|__tests__)(\/|$)/u.test(path), `Unexpected packed file: ${path}`);
      assert.ok(!/\.(cjs|umd\.js)$/u.test(path), `Unexpected non-ESM output: ${path}`);
    }
    for (const path of files.filter((path) => path.endsWith('.d.ts.map'))) {
      const map = JSON.parse(await readFile(join(packageRoot, path), 'utf8'));
      assert.ok(map.sources.length > 0, `Declaration map must have sources: ${path}`);
      for (const source of map.sources) {
        const sourcePath = resolve(packageRoot, dirname(path), map.sourceRoot ?? '', source);
        const packedPath = relative(packageRoot, sourcePath).replaceAll('\\', '/');
        assert.ok(files.includes(packedPath), `Declaration map points outside packed sources: ${path} → ${source}`);
        assert.ok((await readFile(sourcePath, 'utf8')).length > 0, `Empty mapped source: ${packedPath}`);
      }
    }
    const javascript = files.filter((path) => path.endsWith('.js'));
    assert.ok(javascript.includes('dist/index.js') && javascript.includes('dist/react.js'));
    const publicEntry = await readFile(join(packageRoot, 'dist/index.js'), 'utf8');
    assert.match(publicEntry, /from\s+["']\.\/react\.js["']/u, 'Root React exports must pass through the client boundary');
    assert.doesNotMatch(publicEntry, /from\s+["'](?:react(?:-dom)?(?:\/[^"']*)?|\.\/react\/[^"']*|\.\/react-[^"']*)["']/u, 'Root must not bypass react.js or execute React implementation directly');
    for (const path of javascript) {
      const code = await readFile(join(packageRoot, path), 'utf8');
      if (path === 'dist/react.js') {
        assert.match(code.trimStart(), /^["']use client["'];/u, 'React entrypoint must preserve its client directive');
      } else {
        assert.doesNotMatch(code, /["']use client["']/u, `Client directive leaked into ${path}`);
      }
      // Vite emits no map for empty entries or pure forwarding facades.
      // Only imports/reexports of named bindings are allowed without a map;
      // any executable implementation must retain one for the boundary check.
      if (!files.includes(`${path}.map`)) {
        const implementation = code.trimStart().replace(/^["']use client["'];\s*/u, '')
          .replace(/(?:import\s*\{[^{}]*\}\s*from\s*["'][^"']+["']|export\s*\{[^{}]*\}(?:\s*from\s*["'][^"']+["'])?)\s*;/gu, '').trim();
        assert.equal(implementation, '', `Missing source map for implementation in ${path}`);
        continue;
      }
      const map = JSON.parse(await readFile(join(packageRoot, `${path}.map`), 'utf8'));
      assert.ok(Array.isArray(map.sources), 'Source map must identify its inputs');
      for (const source of map.sources) {
        const sourcePath = resolve(packageRoot, dirname(path), map.sourceRoot ?? '', source);
        const packedSource = relative(packageRoot, sourcePath).replaceAll('\\', '/');
        assert.ok(packedSource.startsWith('src/') && files.includes(packedSource),
          `Only packed Cloudlet source may be bundled into ${path}: ${source}`);
      }
    }

    const internalPaths = [...new Set([
      'react', 'core', 'controller', 'package.json',
      ...files.filter((path) => path.startsWith('dist/')),
    ])].map((path) => `${manifest.name}/${path}`);
    // Both probes install resource traps before any runtime dependency import.
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
    // First test a cold package import and SSR with no browser globals. This
    // includes external React code, so the complete public graph must
    // neither schedule timers nor attach listeners in a normal server environment.
    const serverProbe = `
      import assert from 'node:assert/strict';
      ${resourceTraps}
      for (const resource of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage']) {
        delete globalThis[resource];
      }
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
    execFileSync(process.execPath, ['--input-type=module', '--eval', serverProbe], {
      cwd: directory, encoding: 'utf8', timeout: 20_000,
    });
    const probe = `
      import assert from 'node:assert/strict';
      ${resourceTraps}
      for (const resource of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage']) {
        delete globalThis[resource];
      }
      // React DOM feature-detects browser globals on import. Preload only the
      // external peers with timer/listener traps already active. Then throwing
      // getters enforce Cloudlet's stricter no-DOM-read boundary: Cloudlet has no
      // runtime dependencies (E1), so everything evaluated below is its own code.
      // Every Cloudlet module is still evaluated for the first time below.
      const [{ createElement }, , , { renderToString }] = await Promise.all([
        import('react'), import('react/jsx-runtime'), import('react-dom'), import('react-dom/server'),
      ]);
      assert.deepEqual(resourceCalls, [], 'External dependency preload must not allocate timers or listeners');
      for (const resource of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage']) {
        Object.defineProperty(globalThis, resource, { configurable: true, get: fail(resource) });
      }
      const namespace = await import(${JSON.stringify(manifest.name)});
      assert.deepEqual(Object.keys(namespace), ['CloudletProvider', 'Toaster', 'createCloudlet', 'useCloudlet', 'useOptionalCloudlet'], 'Only implemented public runtime APIs are exported');
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
      for (const specifier of ${JSON.stringify(internalPaths)}) {
        await assert.rejects(import(specifier), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
      }
      assert.deepEqual(resourceCalls, [], 'Cloudlet first import, SSR and unmounted lifecycle must not read DOM or allocate timers/listeners');
      process.stdout.write(JSON.stringify({ runtimeExports: Object.keys(namespace), rejectedDeepImports: ${internalPaths.length} }));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', probe], {
      cwd: directory, encoding: 'utf8', timeout: 20_000,
    }));
    const commonJsProbe = `
      const assert = require('node:assert/strict');
      const resolved = require.resolve(${JSON.stringify(manifest.name)});
      assert.ok(resolved.endsWith('/dist/index.js'), 'CommonJS resolution must reach the ESM root through the default condition');
      const namespace = require(${JSON.stringify(manifest.name)});
      assert.deepEqual(Object.keys(namespace).filter((key) => key !== '__esModule').sort(), ['CloudletProvider', 'Toaster', 'createCloudlet', 'useCloudlet', 'useOptionalCloudlet'], 'require() must expose the same public runtime API');
      assert.equal(typeof namespace.createCloudlet, 'function');
      assert.equal(require.resolve(${JSON.stringify(`${manifest.name}/styles.css`)}).endsWith('/dist/styles.css'), true);
    `;
    execFileSync(process.execPath, ['--input-type=commonjs', '--eval', commonJsProbe], {
      cwd: directory, encoding: 'utf8', timeout: 20_000,
    });
    await copyFile(join(root, 'fixtures/size/package-contracts.ts'), join(directory, 'consumer.ts'));
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
        exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, noEmit: true,
        skipLibCheck: false, lib: ['ES2022', 'DOM'], types: [],
      },
      files: ['consumer.ts'],
    }));
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/lib/tsc.js'), '-p', join(directory, 'tsconfig.json')], {
      cwd: directory, encoding: 'utf8', timeout: 20_000,
    });
    console.log(`Package guards passed: ${files.length} packed files, ESM/CSS exports, peer boundaries, navigable declaration maps, client boundary, cold no-DOM import/SSR, CommonJS require() through the default condition, guarded Cloudlet imports and notification/operation lifecycle, ${result.rejectedDeepImports} rejected deep imports, strict tarball React consumer typecheck.`);
  } finally {
    await fixture.cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flags = process.argv.slice(2);
  assert.ok(flags.length === 0 || (flags.length === 2 && flags[0] === '--tarball'), 'Usage: node scripts/check-package.mjs [--tarball path]');
  await checkPackage(flags[1]);
}
