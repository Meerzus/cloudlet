import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INDEXABLE, KIT_DESCRIPTION, KIT_PATH, KIT_TITLE, SITE_URL, TOASTER_DESCRIPTION, TOASTER_PATH, TOASTER_TITLE } from '../../apps/site/src/lib/site';

const vercel = JSON.parse(readFileSync(new URL('../../apps/site/vercel.json', import.meta.url), 'utf8')) as {
  readonly headers?: readonly { readonly source: string; readonly headers: readonly { key: string; value: string }[] }[];
  readonly redirects?: readonly { readonly source: string; readonly destination: string; readonly permanent?: boolean; readonly has?: readonly { type: string; value: string }[] }[];
};

const source = (path: string) => readFileSync(new URL(`../../apps/site/src/app/${path}`, import.meta.url), 'utf8');

const hostRedirects = (vercel.redirects ?? []).filter((rule) => rule.has);

describe('site umbrella (launch P01)', () => {
  it('sends the public vercel.app aliases of production to the canonical host first', () => {
    expect(vercel.redirects?.slice(0, hostRedirects.length)).toEqual(hostRedirects);
    expect(hostRedirects.map((rule) => rule.has)).toEqual(
      ['cloudlet-five.vercel.app', 'cloudlet-meerzus-projects.vercel.app', 'cloudlet-git-prod-meerzus-projects.vercel.app'].map((value) => [{ type: 'host', value }]),
    );
    for (const rule of hostRedirects) expect(rule).toMatchObject({ source: '/:path*', destination: `${SITE_URL}/:path*`, permanent: true });
  });

  it("serves the root as the kit's own page: no redirect away from it", () => {
    expect(KIT_PATH).toBe('/');
    expect((vercel.redirects ?? []).filter((rule) => rule.source === '/')).toEqual([]);
    // The former addresses (the docs', the Playground's) are held by site-docs-redirects.test.ts.
    expect(TOASTER_PATH).toBe('/toaster');
    expect(SITE_URL).toBe('https://cloudlet.dev');
  });

  it('leaves no placeholder domain in what the public reads', () => {
    const files = ['README.md', 'packages/toast/README.md', 'registry/README.md', 'registry/registry.json', 'apps/site/src/lib/site.ts', 'apps/site/src/lib/get-started.ts', 'apps/site/src/lib/faq.ts'];
    for (const path of files) expect(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'), path).not.toContain('cloudlet.example');
  });
});

describe('site metadata', () => {
  it("gives the root the kit's title, description, card address and canonical", () => {
    const layout = source('layout.tsx');
    expect(layout).toMatch(/title: KIT_TITLE,\s+description: KIT_DESCRIPTION,/);
    expect(layout).toContain('url: KIT_PATH');
    expect(layout).not.toContain('TOASTER_');
    expect(source('(kit)/page.tsx')).toContain('canonical: `${SITE_URL}${KIT_PATH}`');
    expect(KIT_TITLE).toMatch(/^Cloudlet — /);
    expect(KIT_DESCRIPTION).not.toBe(TOASTER_DESCRIPTION);
  });

  it("moves the Toaster's title, description and card to /toaster", () => {
    const layout = source('toaster/(site)/layout.tsx');
    expect(layout).toMatch(/title: TOASTER_TITLE,\s+description: TOASTER_DESCRIPTION,/);
    expect(layout).toContain('url: TOASTER_PATH');
    expect(source('toaster/(site)/page.tsx')).toContain('canonical: `${SITE_URL}${TOASTER_PATH}`');
    expect(TOASTER_TITLE).toBe('Cloudlet — notifications, light as a cloud');
    for (const name of ['opengraph-image', 'twitter-image']) {
      const png = readFileSync(new URL(`../../apps/site/src/app/toaster/(site)/${name}.png`, import.meta.url));
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      // The IHDR chunk holds the width, then the height.
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
      expect(source(`toaster/(site)/${name}.alt.txt`)).toMatch(/^Cloudlet — /);
    }
  });

  it("gives the root the kit's own card, a JPEG of 1200×630 that is not the Toaster's", () => {
    const toaster = readFileSync(new URL('../../apps/site/src/app/toaster/(site)/opengraph-image.png', import.meta.url));
    for (const name of ['opengraph-image', 'twitter-image']) {
      expect(existsSync(new URL(`../../apps/site/src/app/${name}.png`, import.meta.url)), `${name}.png`).toBe(false);
      const jpeg = readFileSync(new URL(`../../apps/site/src/app/${name}.jpg`, import.meta.url));
      expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      // The baseline frame header (SOF0) holds the height, then the width.
      const sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
      expect([jpeg.readUInt16BE(sof + 7), jpeg.readUInt16BE(sof + 5)]).toEqual([1200, 630]);
      expect(jpeg.length).toBeLessThan(400_000);
      expect(jpeg.equals(toaster)).toBe(false);
      expect(source(`${name}.alt.txt`)).toMatch(/^Cloudlet — /);
      expect(source(`${name}.alt.txt`)).not.toContain('Notifications, light as a cloud');
    }
  });

  it('gives every docs page its own twitter title and description, with the card it inherits', () => {
    expect(source('docs/[[...slug]]/page.tsx')).toMatch(/twitter: \{ card: 'summary_large_image', title, description: page\.data\.description, images: picker \? pickerCard\('twitter-image'\) : \(twitter\?\.images \?\? \[\]\) \}/);
  });

  it("keeps the color picker's large card: its own twitter replaces the root's whole", () => {
    expect(source('color-picker/page.tsx')).toContain("twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION }");
  });

  it('has no meta refresh left at the root', () => {
    expect(source('(kit)/page.tsx')).not.toMatch(/refresh/i);
  });
});

describe('site indexing (1.0.0)', () => {
  it('lets search engines in (robots.txt and sitemap.xml are app/robots.ts and app/sitemap.ts)', () => {
    expect(INDEXABLE).toBe(true);
  });

  it("lists the kit's landing first in the sitemap, then the Toaster's (the export's sitemap.xml is checked by hand)", () => {
    expect(source('sitemap.ts')).toContain('const paths = [KIT_PATH, TOASTER_PATH,');
    expect(`${SITE_URL}${KIT_PATH}`).toBe('https://cloudlet.dev/');
  });

  it('sends X-Robots-Tag from the host exactly while pages are noindex', () => {
    const robots = (vercel.headers ?? []).flatMap((rule) => rule.headers.filter((header) => header.key === 'X-Robots-Tag').map((header) => [rule.source, header.value]));
    expect(robots).toEqual(INDEXABLE ? [] : [['/(.*)', 'noindex, nofollow']]);
  });
});
