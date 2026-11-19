/** Public origin of the site: the apex is canonical, `www` redirects to it. */
export const SITE_URL = 'https://cloudlet.dev';
/** The root is the kit's own landing; each component has a landing of its own under it. */
export const KIT_PATH = '/';
/** The kit's title and description: the root's metadata and the site-wide defaults. */
export const KIT_TITLE = 'Cloudlet — React components, light as a cloud';
export const KIT_DESCRIPTION =
  'A kit of React components on interruptible springs: notifications that stack softly, a color picker and a palette. Install them with shadcn and own every line.';
/** The Toaster's landing lives under `/toaster`. */
export const TOASTER_PATH = '/toaster';
/** The Toaster's title and description: its landing's metadata and its Open Graph and Twitter card. */
export const TOASTER_TITLE = 'Cloudlet — notifications, light as a cloud';
export const TOASTER_DESCRIPTION =
  'A React notification stack that drifts in, stacks softly and opens into a card when it matters. Every motion on springs, every frame interruptible.';
/** The color picker's landing (COLOR_PICKER §8): a registry item, no npm package. */
export const COLOR_PICKER_PATH = '/color-picker';
/** The documentation of the whole kit: one tree, one sidebar (`content/docs/en`). */
export const DOCS_PATH = '/docs';
/** Where the READMEs point for documentation; tests/unit/site-readmes.test.ts holds them to it. */
export const DOCS_URL = `${SITE_URL}${DOCS_PATH}`;
/** The Toaster's page in the docs; its guides and reference live under it. */
export const TOASTER_DOCS_PATH = `${DOCS_PATH}/components/toaster`;
/** The color picker's page in the docs; the palette is a section of it until it has its own page. */
export const COLOR_PICKER_DOCS_PATH = `${DOCS_PATH}/components/color-picker`;
/** The color palette has no landing of its own: it is a section of the color picker's. */
export const COLOR_PALETTE_PATH = `${COLOR_PICKER_PATH}#palette`;
/** The color palette's page in the docs: the color picker's until the palette gets its own (`/docs/components/color-palette`). */
export const COLOR_PALETTE_DOCS_PATH = COLOR_PICKER_DOCS_PATH;
/** A component of the kit, as the header's Components panel and the footers list it. */
export interface SiteComponent {
  readonly id: RegistryItem;
  readonly name: string;
  /** One line under the name in the Components panel. */
  readonly description: string;
  /** Its landing, or the section of a landing it lives in. */
  readonly path: string;
  /** Its page in the docs. */
  readonly docs: string;
}
/** The kit's components in the kit's order; the registry lists the same items in the same order. */
export const COMPONENTS: readonly SiteComponent[] = [
  {
    id: 'toaster',
    name: 'Toaster',
    description: 'Notifications that stack softly and open into a card when it matters.',
    path: TOASTER_PATH,
    docs: TOASTER_DOCS_PATH,
  },
  {
    id: 'color-picker',
    name: 'Color picker',
    description: 'Hex, rgb, hsl and oklch, an eyedropper and full keyboard support.',
    path: COLOR_PICKER_PATH,
    docs: COLOR_PICKER_DOCS_PATH,
  },
  {
    id: 'color-palette',
    name: 'Color palette',
    description: 'Up to four colors, built on the color picker.',
    path: COLOR_PALETTE_PATH,
    docs: COLOR_PALETTE_DOCS_PATH,
  },
];
/** `pathname` is `path` or a page under it. */
export function isUnder(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}
/**
 * The component a page belongs to: its landing, the pages under it and its pages in the docs. The
 * kit's own pages (the root, `/docs`, `/docs/installation`) and unknown paths belong to none. The
 * palette lives on the color picker's landing and, for now, in its docs, so those pages are the
 * picker's: the first component in the kit's order wins.
 */
export function componentOf(pathname: string): SiteComponent | undefined {
  return COMPONENTS.find((component) => isUnder(pathname, component.path) || isUnder(pathname, component.docs));
}
/** Where Docs leads from a page: the page's component in the docs, or the docs of the whole kit. */
export function docsPathOf(pathname: string): string {
  return componentOf(pathname)?.docs ?? DOCS_PATH;
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
