import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { checkCoverage, codeText, exportedNames, undocumented } from '../../scripts/check-doc-coverage.mjs';

const script = resolve(import.meta.dirname, '../../scripts/check-doc-coverage.mjs');

/** A package entry shaped like the real one: values, an explicit type list and `export type *`. */
async function fixture(page) {
  const directory = await mkdtemp(join(tmpdir(), 'cloudlet-doc-coverage-'));
  await mkdir(join(directory, 'src/contracts'), { recursive: true });
  await mkdir(join(directory, 'docs/api'), { recursive: true });
  await writeFile(join(directory, 'src/index.ts'), [
    "export { createThing } from './thing.js';",
    "export type * from './contracts/things.js';",
    'export type {',
    '  ThingProps,',
    '  Renamed as PublicName,',
    "} from './thing.js';",
  ].join('\n'));
  await writeFile(join(directory, 'src/thing.ts'), [
    '/** export const Hidden = 1; is a comment, not an export */',
    'export function createThing() {}',
    'export interface ThingProps { readonly size?: number }',
    'export type Renamed = string;',
    'export type NotReexported = number;',
  ].join('\n'));
  await writeFile(join(directory, 'src/contracts/things.ts'), [
    "export type * from './nested.js';",
    "export type ThingKind = 'a' | 'b';",
    'export interface Description { readonly text: string }',
  ].join('\n'));
  await writeFile(join(directory, 'src/contracts/nested.ts'), 'export type NestedToken = string & { readonly brand: never };\n');
  await writeFile(join(directory, 'docs/api/page.mdx'), page);
  return directory;
}

test('collects values, explicit type lists, aliases and nested export type *', async () => {
  const directory = await fixture('');
  try {
    assert.deepEqual(await exportedNames(join(directory, 'src/index.ts')),
      ['Description', 'NestedToken', 'PublicName', 'ThingKind', 'ThingProps', 'createThing']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('counts a name only inside code and only as a whole word', () => {
  const page = [
    '| Prop | Type | Default | Description |',
    '| `size` | `number` | — | The ``ThingKind`` of it, see `DescriptionList`. |',
    '```ts',
    'const token: NestedToken = make();',
    '```',
  ].join('\n');
  assert.match(codeText(page), /NestedToken/u);
  assert.deepEqual(undocumented(['Description', 'ThingKind', 'NestedToken', 'size'], [page]), ['Description']);
});

test('fails with the list of exports the documentation does not mention', async () => {
  // Everything documented except one export added to the entry and one only named in prose.
  const directory = await fixture('Use `createThing` with `ThingProps`, `PublicName`, `ThingKind` and `NestedToken`. Description in prose.\n');
  try {
    const result = await checkCoverage(join(directory, 'src/index.ts'), join(directory, 'docs'));
    assert.deepEqual(result, { names: 6, files: 1, missing: ['Description'] });
    const run = spawnSync(process.execPath, [script, join(directory, 'src/index.ts'), join(directory, 'docs')], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /1 of 6 exports .* not mentioned/u);
    assert.match(run.stderr, /^ {2}Description$/mu);

    await writeFile(join(directory, 'docs/api/types.mdx'), '`Description`\n');
    const passed = spawnSync(process.execPath, [script, join(directory, 'src/index.ts'), join(directory, 'docs')], { encoding: 'utf8' });
    assert.equal(passed.status, 0, passed.stderr);
    assert.match(passed.stdout, /all 6 exports .* documented in 2 pages/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
