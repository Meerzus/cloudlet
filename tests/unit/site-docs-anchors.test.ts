import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every link to a section of a Toaster docs page lands on a heading of that page. A rewrite that
 * renames or drops a heading breaks links from other pages, the package README, the registry and
 * the site's code; this finds them before a reader does. Ids follow the docs' heading slugs:
 * lowercase, punctuation dropped, spaces as hyphens, a repeated heading gets `-1`, `-2`, ….
 */
const ROOT = new URL('../../', import.meta.url);
const CONTENT = new URL('apps/site/content/docs/en/', ROOT);
const SOURCES = ['apps/site/content/docs/en', 'apps/site/src', 'registry', 'packages/toast/README.md'];
const TEXT = /\.(?:mdx?|tsx?|json)$/u;
const LINK = /\/docs\/components\/toaster((?:\/[a-z0-9-]+)*)#([a-z0-9-]+)/gu;

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
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/u.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^#{2,6} (.+)$/u.exec(line);
    if (!heading) continue;
    const base = slug(heading[1] ?? '');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.add(count ? `${base}-${count}` : base);
  }
  return result;
}

describe('site docs anchors', () => {
  it('sends every link to a Toaster section to a heading that exists', () => {
    const cache = new Map<string, Set<string>>();
    const broken: string[] = [];
    let links = 0;
    for (const file of SOURCES.flatMap(files)) {
      const text = readFileSync(new URL(file, ROOT), 'utf8');
      for (const match of text.matchAll(LINK)) {
        const page = `components/toaster${match[1] ? match[1] : '/index'}`;
        if (!cache.has(page)) cache.set(page, ids(page));
        links++;
        if (!cache.get(page)?.has(match[2] ?? '')) broken.push(`${file}: ${match[0]}`);
      }
    }
    expect(links).toBeGreaterThan(50);
    expect(broken).toEqual([]);
  });

  it('sends every in-page link of a Toaster page to one of its headings', () => {
    const broken: string[] = [];
    const pages = readdirSync(new URL('components/toaster/', CONTENT), { recursive: true, encoding: 'utf8' })
      .filter((entry) => entry.endsWith('.mdx'))
      .map((entry) => `components/toaster/${entry.replaceAll('\\', '/').replace(/\.mdx$/u, '')}`);
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
