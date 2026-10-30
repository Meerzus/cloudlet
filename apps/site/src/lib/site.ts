/** Public origin of the site: the apex is canonical, `www` redirects to it. */
export const SITE_URL = 'https://cloudlet.dev';
/**
 * The site is the Toaster's corner of an umbrella: the landing, the
 * documentation and the Playground live under `/toaster`; the root redirects there (vercel.json)
 * until it becomes the umbrella's own page.
 */
export const TOASTER_PATH = '/toaster';
export const PLAYGROUND_PATH = `${TOASTER_PATH}/playground`;
/**
 * Search engines are welcome since 1.0.0: pages carry no `noindex`, `robots.txt` and `sitemap.xml`
 * are static files of the export. `false` brings back `noindex, nofollow` on every page; then
 * `vercel.json` must send the same `X-Robots-Tag` for the text routes (tests/unit/site-indexing).
 */
export const INDEXABLE = true;
/**
 * Base for absolute metadata URLs (Open Graph, Twitter). The production build is the canonical
 * site; a preview build knows its own address; elsewhere the canonical origin stands in.
 */
export const METADATA_BASE =
  process.env.VERCEL_ENV !== 'production' && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : SITE_URL;
export const GITHUB_URL = 'https://github.com/Meerzus/cloudlet';
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
/** The package source on GitHub: for links to code, not documentation. */
export const README_URL = `${GITHUB_URL}/tree/main/packages/toast#readme`;
/** The documentation section of the site. */
export const DOCS_PATH = `${TOASTER_PATH}/docs`;
/** Where the READMEs point for documentation; tests/unit/site-readmes.test.ts holds them to it. */
export const DOCS_URL = `${SITE_URL}${DOCS_PATH}`;
/** Reading pages: no sky, no Lenis, no cloud footer. */
export function isQuietPath(pathname: string): boolean {
  return pathname === DOCS_PATH || pathname.startsWith(`${DOCS_PATH}/`);
}
/** Stable versions are npm's `latest`; prereleases would go under `next`. */
export const INSTALL_COMMAND = 'npm install @cloudlet/toast';
/** The shadcn registry item, served from `public/r/`. */
export const REGISTRY_ITEM_URL = `${SITE_URL}/r/toaster.json`;
export const SHADCN_COMMAND = `npx shadcn@latest add ${REGISTRY_ITEM_URL}`;
/**
 * What the published package adds to an app, min+gzip bytes (`release:verify` of the
 * `1.1.0` tarball, `artifacts/size/report.json`): its own JavaScript on first load (`start`, before
 * the lazy renderer) and the renderer chunk that follows (`lazy`), all of its JavaScript, its CSS,
 * and the whole delta over a React-only app. The landing leads with `start`, always named as
 * JavaScript on first load; tests/unit/site-drift.test.ts holds them to the latest size report.
 */
export const PACKAGE_SIZE = { version: '1.1.0', start: 9288, lazy: 22650, javascript: 31938, css: 3794, total: 36141 } as const;
/** Bytes as the landing prints them: whole kilobytes, one decimal under ten. */
export function formatKB(bytes: number): string {
  const kb = bytes / 1000;
  return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
}
