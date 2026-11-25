// Size of the color picker registry item (spec §3, C06): the component with its color math,
// morph and lib/spring, React external, minified like scripts/measure-size.mjs, gzip level 9 per file.
// Informational: the ~4 KB figure in the spec is a guide, not a gate.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'apps/site/src');
const browserTarget = ['chrome111', 'edge111', 'firefox114', 'safari16.4', 'ios16.4'];
const gzipBytes = (source) => gzipSync(source, { level: 9, mtime: 0 }).byteLength;

const result = await build({
  configFile: false,
  root,
  mode: 'production',
  logLevel: 'warn',
  resolve: { alias: { '@': site } },
  build: {
    target: browserTarget,
    minify: 'oxc',
    cssMinify: 'lightningcss',
    sourcemap: false,
    write: false,
    reportCompressedSize: false,
    lib: { entry: join(site, 'components/ui/color-picker/color-picker.tsx'), formats: ['es'], fileName: () => 'color-picker.js', cssFileName: 'color-picker' },
    rolldownOptions: {
      external: (id) => /^(?:react|react-dom)(?:\/|$)/u.test(id),
      onwarn(warning, defaultHandler) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')) return;
        defaultHandler(warning);
      },
      output: { minify: { codegen: true }, comments: false },
    },
  },
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output);
const files = outputs.filter((output) => output.type === 'chunk' || output.fileName.endsWith('.css')).map((output) => {
  const data = Buffer.from(output.type === 'chunk' ? output.code : output.source);
  return { file: output.fileName, kind: output.type === 'chunk' ? 'js' : 'css', bytes: data.byteLength, gzipBytes: gzipBytes(data) };
});
// Each module's share of the bundle before minification, to see where the bytes go.
const modules = Object.fromEntries(outputs.filter((output) => output.type === 'chunk').flatMap((chunk) => Object.entries(chunk.modules))
  .map(([id, module]) => [id.replace(`${root}/`, ''), module.renderedLength]).filter(([, length]) => length > 0));
const sum = (kind, key) => files.filter((file) => file.kind === kind).reduce((total, file) => total + file[key], 0);
const report = {
  date: new Date().toISOString().slice(0, 10),
  methodology: { input: 'apps/site/src/components/ui/color-picker (all exports) + lib/spring', external: 'react, react-dom', target: browserTarget, jsMinifier: 'oxc', cssMinifier: 'lightningcss', compression: 'gzip-level-9-per-file' },
  files,
  jsGzipBytes: sum('js', 'gzipBytes'),
  cssGzipBytes: sum('css', 'gzipBytes'),
  totalGzipBytes: sum('js', 'gzipBytes') + sum('css', 'gzipBytes'),
  guideBytes: 4 * 1024,
  renderedBytesByModule: modules,
};
assert(report.jsGzipBytes > 0 && report.cssGzipBytes > 0, 'Both the component and its CSS must survive bundling');
await mkdir(join(root, 'artifacts/size'), { recursive: true });
await writeFile(join(root, 'artifacts/size/color-picker.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
