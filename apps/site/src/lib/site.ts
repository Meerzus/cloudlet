/** Public origin of the site: the apex is canonical, `www` redirects to it. */
export const SITE_URL = 'https://cloudlet.dev';
/**
 * The Toaster's landing and Playground live under `/toaster`; the root redirects there
 * (vercel.json) until it becomes the kit's own page.
 */
export const TOASTER_PATH = '/toaster';
export const PLAYGROUND_PATH = `${TOASTER_PATH}/playground`;
/** The color picker's landing (COLOR_PICKER §8): a registry item, no npm package. */
export const COLOR_PICKER_PATH = '/color-picker';
/** The documentation of the whole kit: one tree, one sidebar (`content/docs/en`). */
export const DOCS_PATH = '/docs';
/** Where the READMEs point for documentation; tests/unit/site-readmes.test.ts holds them to it. */
export const DOCS_URL = `${SITE_URL}${DOCS_PATH}`;
/** The Toaster's page in the docs; its guides and reference live under it. */
export const TOASTER_DOCS_PATH = `${DOCS_PATH}/components/toaster`;
/** The color picker's page in the docs (the palette is a section of it). */
export const COLOR_PICKER_DOCS_PATH = `${DOCS_PATH}/components/color-picker`;
/** The family's components, in the header's switch order: landing, docs and (Toaster only) Playground. */
export interface SiteComponent {
  readonly id: 'toaster' | 'color-picker';
  readonly name: string;
  /** The name on the narrowest phones, where the header has no room for the full one. */
  readonly short: string;
  readonly path: string;
  readonly docs: string;
  readonly playground?: string;
}
export const COMPONENTS: readonly SiteComponent[] = [
  { id: 'toaster', name: 'Toaster', short: 'Toaster', path: TOASTER_PATH, docs: TOASTER_DOCS_PATH, playground: `${TOASTER_PATH}/playground` },
  { id: 'color-picker', name: 'Color picker', short: 'Picker', path: COLOR_PICKER_PATH, docs: COLOR_PICKER_DOCS_PATH },
];
/** `pathname` is `path` or a page under it. */
export function isUnder(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}
/**
 * The component a path belongs to: its landing, its pages and its page in the docs. Anything else
 * (the root, the kit's docs pages, unknown paths) is the Toaster's.
 */
export function componentOf(pathname: string): SiteComponent {
  return COMPONENTS.find((component) => isUnder(pathname, component.path) || isUnder(pathname, component.docs)) ?? COMPONENTS[0]!;
}
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
/** Reading pages, everything under `/docs`: no sky, no Lenis, no cloud footer. */
export function isQuietPath(pathname: string): boolean {
  return isUnder(pathname, DOCS_PATH);
}
/** Stable versions are npm's `latest`; prereleases would go under `next`. */
export const INSTALL_COMMAND = 'npm install @cloudlet/toast';
/** The kit's registry items, in the order the docs list them; `registry/registry.json` names them the same. */
export const REGISTRY_ITEMS = ['toaster', 'color-picker', 'color-palette'] as const;
export type RegistryItem = (typeof REGISTRY_ITEMS)[number];
/** The namespace the shadcn CLI resolves through its registry directory. */
export const REGISTRY_NAMESPACE = '@cloudlet';
/** A registry item's address, served from `public/r/`. */
export function registryItemUrl(item: RegistryItem): string {
  return `${SITE_URL}/r/${item}.json`;
}
/** `npx shadcn@latest add @cloudlet/<item>`: the form for a CLI that knows the namespace. */
export function registryCommand(item: RegistryItem): string {
  return `npx shadcn@latest add ${REGISTRY_NAMESPACE}/${item}`;
}
/** `npx shadcn@latest add https://cloudlet.dev/r/<item>.json`: the same item by its address, for any CLI. */
export function registryUrlCommand(item: RegistryItem): string {
  return `npx shadcn@latest add ${registryItemUrl(item)}`;
}
/** The Toaster's registry item: a wrapper over the npm package. */
export const REGISTRY_ITEM_URL = registryItemUrl('toaster');
export const SHADCN_COMMAND = registryUrlCommand('toaster');
/** The color picker's registry item: source files only, no npm package (COLOR_PICKER §1). */
export const COLOR_PICKER_COMMAND = registryUrlCommand('color-picker');
/** The color palette's registry item: it lists the color picker as a registry dependency (COLOR_PALETTE §1). */
export const COLOR_PALETTE_COMMAND = registryUrlCommand('color-palette');
/**
 * What the published package adds to an app, min+gzip bytes (`release:verify` of the
 * `1.2.0` tarball, `artifacts/size/report.json`): its own JavaScript on first load (`start`, before
 * the lazy renderer) and the renderer chunk that follows (`lazy`), all of its JavaScript, its CSS,
 * and the whole delta over a React-only app. The landing leads with `start`, always named as
 * JavaScript on first load; tests/unit/site-drift.test.ts holds them to the latest size report.
 */
export const PACKAGE_SIZE = { version: '1.2.0', start: 9336, lazy: 23240, javascript: 32576, css: 4079, total: 37062 } as const;
/** Bytes as the landing prints them: whole kilobytes, one decimal under ten. */
export function formatKB(bytes: number): string {
  const kb = bytes / 1000;
  return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
}
