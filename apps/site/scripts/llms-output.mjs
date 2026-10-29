#!/usr/bin/env node
/**
 * After `next build`: moves the Markdown of each page from `out/llms.mdx/` to its
 * address next to the page (`out/toaster/docs.md`, `out/toaster/docs/<slug>.md`) — a route handler cannot live
 * beside the `/docs/[[...slug]]` pages — and checks the output for agents: every page of
 * `content/docs/en` has its `.md`, is listed in `llms.txt` and is in `llms-full.txt`; no runnable
 * meta, MDX component or placeholder is left. Styling explains the live editor and its URL
 * parameters in both Markdown outputs. Exits 1 with the list of problems.
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = join(SITE, 'out');
const STAGING = join(OUT, 'llms.mdx');
const CONTENT = join(SITE, 'content/docs/en');
const SITE_URL = /export const SITE_URL = '([^']+)'/u.exec(readFileSync(join(SITE, 'src/lib/site.ts'), 'utf8'))?.[1];
/** `/toaster/docs`, as `src/lib/site.ts` builds it (TOASTER_PATH + '/docs'). */
const DOCS_PATH = `${/export const TOASTER_PATH = '([^']+)'/u.exec(readFileSync(join(SITE, 'src/lib/site.ts'), 'utf8'))?.[1]}/docs`;

const problems = [];
if (!existsSync(STAGING)) {
  console.error(`llms-output: ${relative(SITE, STAGING)} is missing — run next build first`);
  process.exit(1);
}
cpSync(STAGING, OUT, { recursive: true });
rmSync(STAGING, { recursive: true, force: true });

/** Page URLs from the content folder: `index.mdx` → `/toaster/docs`, `api/toaster.mdx` → `/toaster/docs/api/toaster`. */
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
  [/<(Callout|GetStartedTabs|GetStartedCode|StyleEditor)\b/u, 'MDX component'],
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

const editorDescription = `Style editor at ${SITE_URL}${DOCS_PATH}/styling#style-editor: set the tokens on a live Toaster and copy the CSS. The query string carries the values — one parameter per token name without the \`--cloudlet-\` prefix (\`background\`, \`background-dark\`, \`pill-radius\`, \`font-family\`, …); dark-theme colors use the \`-dark\` suffix, and the preview follows the site theme.`;
for (const [file, markdown] of [[`${DOCS_PATH.slice(1)}/styling.md`, read(`${DOCS_PATH.slice(1)}/styling.md`)], ['llms-full.txt', full]]) {
  if (!markdown.includes(editorDescription)) problems.push(`${file}: Style editor description or URL parameter contract is missing`);
}
const stylingEntry = index.split('\n').find((line) => line.includes(`](${SITE_URL}${DOCS_PATH}/styling.md)`));
if (!stylingEntry?.includes('Style editor')) problems.push('llms.txt: Styling description does not mention the Style editor');

if (problems.length) {
  console.error(`llms-output: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`llms-output: ${urls.length} pages as Markdown, llms.txt and llms-full.txt (${Math.round(full.length / 1024)} KB)`);
