import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'registry/tooling/package.json'));
const Ajv = require('ajv');
const readJSON = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const itemSchema = await readJSON('registry/schema/registry-item.json');
const catalogSchema = await readJSON('registry/schema/registry.json');
const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addMetaSchema({ ...require('ajv/dist/refs/json-schema-draft-07.json'), $id: 'https://json-schema.org/draft-07/schema#' });
ajv.addSchema(itemSchema, 'https://ui.shadcn.com/schema/registry-item.json');
const validateCatalog = ajv.compile(catalogSchema);
const validateItem = ajv.getSchema('https://ui.shadcn.com/schema/registry-item.json');
const source = await readJSON('registry/registry.json');
const candidate = await readJSON('packages/toast/package.json');
assert(validateCatalog(source), JSON.stringify(validateCatalog.errors));
assert.deepEqual(source.items.map((entry) => entry.name), ['toaster', 'color-picker', 'color-palette']);
assert.deepEqual(source.items[0].dependencies, [`${candidate.name}@${candidate.version}`]);
assert.equal(source.items[1].dependencies, undefined);
// The palette brings the picker through the @cloudlet namespace (the shadcn directory), no npm dependencies.
assert.equal(source.items[2].dependencies, undefined);
assert.deepEqual(source.items[2].registryDependencies, ['@cloudlet/color-picker']);
const result = spawnSync(process.execPath, [resolve(root, 'registry/tooling/node_modules/shadcn/dist/index.js'), 'build', 'registry/registry.json', '--output', 'registry/r'], { cwd: root, stdio: 'inherit' });
assert.equal(result.status, 0, 'shadcn build failed');
const item = await readJSON('registry/r/toaster.json');
assert(validateItem(item), JSON.stringify(validateItem.errors));
assert.equal(item.files.length, 2);
const wrapper = item.files.find((file) => file.path.endsWith('.tsx'));
const css = item.files.find((file) => file.path.endsWith('.css'));
assert(wrapper.content.startsWith('"use client";'));
assert(wrapper.content.includes('import "@cloudlet/toast/styles.css"'));
assert(wrapper.content.includes('import "./toaster.css"'));
assert(!/createCloudlet|packages\/toast|src\/|singleton/.test(wrapper.content));
assert(css.content.includes('var(--popover'));
// Static import and re-export specifiers of a source file (multi-line imports included).
const importsOf = (file) => [...file.content.matchAll(/^(?:import|export) [^'"]*?from ['"]([^'"]+)['"]|^import ['"]([^'"]+)['"]/gm)].map((match) => match[1] ?? match[2]);
const assertImports = (file, allowed) => {
  const specifiers = importsOf(file);
  // No item file reaches for the bridge package: an adapter only mirrors its protocol, so a project
  // without @cloudlet/agent still installs and builds every item.
  assert(!specifiers.some((specifier) => specifier.startsWith('@cloudlet/agent')), `${file.path} imports @cloudlet/agent`);
  assert(specifiers.every((specifier) => allowed.includes(specifier)), `${file.path}: ${specifiers}`);
};
// The color picker ships the site's own files. Its component files may import only React, their
// siblings and lib/spring — not the adapter, so a component that imports it fails the build. The
// adapter may import React, react-dom (flushSync), ./color and types from the component.
const picker = await readJSON('registry/r/color-picker.json');
assert(validateItem(picker), JSON.stringify(validateItem.errors));
assert.deepEqual(picker.files.map((file) => [file.path.split('/').pop(), file.type]), [['color-picker.tsx', 'registry:ui'], ['color-picker.css', 'registry:ui'], ['color.ts', 'registry:ui'], ['morph.ts', 'registry:ui'], ['color-picker-agent.ts', 'registry:ui'], ['spring.ts', 'registry:lib']]);
const component = picker.files[0].content;
assert(component.startsWith("'use client';"));
assert(component.includes("import './color-picker.css';"));
const pickerAdapter = picker.files[4];
assert(pickerAdapter.content.startsWith("'use client';"));
assertImports(pickerAdapter, ['react', 'react-dom', './color', './color-picker']);
for (const file of picker.files.filter((entry) => !entry.path.endsWith('.css') && entry !== pickerAdapter)) {
  assertImports(file, ['react', '@/lib/spring', './color', './morph', './color-picker.css']);
}
assert(picker.files[1].content.includes('var(--ring'));
// The palette: its component, stylesheet and adapter. The component may import React, the picker's
// modules, lib/spring and its CSS, not its adapter; the adapter may import React, the picker's adapter
// and color module, and types from the palette.
const palette = await readJSON('registry/r/color-palette.json');
assert(validateItem(palette), JSON.stringify(validateItem.errors));
assert.deepEqual(palette.files.map((file) => [file.path.split('/').pop(), file.type]), [['color-palette.tsx', 'registry:ui'], ['color-palette.css', 'registry:ui'], ['color-palette-agent.ts', 'registry:ui']]);
assert.deepEqual(palette.registryDependencies, ['@cloudlet/color-picker']);
const paletteComponent = palette.files[0].content;
assert(paletteComponent.startsWith("'use client';"));
assert(paletteComponent.includes("import './color-palette.css';"));
assertImports(palette.files[0], ['react', '@/lib/spring', '@/components/ui/color-picker/color-picker', '@/components/ui/color-picker/color', '@/components/ui/color-picker/morph', './color-palette.css']);
const paletteAdapter = palette.files[2];
assert(paletteAdapter.content.startsWith("'use client';"));
assertImports(paletteAdapter, ['react', '@/components/ui/color-picker/color-picker-agent', '@/components/ui/color-picker/color', './color-palette']);
assert(palette.files[1].content.includes('var(--ring'));
// The catalog lists items without their source: the CLI reads `content` from `/r/<item>.json`, and the
// shadcn registry index rejects a catalog whose files carry `content`.
const catalog = { ...source, items: [item, picker, palette].map((entry) => ({ ...entry, files: entry.files.map(({ content, ...file }) => file) })) };
assert(validateCatalog(catalog), JSON.stringify(validateCatalog.errors));
assert(catalog.items.every((entry) => entry.files.every((file) => !('content' in file))));
await writeFile(resolve(root, 'registry/r/registry.json'), JSON.stringify(catalog, null, 2) + '\n');
// The site serves the built catalog at `/r/*.json`; tests/unit/site-registry.test.ts keeps the copies equal.
await mkdir(resolve(root, 'apps/site/public/r'), { recursive: true });
for (const name of ['registry.json', 'toaster.json', 'color-picker.json', 'color-palette.json']) await copyFile(resolve(root, `registry/r/${name}`), resolve(root, `apps/site/public/r/${name}`));
const evidence = {
  date: '2026-10-16',
  shadcn: (await readJSON('registry/tooling/node_modules/shadcn/package.json')).version,
  ajv: require('ajv/package.json').version,
  schemas: Object.fromEntries(await Promise.all(['registry', 'registry-item'].map(async (name) => [
    `https://ui.shadcn.com/schema/${name}.json`,
    createHash('sha256').update(await readFile(resolve(root, `registry/schema/${name}.json`))).digest('hex'),
  ]))),
  checks: { officialCatalogSchema: 'passed', officialItemSchema: 'passed', shadcnBuild: 'passed', clientDirective: 'passed', publicRuntimeOnly: 'passed', explicitCssImports: 'passed', colorPickerFiles: 'passed', colorPickerImports: 'passed', colorPaletteFiles: 'passed', colorPaletteImports: 'passed', colorPickerAdapterImports: 'passed', colorPaletteAdapterImports: 'passed', noAgentPackageImports: 'passed' },
};
await mkdir(resolve(root, 'artifacts/integration/registry'), { recursive: true });
await writeFile(resolve(root, 'artifacts/integration/registry/build.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
