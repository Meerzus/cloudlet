import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The site's documentation pages (DOCS.md §3): every ```ts / ```tsx fence of content/docs is checked too. */
const DOCS_CONTENT = 'apps/site/content/docs';
const mdxPages = (await readdir(resolve(root, DOCS_CONTENT), { recursive: true }))
  .filter((entry) => entry.endsWith('.mdx'))
  .map((entry) => `${DOCS_CONTENT}/${entry.replaceAll('\\', '/')}`)
  .sort();
// The root README carries no code (DOCS.md §3): it points to the package README and the site.
const documents = ['packages/toast/README.md', 'registry/README.md', ...mdxPages];
const output = resolve(root, 'artifacts/docs-examples');
assert.equal(process.argv.length, 2, 'Usage: node scripts/check-doc-examples.mjs');
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(resolve(output, 'compile-'));
const examples = [];
const sourceHashes = {};

/** Read fenced source verbatim rather than maintaining another copy of an example. */
function extractExamples(markdown, document) {
  const lines = markdown.split('\n');
  const result = [];
  let fence;
  for (const [index, line] of lines.entries()) {
    if (!fence) {
      const start = /^ {0,3}(`{3,}|~{3,})\s*(\S*)(.*)$/u.exec(line);
      if (start) fence = { marker: start[1], language: start[2].toLowerCase(), meta: start[3], line: index + 1, source: [] };
      continue;
    }
    const end = new RegExp(`^ {0,3}${fence.marker[0]}{${fence.marker.length},}\\s*$`, 'u');
    if (end.test(line)) {
      if (['ts', 'tsx', 'typescript'].includes(fence.language)) result.push({
        document, line: fence.line + 1, language: fence.language, meta: fence.meta, source: fence.source.join('\n') + '\n',
      });
      fence = undefined;
    } else fence.source.push(line);
  }
  assert.equal(fence, undefined, `Unclosed Markdown fence in ${document}`);
  // A README section without a TypeScript example is a mistake; a documentation page may be prose only.
  if (!document.endsWith('.mdx')) assert.ok(result.length, `No TypeScript examples found in ${document}`);
  return result;
}

/**
 * A documentation page's fences with `title="path"` are files of one project: each is written at
 * its path in the page's own directory, so `import … from '../components/owner'` between them
 * resolves. A repeated title (a later version of the same file) is written next to the first one
 * as `name.2.tsx`, keeping its relative imports. Fences without a `.ts`/`.tsx` title stay standalone.
 */
function titledPath(example, used) {
  const title = /(?:^|\s)title="([^"]+)"/u.exec(example.meta)?.[1];
  if (!example.document.endsWith('.mdx') || !title || !/\.tsx?$/u.test(title)) return undefined;
  assert.ok(!title.startsWith('/') && !title.split('/').includes('..'), `Fence title must be a relative path: ${example.document}:${example.line}`);
  const count = (used.get(title) ?? 0) + 1;
  used.set(title, count);
  return count === 1 ? title : title.replace(/\.tsx?$/u, (extension) => `.${count}${extension}`);
}

try {
  for (const [documentIndex, document] of documents.entries()) {
    const markdown = await readFile(resolve(root, document), 'utf8');
    sourceHashes[document] = createHash('sha256').update(markdown).digest('hex');
    const titles = new Map();
    for (const example of extractExamples(markdown, document)) {
      // A runnable documentation example (DOCS.md §6, `demo="<id>"`) is a demo catalog
      // snippet, which assumes `const cloudlet = useCloudlet();` as the page says above it.
      // Only supply that context; the fenced snippet stays unchanged.
      const scaffold = document.endsWith('.mdx') && /(?:^|\s)demo="[^"]+"/u.test(example.meta)
        ? "import { createCloudlet } from '@cloudlet/toast';\nconst cloudlet = createCloudlet();\n"
        : '';
      const titled = titledPath(example, titles);
      const filename = titled
        ? `${documentIndex + 1}-${document.replaceAll('/', '-')}/${titled}`
        : `${examples.length + 1}-${document.replaceAll('/', '-')}.${example.language === 'tsx' ? 'tsx' : 'ts'}`;
      await mkdir(dirname(resolve(temporary, filename)), { recursive: true });
      await writeFile(resolve(temporary, filename), scaffold + example.source);
      examples.push({ ...example, filename, scaffold });
    }
  }
  const config = {
    extends: resolve(root, 'tsconfig.base.json'),
    compilerOptions: {
      noEmit: true,
      types: ['react', 'react-dom', 'next'],
      lib: ['ES2024', 'DOM', 'DOM.Iterable'],
      moduleDetection: 'force',
      // A documentation fragment may demonstrate a returned local value without
      // consuming it; retain all strict API/type checks from the project config.
      noUnusedLocals: false,
      noUnusedParameters: false,
      paths: {
        '@cloudlet/toast': [resolve(root, 'packages/toast/src/index.ts')],
        '@/components/ui/toaster': [resolve(root, 'registry/cloudlet/toaster.tsx')],
      },
    },
    files: examples.map(example => `./${example.filename}`),
  };
  const configPath = resolve(temporary, 'tsconfig.json');
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  const checked = spawnSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '--project', configPath, '--pretty', 'false'], {
    cwd: root, encoding: 'utf8',
  });
  const diagnostics = `${checked.stdout ?? ''}${checked.stderr ?? ''}`;
  if (diagnostics) process.stdout.write(diagnostics);
  const evidence = {
    status: checked.status === 0 && !checked.error ? 'passed' : 'failed',
    node: process.version,
    typescript: JSON.parse(await readFile(resolve(root, 'node_modules/typescript/package.json'), 'utf8')).version,
    sourceHashes,
    examples: examples.map(({ document, line, language, source, scaffold }) => ({
      document, line, language,
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      scaffold: scaffold || null,
    })),
    resolution: 'Current public source entry and actual application-owned registry wrapper; no build or runtime execution',
    diagnostics,
  };
  await writeFile(resolve(output, 'check.json'), JSON.stringify(evidence, null, 2) + '\n');
  assert.ifError(checked.error);
  assert.equal(checked.status, 0, 'Documentation TypeScript examples failed to compile');
  console.log(`Documentation examples: ${examples.length} passed from ${documents.length} files (TypeScript ${evidence.typescript}); evidence: artifacts/docs-examples/check.json`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
