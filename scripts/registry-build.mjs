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
assert.deepEqual(source.items.map((entry) => entry.name), ['toaster', 'color-picker']);
assert.deepEqual(source.items[0].dependencies, [`${candidate.name}@${candidate.version}`]);
assert.equal(source.items[1].dependencies, undefined);
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
// The color picker ships the site's own files; it may import only React, its siblings and lib/spring.
const picker = await readJSON('registry/r/color-picker.json');
assert(validateItem(picker), JSON.stringify(validateItem.errors));
assert.deepEqual(picker.files.map((file) => [file.path.split('/').pop(), file.type]), [['color-picker.tsx', 'registry:ui'], ['color-picker.css', 'registry:ui'], ['color.ts', 'registry:ui'], ['morph.ts', 'registry:ui'], ['spring.ts', 'registry:lib']]);
const component = picker.files[0].content;
assert(component.startsWith("'use client';"));
assert(component.includes("import './color-picker.css';"));
for (const file of picker.files.filter((entry) => !entry.path.endsWith('.css'))) {
  const specifiers = [...file.content.matchAll(/^import [^'"]*['"]([^'"]+)['"]/gm)].map((match) => match[1]);
  assert(specifiers.every((specifier) => ['react', '@/lib/spring', './color', './morph', './color-picker.css'].includes(specifier)), `${file.path}: ${specifiers}`);
}
assert(picker.files[1].content.includes('var(--ring'));
// The catalog lists items without their source: the CLI reads `content` from `/r/<item>.json`, and the
// shadcn registry index rejects a catalog whose files carry `content`.
const catalog = { ...source, items: [item, picker].map((entry) => ({ ...entry, files: entry.files.map(({ content, ...file }) => file) })) };
assert(validateCatalog(catalog), JSON.stringify(validateCatalog.errors));
assert(catalog.items.every((entry) => entry.files.every((file) => !('content' in file))));
await writeFile(resolve(root, 'registry/r/registry.json'), JSON.stringify(catalog, null, 2) + '\n');
// The site serves the built catalog at `/r/*.json`; tests/unit/site-registry.test.ts keeps the copies equal.
await mkdir(resolve(root, 'apps/site/public/r'), { recursive: true });
for (const name of ['registry.json', 'toaster.json', 'color-picker.json']) await copyFile(resolve(root, `registry/r/${name}`), resolve(root, `apps/site/public/r/${name}`));
const evidence = {
  date: '2026-10-16',
  shadcn: (await readJSON('registry/tooling/node_modules/shadcn/package.json')).version,
  ajv: require('ajv/package.json').version,
  schemas: Object.fromEntries(await Promise.all(['registry', 'registry-item'].map(async (name) => [
    `https://ui.shadcn.com/schema/${name}.json`,
    createHash('sha256').update(await readFile(resolve(root, `registry/schema/${name}.json`))).digest('hex'),
  ]))),
  checks: { officialCatalogSchema: 'passed', officialItemSchema: 'passed', shadcnBuild: 'passed', clientDirective: 'passed', publicRuntimeOnly: 'passed', explicitCssImports: 'passed', colorPickerFiles: 'passed', colorPickerImports: 'passed' },
};
await mkdir(resolve(root, 'artifacts/integration/registry'), { recursive: true });
await writeFile(resolve(root, 'artifacts/integration/registry/build.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
