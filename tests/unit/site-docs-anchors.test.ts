import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every link to a section of a component's docs page — the Toaster's pages, the color picker's and
 * the color palette's — lands on a heading of that page. A rewrite that
 * renames or drops a heading breaks links from other pages, the package README, the registry and
 * the site's code; this finds them before a reader does. Ids follow the docs' heading slugs:
 * lowercase, punctuation dropped, spaces as hyphens, a repeated heading gets `-1`, `-2`, ….
 */
const ROOT = new URL('../../', import.meta.url);
const CONTENT = new URL('apps/site/content/docs/en/', ROOT);
const SOURCES = ['apps/site/content/docs/en', 'apps/site/src', 'registry', 'packages/toast/README.md'];
const TEXT = /\.(?:mdx?|tsx?|json)$/u;
const LINK = /\/docs\/components\/(toaster|color-picker|color-palette)((?:\/[a-z0-9-]+)*)#([a-z0-9-]+)/gu;
/** A component with pages under it keeps its own page in `index.mdx`; a simple one is a single file. */
const pageOf = (component: string, rest: string) => (component === 'toaster' ? `components/toaster${rest || '/index'}` : `components/${component}${rest}`);

function files(path: string): string[] {
  const url = new URL(path, ROOT);
  if (!statSync(url).isDirectory()) return [path];
  return readdirSync(url, { recursive: true, encoding: 'utf8' })
    .map((entry) => `${path}/${entry.replaceAll('\\', '/')}`)
    .filter((entry) => TEXT.test(entry) && !entry.includes('node_modules') && statSync(new URL(entry, ROOT)).isFile());
}

function slug(heading: string) {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/gu, '-');
}

/** Heading ids of a page, outside fenced code. */
function ids(page: string) {
  const text = readFileSync(new URL(`${page}.mdx`, CONTENT), 'utf8');
  const seen = new Map<string, number>();
  const result = new Set<string>();
  // The fence that opened the current code block: only one of the same character, at least as long
  // and with nothing after it closes the block, so a shorter or a tilde fence inside stays code.
  let open: string | null = null;
  for (const line of text.split('\n')) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (open !== null) {
      if (fence && fence[1]?.[0] === open[0] && (fence[1]?.length ?? 0) >= open.length && fence[2]?.trim() === '') open = null;
      continue;
    }
    if (fence) {
      open = fence[1] ?? null;
      continue;
    }
    const heading = /^#{2,6} (.+)$/u.exec(line);
    if (!heading) continue;
    const base = slug(heading[1] ?? '');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.add(count ? `${base}-${count}` : base);
  }
  return result;
}

describe('site docs anchors', () => {
  it('sends every link to a section of a component page to a heading that exists', () => {
    const cache = new Map<string, Set<string>>();
    const broken: string[] = [];
    let links = 0;
    const byComponent = new Map<string, number>();
    for (const file of SOURCES.flatMap(files)) {
      const text = readFileSync(new URL(file, ROOT), 'utf8');
      for (const match of text.matchAll(LINK)) {
        const page = pageOf(match[1] ?? '', match[2] ?? '');
        if (!cache.has(page)) cache.set(page, existsSync(new URL(`${page}.mdx`, CONTENT)) ? ids(page) : new Set());
        links++;
        byComponent.set(match[1] ?? '', (byComponent.get(match[1] ?? '') ?? 0) + 1);
        if (!cache.get(page)?.has(match[3] ?? '')) broken.push(`${file}: ${match[0]}`);
      }
    }
    expect(links).toBeGreaterThan(50);
    // The palette's page leans on the color picker's reference: installation, formats, keys, labels.
    expect(byComponent.get('color-picker')).toBeGreaterThanOrEqual(4);
    expect(broken).toEqual([]);
  });

  it('keeps the Preview heading the Markdown for agents names on every component page', () => {
    // docs-markdown.ts builds `<page>#preview` from the constants of site.ts, which the link search above cannot see.
    for (const page of ['components/toaster/index', 'components/color-picker', 'components/color-palette']) expect(ids(page), page).toContain('preview');
    const markdown = readFileSync(new URL('apps/site/src/lib/docs-markdown.ts', ROOT), 'utf8');
    expect(markdown.match(/_DOCS_PATH\}#([a-z-]+)/gu)?.map((match) => match.split('#')[1])).toEqual(['preview', 'preview', 'preview']);
  });

  it('sends every in-page link of a component page to one of its headings', () => {
    const broken: string[] = [];
    const pages = readdirSync(new URL('components/toaster/', CONTENT), { recursive: true, encoding: 'utf8' })
      .filter((entry) => entry.endsWith('.mdx'))
      .map((entry) => `components/toaster/${entry.replaceAll('\\', '/').replace(/\.mdx$/u, '')}`)
      .concat(['components/color-picker', 'components/color-palette']);
    for (const page of pages) {
      const own = ids(page);
      const text = readFileSync(new URL(`${page}.mdx`, CONTENT), 'utf8');
      for (const match of text.matchAll(/\]\(#([a-z0-9-]+)\)/gu)) {
        if (!own.has(match[1] ?? '')) broken.push(`${page}: #${match[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
