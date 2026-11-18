import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The documentation moved from `/toaster/docs/...` and `/color-picker/docs` to one tree at
 * `/docs/...`, and the Toaster's Installation and Quick start became sections of its component
 * page. Every former page address, and its `.md` twin, must reach its page in one permanent
 * step: a merged page lands on its section, its `.md` on the Markdown of the page that holds it. No former address may land on `/docs` or `/docs/installation`: visitors still hold a cached
 * 301 `/docs → /toaster/docs`, and a redirect back would loop them forever. No rule may point at an
 * address that itself redirects, and no page of the new tree may be redirected.
 */
type Rule = { readonly source: string; readonly destination: string; readonly permanent?: boolean; readonly has?: readonly unknown[] };

const vercel = JSON.parse(readFileSync(new URL('../../apps/site/vercel.json', import.meta.url), 'utf8')) as { readonly redirects?: readonly Rule[] };
/** Host rules only fire on the vercel.app aliases; on the canonical host the path rules apply. */
const rules = (vercel.redirects ?? []).filter((rule) => !rule.has);

const CONTENT = new URL('../../apps/site/content/docs/en/', import.meta.url);

/** Every page of the new tree, by URL: `index.mdx` is its folder's address. */
const pages = new Set(
  (readdirSync(CONTENT, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.mdx'))
    .map((file) => `/docs/${file.replace(/\.mdx$/, '').replace(/(^|\/)index$/, '')}`.replace(/\/$/, '')),
);

/** The pages the docs had before the move (the Toaster's 16 and the color picker's one). */
const TOASTER_SLUGS = [
  '',
  'installation',
  'quick-start',
  'notifications',
  'operations',
  'forms',
  'positioning',
  'styling',
  'ssr',
  'csp',
  'accessibility',
  'api/create-cloudlet',
  'api/controller',
  'api/toaster',
  'api/labels',
  'api/types',
];
/** Toaster pages merged into the component page, and the section that holds each one now. */
const MERGED: Record<string, string> = { installation: '#installation', 'quick-start': '#usage' };
const TOASTER = '/docs/components/toaster';

/** Where a Toaster page of the first tree lives now: the address and the Markdown it redirects to. */
function home(slug: string): readonly [string, string] {
  const section = MERGED[slug];
  if (section) return [`${TOASTER}${section}`, `${TOASTER}.md`];
  const page = `${TOASTER}${slug && `/${slug}`}`;
  return [page, `${page}.md`];
}

/** Each former address, the page it reaches and the Markdown its `.md` reaches. */
const FORMER: readonly (readonly [string, string, string])[] = [
  ...TOASTER_SLUGS.map((slug) => [`/toaster/docs${slug && `/${slug}`}`, ...home(slug)] as const),
  ['/color-picker/docs', '/docs/components/color-picker', '/docs/components/color-picker.md'],
  // Pages of the kit tree that were merged later.
  ...Object.keys(MERGED).map((slug) => [`${TOASTER}/${slug}`, ...home(slug)] as const),
];

/** The page part of an address: a section of a page is reached through the page. */
const pageOf = (address: string) => address.replace(/#.*$/u, '');

/** Matches a Vercel source (literal segments, `:name`, `:name*`) against a path; returns the destination with its parameters filled in. */
function apply(rule: Rule, path: string): string | undefined {
  const names: string[] = [];
  const pattern = rule.source.replace(/\/:(\w+)(\*)?|[.+?^${}()|[\]\\]/g, (token, name: string | undefined, star: string | undefined) => {
    if (!name) return `\\${token}`;
    names.push(name);
    return star ? '(?:/(.*))?' : '/([^/]+)';
  });
  const match = new RegExp(`^${pattern}$`).exec(path);
  if (!match) return undefined;
  let destination = rule.destination;
  names.forEach((name, index) => {
    const value = match[index + 1];
    destination = destination.replace(new RegExp(`/:${name}\\*?`), value ? `/${value}` : '');
  });
  return destination;
}

/** The first rule that fires for a path, as Vercel picks it. */
function redirect(path: string): { rule: Rule; to: string } | undefined {
  for (const rule of rules) {
    const to = apply(rule, path);
    if (to !== undefined) return { rule, to };
  }
  return undefined;
}

describe('docs redirects from the former addresses', () => {
  it('keeps the list of former pages complete: 17 pages and 2 merged ones, each with a home in the new tree', () => {
    expect(FORMER).toHaveLength(19);
    for (const [, page, markdown] of FORMER) {
      expect(pages.has(pageOf(page)), `${page} is not a page of content/docs/en`).toBe(true);
      expect(markdown, `${page}: its .md`).toBe(`${pageOf(page)}.md`);
    }
    for (const slug of Object.keys(MERGED)) expect(pages.has(`${TOASTER}/${slug}`), `${slug} was merged and must not be written again`).toBe(false);
  });

  for (const [from, page, markdown] of FORMER) {
    for (const [source, target] of [[from, page], [`${from}.md`, markdown]] as const) {
      it(`${source} → ${target} in one permanent step`, () => {
        const step = redirect(source);
        expect(step, `no redirect rule in vercel.json catches ${source}`).toBeDefined();
        expect(step?.to, `${source} is sent to ${step?.to}, not to its page ${target}`).toBe(target);
        expect(step?.rule.permanent, `the rule for ${source} must be permanent`).toBe(true);
        expect(['/docs', '/docs/installation'], `${source} must not land on the kit's own pages`).not.toContain(pageOf(step?.to ?? '').replace(/\.md$/, ''));
        expect(redirect(pageOf(target)), `${target} redirects again — a chain`).toBeUndefined();
      });
    }
  }

  it('redirects no page of the new tree, nor its .md', () => {
    for (const page of pages) {
      expect(redirect(page), `${page} is caught by a redirect rule`).toBeUndefined();
      expect(redirect(`${page}.md`), `${page}.md is caught by a redirect rule`).toBeUndefined();
    }
  });

  it('points no rule at an address that redirects itself', () => {
    for (const rule of rules) {
      if (/:\w/.test(rule.destination)) continue; // patterned destinations are walked above with real addresses
      expect(redirect(pageOf(rule.destination)), `${rule.source} → ${rule.destination} redirects again`).toBeUndefined();
    }
  });

  it('sends /docs/components to /docs temporarily: a component list may live there later', () => {
    expect(redirect('/docs/components')).toEqual({ rule: { source: '/docs/components', destination: '/docs', permanent: false }, to: '/docs' });
    expect(pages.has('/docs/components')).toBe(false);
  });
});
