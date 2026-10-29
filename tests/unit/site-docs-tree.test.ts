import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The documentation's page tree: `meta.json` lists the pages in that order,
 * every written page is listed, and every listed page is either written or still pending.
 * A page that lands must leave PENDING, so the list below is the honest state of the series.
 */
const CONTENT = new URL('../../apps/site/content/docs/en/', import.meta.url);

/** The pages in sidebar order; `...api` inlines the Reference folder. */
const SPEC_ORDER = [
  '---Getting started---',
  'index',
  'installation',
  'quick-start',
  '[Playground](/toaster/playground)',
  '---Guides---',
  'notifications',
  'operations',
  'positioning',
  'styling',
  'ssr',
  'accessibility',
  '---Reference---',
  '...api',
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
    const listed = new Set([...meta.pages.filter(isPage), ...REFERENCE_PAGES.map((page) => `api/${page}`)]);
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

  it('has the whole Getting started group written', () => {
    const group = meta.pages.slice(meta.pages.indexOf('---Getting started---') + 1, meta.pages.indexOf('---Guides---'));
    expect(group).toEqual(['index', 'installation', 'quick-start', '[Playground](/toaster/playground)']);
    for (const page of group.filter(isPage)) {
      expect(written, `${page}.mdx`).toContain(page);
      expect(PENDING.has(page), `${page} is pending`).toBe(false);
    }
  });

  it('has the notification Guides written, with Run blocks', () => {
    /** The demo catalog groups each page runs: every one of its entries is on the page. */
    const RUNS: Record<string, readonly string[]> = {
      notifications: ['success', 'info', 'warning', 'error', 'loading', 'title-only', 'description', 'rich-description', 'custom-icon', 'update-loading', 'burst', 'overflow', 'dismiss-all'],
      operations: ['track-resolve', 'error-retry', 'track-cancel', 'promise-progress', 'action-command', 'action-retry', 'action-link'],
      positioning: ['attention-auto', 'attention-upgrade', 'attention-stack'],
    };
    for (const [page, demos] of Object.entries(RUNS)) {
      expect(written, `${page}.mdx`).toContain(page);
      expect(PENDING.has(page), `${page} is pending`).toBe(false);
      const { body } = frontmatter(page);
      const used = [...body.matchAll(/^```tsx demo="([^"]+)"$/gmu)].map((match) => match[1]);
      expect(used, `${page}: demo= blocks`).toEqual(demos);
    }
  });

  it('sends readers to the Playground from Introduction and Quick start only', () => {
    const nextSteps = (page: string) => frontmatter(page).body.split('## Next steps')[1] ?? '';
    for (const page of ['index', 'quick-start']) expect(nextSteps(page), page).toContain('](/toaster/playground)');
    for (const page of ['installation', 'notifications', 'operations', 'positioning', 'styling', 'ssr', 'accessibility']) {
      expect(nextSteps(page), page).not.toContain('](/toaster/playground)');
    }
  });

  it('has the integration Guides written, with typechecked examples and links to the Reference', () => {
    /** Integration guides configure the Toaster rather than show a notification: no Run blocks. */
    const LINKS: Record<string, readonly string[]> = {
      styling: ['/toaster/docs/api/toaster'],
      ssr: ['/toaster/docs/api/toaster'],
      accessibility: ['/toaster/docs/api/toaster', '/toaster/docs/api/labels'],
    };
    for (const [page, links] of Object.entries(LINKS)) {
      expect(written, `${page}.mdx`).toContain(page);
      expect(PENDING.has(page), `${page} is pending`).toBe(false);
      const { body } = frontmatter(page);
      expect(body, `${page}: tsx example`).toMatch(/^```tsx title="[^"]+"$/mu);
      expect(body, `${page}: demo= blocks`).not.toMatch(/demo="/u);
      for (const link of links) expect(body, `${page}: link to ${link}`).toContain(`](${link})`);
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
    const folder = JSON.parse(readFileSync(new URL('api/meta.json', CONTENT), 'utf8')) as { pages: string[] };
    expect(folder.pages).toEqual(REFERENCE_PAGES);
    for (const slug of REFERENCE_PAGES) {
      const page = `api/${slug}`;
      expect(written, `${page}.mdx`).toContain(page);
      expect(PENDING.has(page), `${page} is pending`).toBe(false);
      const { fields, body } = frontmatter(page);
      expect(fields['title'], `${page}: title`).toBe(TITLES[slug]);
      // Prop / Option · Type · Default · Description, the first column named after what it lists.
      expect(body, `${page}: a Prop · Type · Default · Description table`).toMatch(/^\| (?:Prop|Option|Field) \| Type \| Default \| Description \|$/mu);
      expect(body, `${page}: Run blocks belong to the Guides`).not.toMatch(/^```\w+ demo=/mu);
    }
  });

  it('keeps Introduction with a typechecked example and the English locale only', () => {
    expect(written).toContain('index');
    expect(frontmatter('index').body).toMatch(/^```tsx/mu);
    const locales = readdirSync(new URL('../', CONTENT), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    expect(locales).toEqual(['en']);
  });
});
