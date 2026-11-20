import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMO_GROUPS, DEMOS } from '../../apps/site/src/lib/demos';
import { INSTALL_COMMAND, REGISTRY_ITEMS, registryCommand, registryUrlCommand } from '../../apps/site/src/lib/site';

/**
 * The documentation's page tree, one for the whole kit: the root `meta.json` lists every page
 * in sidebar order by its path, every written page is listed, and every listed page is either
 * written or still pending. A page that lands must leave PENDING, so the list below is the honest
 * state of the series. Pages are named by their path under `content/docs/en`.
 */
const CONTENT = new URL('../../apps/site/content/docs/en/', import.meta.url);
const TOASTER = 'components/toaster';

/** The pages in sidebar order; `...components/toaster/api` inlines the Toaster's Reference folder. */
const SPEC_ORDER = [
  '---Getting started---',
  'index',
  'installation',
  '---Components---',
  `${TOASTER}/index`,
  'components/color-picker',
  '---Toaster guides---',
  `${TOASTER}/notifications`,
  `${TOASTER}/operations`,
  `${TOASTER}/forms`,
  `${TOASTER}/styling`,
  '---Toaster advanced---',
  `${TOASTER}/positioning`,
  `${TOASTER}/ssr`,
  `${TOASTER}/csp`,
  `${TOASTER}/accessibility`,
  '---Toaster reference---',
  `...${TOASTER}/api`,
];

const REFERENCE_PAGES = ['create-cloudlet', 'controller', 'toaster', 'labels', 'types'];

/** Pages not written yet: none at the moment. A new page starts here. */
const PENDING = new Set<string>();

const isPage = (entry: string) => !entry.startsWith('---') && !entry.startsWith('[') && !entry.startsWith('...');

function writtenPages() {
  return readdirSync(CONTENT, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.mdx'))
    .map((entry) => entry.replaceAll('\\', '/').replace(/\.mdx$/u, ''))
    .sort();
}

function frontmatter(page: string) {
  const text = readFileSync(new URL(`${page}.mdx`, CONTENT), 'utf8');
  const block = /^---\n([\s\S]*?)\n---\n/u.exec(text);
  const fields = Object.fromEntries(
    (block?.[1] ?? '').split('\n').map((line) => {
      const index = line.indexOf(':');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
  );
  return { fields, body: text.slice(block?.[0].length ?? 0) };
}

describe('site docs tree', () => {
  const meta = JSON.parse(readFileSync(new URL('meta.json', CONTENT), 'utf8')) as { pages: string[] };
  const written = writtenPages();

  it('lists the pages in sidebar order', () => {
    expect(meta.pages).toEqual(SPEC_ORDER);
  });

  it('has every written page in the tree, and every pending page still unwritten', () => {
    const listed = new Set([...meta.pages.filter(isPage), ...REFERENCE_PAGES.map((page) => `${TOASTER}/api/${page}`)]);
    for (const page of written) expect(listed.has(page), `${page}.mdx is not in the page tree`).toBe(true);
    for (const page of listed) {
      if (written.includes(page)) expect(PENDING.has(page), `${page} is written: remove it from PENDING`).toBe(false);
      else expect(PENDING.has(page), `${page} is missing and not marked pending`).toBe(true);
    }
  });

  it('gives every page a title and a description', () => {
    for (const page of written) {
      const { fields } = frontmatter(page);
      expect(fields['title'], `${page}: title`).toBeTruthy();
      expect(fields['description'], `${page}: description`).toBeTruthy();
    }
  });

  it('lists every page once', () => {
    const pages = meta.pages.filter(isPage);
    expect(new Set(pages).size).toBe(pages.length);
  });

  it('lists only component pages under Components', () => {
    const group = meta.pages.slice(meta.pages.indexOf('---Components---') + 1, meta.pages.indexOf('---Toaster guides---'));
    expect(group).toEqual([`${TOASTER}/index`, 'components/color-picker']);
  });

  it('has the notification Guides written, with Run blocks', () => {
    /** The demo catalog groups each page runs: every one of its entries is on the page. */
    const RUNS: Record<string, readonly string[]> = {
      notifications: ['burst', 'attention-auto', 'attention-upgrade', 'attention-stack', 'overflow', 'dismiss-all'],
      operations: ['track-cancel', 'promise-progress'],
      forms: ['form-reply', 'form-note', 'form-retry'],
    };
    for (const [name, demos] of Object.entries(RUNS)) {
      const page = `${TOASTER}/${name}`;
      expect(written, `${page}.mdx`).toContain(page);
      expect(PENDING.has(page), `${page} is pending`).toBe(false);
      const { body } = frontmatter(page);
      const used = [...body.matchAll(/^```tsx demo="([^"]+)"$/gmu)].map((match) => match[1]);
      expect(used, `${page}: demo= blocks`).toEqual(demos);
    }
  });

  it('has the integration Guides written, with typechecked examples and links to the Reference', () => {
    /** Integration guides configure the Toaster rather than show a notification: no Run blocks. */
    const LINKS: Record<string, readonly string[]> = {
      styling: ['/docs/components/toaster/api/toaster'],
      ssr: ['/docs/components/toaster/api/toaster'],
      csp: ['/docs/components/toaster/api/toaster'],
      accessibility: ['/docs/components/toaster/api/toaster', '/docs/components/toaster/api/labels'],
    };
    for (const [name, links] of Object.entries(LINKS)) {
      const page = `${TOASTER}/${name}`;
      expect(written, `${page}.mdx`).toContain(page);
      expect(PENDING.has(page), `${page} is pending`).toBe(false);
      const { body } = frontmatter(page);
      expect(body, `${page}: tsx example`).toMatch(/^```tsx title="[^"]+"$/mu);
      expect(body, `${page}: demo= blocks`).not.toMatch(/demo="/u);
      // The page itself or one of its sections: a link to a prop lands on the Props table.
      for (const link of links) expect(body.includes(`](${link})`) || body.includes(`](${link}#`), `${page}: link to ${link}`).toBe(true);
    }
  });

  it('has the Reference written in order, each page with a reference table', () => {
    /** Sidebar names come from the titles. */
    const TITLES: Record<string, string> = {
      'create-cloudlet': 'createCloudlet',
      controller: 'Controller',
      toaster: 'Toaster props',
      labels: 'Labels & announcements',
      types: 'Types',
    };
    const folder = JSON.parse(readFileSync(new URL(`${TOASTER}/api/meta.json`, CONTENT), 'utf8')) as { pages: string[] };
    expect(folder.pages).toEqual(REFERENCE_PAGES);
    for (const slug of REFERENCE_PAGES) {
      const page = `${TOASTER}/api/${slug}`;
      expect(written, `${page}.mdx`).toContain(page);
      expect(PENDING.has(page), `${page} is pending`).toBe(false);
      const { fields, body } = frontmatter(page);
      expect(fields['title'], `${page}: title`).toBe(TITLES[slug]);
      // Prop / Option · Type · Default · Description, the first column named after what it lists.
      expect(body, `${page}: a Prop · Type · Default · Description table`).toMatch(/^\| (?:Prop|Option|Field) \| Type \| Default \| Description \|$/mu);
      expect(body, `${page}: Run blocks belong to the Guides`).not.toMatch(/^```\w+ demo=/mu);
    }
  });

  it("has the kit's Introduction and Installation, with commands in the forms of site.ts", () => {
    const intro = frontmatter('index').body;
    for (const link of ['/docs/components/toaster', '/docs/components/color-picker', '/docs/components/color-picker#palette', '/docs/installation']) {
      expect(intro, `index: link to ${link}`).toContain(`](${link})`);
    }
    // The Markdown of every page and llms.txt are said once, for the whole docs, here.
    for (const link of ['https://cloudlet.dev/llms.txt', 'https://cloudlet.dev/llms-full.txt']) expect(intro, `index: link to ${link}`).toContain(`](${link})`);
    expect(intro).toMatch(/Markdown version at its address plus `\.md`/u);
    expect(frontmatter(`${TOASTER}/index`).body, 'the Toaster page leaves llms.txt to the Introduction').not.toContain('llms.txt');
    const installation = frontmatter('installation').body;
    const commands = [...installation.matchAll(/<InstallCommand command="([^"]+)" \/>/gu)].map((match) => match[1]);
    expect(commands).toEqual([registryCommand('color-picker'), registryUrlCommand('color-picker'), INSTALL_COMMAND]);
    for (const item of REGISTRY_ITEMS) expect(installation, `installation: item ${item}`).toMatch(new RegExp(`^\\| \`${item}\` \\|`, 'mu'));
    const registry = JSON.parse(readFileSync(new URL('../../registry/registry.json', import.meta.url), 'utf8')) as { items: { name: string }[] };
    expect(registry.items.map((entry) => entry.name)).toEqual([...REGISTRY_ITEMS]);
    expect(installation).toContain('`https://cloudlet.dev/r/<item>.json`');
    expect(installation).toContain('](/docs/components/toaster#installation)');
  });

  it('keeps the Toaster on one component page: Preview, Installation, Usage, Examples, API Reference', () => {
    expect(written).toContain(`${TOASTER}/index`);
    const { fields, body } = frontmatter(`${TOASTER}/index`);
    expect(fields['title']).toBe('Toaster');
    expect([...body.matchAll(/^## (.+)$/gmu)].map((match) => match[1])).toEqual(['Preview', 'Installation', 'Usage', 'Examples', 'API Reference']);
    const section = (name: string) => body.split(`\n## ${name}\n`)[1]?.split('\n## ')[0] ?? '';
    expect(section('Preview'), 'Preview: the live preview of the page Toaster').toMatch(/^<ToasterPreview \/>$/mu);
    expect(section('Preview'), 'Preview: no demo block, the Examples run the catalog').not.toMatch(/^```tsx demo=/mu);
    expect(section('Preview'), 'Preview: a link to the Examples it moves').toContain('](#examples)');
    expect(section('Installation'), 'Installation: the npm / shadcn tabs').toContain('<GetStartedTabs />');
    expect(section('Installation'), 'Installation: the kit page for the namespace').toContain('](/docs/installation)');
    for (const heading of ['Requirements', 'Import the styles', 'The shadcn registry item']) expect(section('Installation')).toContain(`\n### ${heading}\n`);
    expect(section('Usage'), 'Usage: a typechecked example').toMatch(/^```tsx title="[^"]+"$/mu);
    for (const link of ['/docs/components/toaster/ssr#nextjs-app-router', '/docs/components/toaster/api/labels', '/docs/components/toaster/styling']) {
      expect(section('Usage'), `Usage: link to ${link}`).toContain(`](${link})`);
    }
    // Three columns: the export as code, what it is, a link to its reference page named by that page.
    expect(section('API Reference')).toContain('\n| Export | What it is | Reference |\n');
    for (const name of ['createCloudlet', 'CloudletProvider', 'useCloudlet', 'Toaster']) {
      expect(section('API Reference'), `API Reference: ${name}`).toMatch(
        new RegExp(`^\\| \`${name}\` \\| [^|]+ \\| \\[(?:createCloudlet|Toaster props)\\]\\(/docs/components/toaster/api/[^)]+\\) \\|$`, 'mu'),
      );
    }
  });

  it('runs the whole demo catalog in Examples, a group per heading with its blurb, in catalog order', () => {
    const examples = frontmatter(`${TOASTER}/index`).body.split('\n## Examples\n')[1]?.split('\n## ')[0] ?? '';
    const groups = examples.split(/^### /mu).slice(1);
    expect(groups.map((group) => group.split('\n')[0])).toEqual(DEMO_GROUPS.map((group) => group.id));
    for (const [index, { id, blurb }] of DEMO_GROUPS.entries()) {
      const group = groups[index] ?? '';
      expect(group, `${id}: blurb`).toContain(`\n${blurb} `);
      expect(group, `${id}: a link to the guide`).toMatch(/\]\(\/docs\/components\/toaster\/[a-z-]+(?:#[a-z-]+)?\)\.\n/u);
      expect(group, `${id}: one <Demos>`).toMatch(/<Demos>[\s\S]*<\/Demos>/u);
      const used = [...group.matchAll(/^```tsx demo="([^"]+)"$/gmu)].map((match) => match[1]);
      expect(used, `${id}: demo= blocks`).toEqual(DEMOS.filter((demo) => demo.group === id).map((demo) => demo.id));
    }
  });

  it('has the English locale only', () => {
    const locales = readdirSync(new URL('../', CONTENT), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    expect(locales).toEqual(['en']);
  });
});
