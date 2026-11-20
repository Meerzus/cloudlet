#!/usr/bin/env node
/**
 * After `next build`: moves the Markdown of each page from `out/llms.mdx/` to its
 * address next to the page (`out/docs.md`, `out/docs/<slug>.md`) — a route handler cannot live
 * beside the `/docs/[[...slug]]` pages — and checks the output for agents: every page of
 * `content/docs/en` has its `.md`, is listed in `llms.txt` and is in `llms-full.txt`; no runnable
 * meta, MDX component or placeholder is left. Styling explains the live editor and its URL
 * parameters in both Markdown outputs. A live example (`<Example>`) is the code of its file. The Examples of the Toaster's page write a snippet a guide
 * already shows as a line linking to a heading of that guide, whose Markdown has the code, and
 * every other snippet as code. Exits 1 with the list of problems.
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = join(SITE, 'out');
const STAGING = join(OUT, 'llms.mdx');
const CONTENT = join(SITE, 'content/docs/en');
const SITE_TS = readFileSync(join(SITE, 'src/lib/site.ts'), 'utf8');
const SITE_URL = /export const SITE_URL = '([^']+)'/u.exec(SITE_TS)?.[1];
/** `/docs`, as `src/lib/site.ts` has it. */
const DOCS_PATH = /export const DOCS_PATH = '([^']+)'/u.exec(SITE_TS)?.[1];
/** The Toaster's page in the docs (DOCS_PATH + '/components/toaster'), where Styling lives. */
const TOASTER_DOCS_PATH = `${DOCS_PATH}/components/toaster`;

const problems = [];
if (!existsSync(STAGING)) {
  console.error(`llms-output: ${relative(SITE, STAGING)} is missing — run next build first`);
  process.exit(1);
}
cpSync(STAGING, OUT, { recursive: true });
rmSync(STAGING, { recursive: true, force: true });

/** Page URLs from the content folder: `index.mdx` → `/docs`, `components/toaster/api/toaster.mdx` → `/docs/components/toaster/api/toaster`. */
function pageUrls(dir, prefix = DOCS_PATH) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return pageUrls(join(dir, entry.name), `${prefix}/${entry.name}`);
    if (!entry.name.endsWith('.mdx')) return [];
    const name = entry.name.slice(0, -'.mdx'.length);
    return [name === 'index' ? prefix : `${prefix}/${name}`];
  });
}

const read = (file) => (existsSync(join(OUT, file)) ? readFileSync(join(OUT, file), 'utf8') : (problems.push(`${file} is missing`), ''));
const index = read('llms.txt');
const full = read('llms-full.txt');
const LEFTOVERS = [
  [/demo="|demo-note/u, 'runnable meta'],
  [/\0/u, 'placeholder'],
  [/<(Callout|GetStartedTabs|GetStartedCode|Demos|Example|StyleEditor|PickerPreview|PalettePreview|InstallCommand|ToasterPreview)\b/u, 'MDX component'],
];
const urls = pageUrls(CONTENT);
for (const url of urls) {
  const markdown = read(`${url.slice(1)}.md`);
  if (!markdown) continue;
  const title = /^# (.+)$/mu.exec(markdown)?.[1];
  if (!title || !markdown.startsWith(`# ${title}\n`)) problems.push(`${url}.md does not start with its title`);
  if (!markdown.includes(`Source: ${SITE_URL}${url}\n`)) problems.push(`${url}.md has no source link`);
  if (!index.includes(`](${SITE_URL}${url}.md)`)) problems.push(`llms.txt does not link ${url}.md`);
  if (title && !full.includes(`# ${title}\n`)) problems.push(`llms-full.txt has no page "${title}"`);
  for (const [pattern, what] of LEFTOVERS) if (pattern.test(markdown)) problems.push(`${url}.md: ${what} left`);
}
for (const [pattern, what] of LEFTOVERS) if (pattern.test(full)) problems.push(`llms-full.txt: ${what} left`);
// Crawlers get the same pages as agents: every documented page is in the sitemap.
const sitemap = read('sitemap.xml');
for (const url of urls) if (!sitemap.includes(`<loc>${SITE_URL}${url}</loc>`)) problems.push(`sitemap.xml does not list ${url}`);

const editorDescription = `Style editor at ${SITE_URL}${TOASTER_DOCS_PATH}/styling#style-editor: set the tokens on a live Toaster and copy the CSS. The query string carries the values — one parameter per token name without the \`--cloudlet-\` prefix (\`background\`, \`background-dark\`, \`pill-radius\`, \`font-family\`, …); dark-theme colors use the \`-dark\` suffix, and the preview follows the site theme.`;
for (const [file, markdown] of [[`${TOASTER_DOCS_PATH.slice(1)}/styling.md`, read(`${TOASTER_DOCS_PATH.slice(1)}/styling.md`)], ['llms-full.txt', full]]) {
  if (!markdown.includes(editorDescription)) problems.push(`${file}: Style editor description or URL parameter contract is missing`);
}
const stylingEntry = index.split('\n').find((line) => line.includes(`](${SITE_URL}${TOASTER_DOCS_PATH}/styling.md)`));
if (!stylingEntry?.includes('Style editor')) problems.push('llms.txt: Styling description does not mention the Style editor');

// Live examples: every `<Example name="…" />` of a page is the code of its file in the page's Markdown and in llms-full.txt.
const mdxFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? mdxFiles(join(dir, entry.name)) : entry.name.endsWith('.mdx') ? [join(dir, entry.name)] : []));
for (const file of mdxFiles(CONTENT)) {
  const slug = relative(CONTENT, file).slice(0, -'.mdx'.length).replace(/(^|\/)index$/u, '');
  const page = `${DOCS_PATH.slice(1)}${slug ? `/${slug}` : ''}.md`;
  for (const [, name] of readFileSync(file, 'utf8').matchAll(/^<Example name="([^"]+)" \/>$/gmu)) {
    const source = join(SITE, 'src/components/docs/examples', `${name}.tsx`);
    const code = existsSync(source) ? readFileSync(source, 'utf8').trimEnd() : null;
    if (code === null) problems.push(`${page}: example "${name}" has no file`);
    else for (const [where, markdown] of [[page, read(page)], ['llms-full.txt', full]]) {
      if (!markdown.includes(`\`\`\`tsx title="${name.split('/').pop()}.tsx"\n${code}\n\`\`\``)) problems.push(`${where}: the code of example "${name}" is missing`);
    }
  }
}

// Examples in the Markdown: a snippet once. Fences of the MDX, by demo id, page by page.
const demoFences = (mdx) => [...mdx.matchAll(/^```\S* [^\n]*demo="([^"]+)"[^\n]*\n([\s\S]*?)\n```$/gmu)].map((match) => ({ id: match[1], code: match[2] }));
const TOASTER_CONTENT = join(CONTENT, 'components/toaster');
const guideDemos = new Map(
  readdirSync(TOASTER_CONTENT).filter((entry) => entry.endsWith('.mdx') && entry !== 'index.mdx')
    .flatMap((entry) => demoFences(readFileSync(join(TOASTER_CONTENT, entry), 'utf8')).map((demo) => [demo.id, entry.slice(0, -'.mdx'.length)])),
);
const componentMarkdown = read(`${TOASTER_DOCS_PATH.slice(1)}.md`);
let folded = 0;
for (const { id, code } of demoFences(readFileSync(join(TOASTER_CONTENT, 'index.mdx'), 'utf8'))) {
  const guide = guideDemos.get(id);
  if (!guide) {
    if (!componentMarkdown.includes(`\`\`\`tsx\n${code}\n\`\`\``)) problems.push(`${TOASTER_DOCS_PATH}.md: Examples lost the code of "${id}", which no guide shows`);
    continue;
  }
  folded += 1;
  const line = componentMarkdown.split('\n').find((text) => text.startsWith(`- \`${id}\``));
  const anchor = line && new RegExp(`\\]\\(${SITE_URL}${TOASTER_DOCS_PATH}/${guide}#([a-z0-9-]+)\\)`, 'u').exec(line)?.[1];
  if (!anchor) problems.push(`${TOASTER_DOCS_PATH}.md: Examples has no line for "${id}" linking to a section of ${guide}`);
  else if (!read(`${TOASTER_DOCS_PATH.slice(1)}/${guide}.html`).includes(`id="${anchor}"`)) problems.push(`${TOASTER_DOCS_PATH}.md: "${id}" links to #${anchor}, which ${guide} does not have`);
  if (componentMarkdown.includes(code)) problems.push(`${TOASTER_DOCS_PATH}.md: Examples repeats the code of "${id}" from ${guide}`);
  if (!read(`${TOASTER_DOCS_PATH.slice(1)}/${guide}.md`).includes(code)) problems.push(`${TOASTER_DOCS_PATH}/${guide}.md: the code of "${id}" is missing`);
}
if (!folded) problems.push(`${TOASTER_DOCS_PATH}.md: no Examples snippet is folded into a guide link`);

if (problems.length) {
  console.error(`llms-output: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`llms-output: ${urls.length} pages as Markdown, llms.txt and llms-full.txt (${Math.round(full.length / 1024)} KB)`);
