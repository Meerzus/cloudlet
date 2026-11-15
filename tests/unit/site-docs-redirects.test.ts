import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The documentation moved from `/toaster/docs/...` and `/color-picker/docs` to one tree at
 * `/docs/...`. Every former page address, and its `.md` twin, must reach its page in one permanent
 * step. No former address may land on `/docs` or `/docs/installation`: visitors still hold a cached
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

/** The pages the docs had before the move (the Toaster's 16 and the color picker's one), and where each one lives now. */
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
const FORMER: readonly (readonly [string, string])[] = [
  ...TOASTER_SLUGS.map((slug) => [`/toaster/docs${slug && `/${slug}`}`, `/docs/components/toaster${slug && `/${slug}`}`] as const),
  ['/color-picker/docs', '/docs/components/color-picker'],
];

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
  it('keeps the list of former pages complete: 17 pages, each with a home in the new tree', () => {
    expect(FORMER).toHaveLength(17);
    for (const [, page] of FORMER) expect(pages.has(page), `${page} is not a page of content/docs/en`).toBe(true);
  });

  for (const [from, page] of FORMER) {
    for (const [source, target] of [[from, page], [`${from}.md`, `${page}.md`]] as const) {
      it(`${source} → ${target} in one permanent step`, () => {
        const step = redirect(source);
        expect(step, `no redirect rule in vercel.json catches ${source}`).toBeDefined();
        expect(step?.to, `${source} is sent to ${step?.to}, not to its page ${target}`).toBe(target);
        expect(step?.rule.permanent, `the rule for ${source} must be permanent`).toBe(true);
        expect(['/docs', '/docs/installation'], `${source} must not land on the kit's own pages`).not.toContain(step?.to.replace(/\.md$/, ''));
        expect(redirect(target), `${target} redirects again — a chain`).toBeUndefined();
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
      expect(redirect(rule.destination), `${rule.source} → ${rule.destination} redirects again`).toBeUndefined();
    }
  });

  it('sends /docs/components to /docs temporarily: a component list may live there later', () => {
    expect(redirect('/docs/components')).toEqual({ rule: { source: '/docs/components', destination: '/docs', permanent: false }, to: '/docs' });
    expect(pages.has('/docs/components')).toBe(false);
  });
});
