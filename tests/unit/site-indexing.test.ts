import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INDEXABLE, SITE_URL, TOASTER_PATH } from '../../apps/site/src/lib/site';

const vercel = JSON.parse(readFileSync(new URL('../../apps/site/vercel.json', import.meta.url), 'utf8')) as {
  readonly headers?: readonly { readonly source: string; readonly headers: readonly { key: string; value: string }[] }[];
  readonly redirects?: readonly { readonly source: string; readonly destination: string; readonly permanent?: boolean; readonly has?: readonly { type: string; value: string }[] }[];
};

const hostRedirects = (vercel.redirects ?? []).filter((rule) => rule.has);
const pathRedirects = (vercel.redirects ?? []).filter((rule) => !rule.has);

describe('site umbrella (launch P01)', () => {
  it('sends the public vercel.app aliases of production to the canonical host first', () => {
    expect(vercel.redirects?.slice(0, hostRedirects.length)).toEqual(hostRedirects);
    expect(hostRedirects.map((rule) => rule.has)).toEqual(
      ['cloudlet-five.vercel.app', 'cloudlet-meerzus-projects.vercel.app', 'cloudlet-git-prod-meerzus-projects.vercel.app'].map((value) => [{ type: 'host', value }]),
    );
    for (const rule of hostRedirects) expect(rule).toMatchObject({ source: '/:path*', destination: `${SITE_URL}/:path*`, permanent: true });
  });

  it('redirects the root to /toaster temporarily, until the root is the umbrella page', () => {
    expect(pathRedirects[0]).toEqual({ source: '/', destination: TOASTER_PATH, permanent: false });
    // The addresses the preview had before the umbrella keep working.
    expect(pathRedirects.slice(1)).toEqual([
      { source: '/docs', destination: `${TOASTER_PATH}/docs`, permanent: true },
      { source: '/docs/:path*', destination: `${TOASTER_PATH}/docs/:path*`, permanent: true },
      { source: '/playground', destination: `${TOASTER_PATH}/playground`, permanent: true },
    ]);
    expect(TOASTER_PATH).toBe('/toaster');
    expect(SITE_URL).toBe('https://cloudlet.dev');
  });

  it('leaves no placeholder domain in what the public reads', () => {
    const files = ['README.md', 'packages/toast/README.md', 'registry/README.md', 'registry/registry.json', 'apps/site/src/lib/site.ts', 'apps/site/src/lib/get-started.ts', 'apps/site/src/lib/faq.ts'];
    for (const path of files) expect(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'), path).not.toContain('cloudlet.example');
  });
});

describe('site indexing (1.0.0)', () => {
  it('lets search engines in (robots.txt and sitemap.xml are app/robots.ts and app/sitemap.ts)', () => {
    expect(INDEXABLE).toBe(true);
  });

  it('sends X-Robots-Tag from the host exactly while pages are noindex', () => {
    const robots = (vercel.headers ?? []).flatMap((rule) => rule.headers.filter((header) => header.key === 'X-Robots-Tag').map((header) => [rule.source, header.value]));
    expect(robots).toEqual(INDEXABLE ? [] : [['/(.*)', 'noindex, nofollow']]);
  });
});
