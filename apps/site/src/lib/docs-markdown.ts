import { renderPlaceholder, type PlaceholderData } from 'fumadocs-core/mdx-plugins/remark-llms.runtime';
import { groupTree } from '@/components/docs/nav';
import { source, type DocsPage } from './docs-source';
import { DOCS_UI } from './docs-ui-strings';
import { GET_STARTED, type GetStartedTab } from './get-started';
import { DOCS_PATH, DOCS_URL, SITE_URL } from './site';

/*
 * The documentation for agents (DOCS.md §9), from the same MDX as the pages: `/llms.txt` lists
 * the pages, `/llms-full.txt` holds them all, `/toaster/docs/<slug>.md` is one page. fumadocs-mdx keeps
 * the authored Markdown of each page (`includeProcessedMarkdown`); MDX components come as
 * placeholders and are expanded here into plain text and code, runnable fences are already plain
 * code (remark-demo-note.ts) and a `<Demos>` group is just its fences, and site links become absolute.
 */

/** One line about Cloudlet, the same as the site's description. */
export const LLMS_SUMMARY =
  'Cloudlet (`@cloudlet/toast`) is a React notification stack that drifts in, stacks softly and opens into a card when it matters; every motion runs on springs and every frame is interruptible.';

const fence = (lang: string, code: string, title?: string) => `\`\`\`${lang}${title ? ` title="${title}"` : ''}\n${code}\n\`\`\``;

function getStartedTab(id: string | undefined): GetStartedTab {
  const tab = GET_STARTED.find((item) => item.id === id);
  if (!tab) throw new Error(`Unknown Get started tab "${id}"`);
  return tab;
}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

const RENDERERS: Record<string, (data: PlaceholderData) => string> = {
  Callout: ({ attributes, children }) => {
    const type = (text(attributes.type) ?? 'note') as keyof typeof DOCS_UI.noteLabels;
    const title = text(attributes.title) ?? DOCS_UI.noteLabels[type];
    const body = `**${title}.** ${children.trim()}`;
    return body.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
  },
  GetStartedTabs: () =>
    GET_STARTED.map(
      (tab) => `**${tab.label}.** ${tab.commandNote}\n\n${fence('sh', tab.command, 'Terminal')}\n\n${tab.codeNote}\n\n${fence('tsx', tab.code, tab.file)}`,
    ).join('\n\n'),
  GetStartedCode: ({ attributes }) => {
    const tab = getStartedTab(text(attributes.tab));
    return fence('tsx', tab.code, tab.file);
  },
  /** A demo block of several fences (DOCS.md §6): the fences, plain code already. */
  Demos: ({ children }) => children.trim(),
  /** The shareable editor contract stays useful away from the interactive page (STYLE_EDITOR §8). */
  StyleEditor: () => `Style editor at ${DOCS_URL}/styling#style-editor: set the tokens on a live Toaster and copy the CSS. The query string carries the values — one parameter per token name without the \`--cloudlet-\` prefix (\`background\`, \`background-dark\`, \`pill-radius\`, \`font-family\`, …); dark-theme colors use the \`-dark\` suffix, and the preview follows the site theme.`,
};

/** `](/docs/…)` → `](https://…/docs/…)`: the Markdown is read away from the site. */
function absoluteLinks(markdown: string): string {
  return markdown.replace(/\]\((\/[^)\s]*)\)/gu, (_, path: string) => `](${SITE_URL}${path})`);
}

/** The Markdown address of a page: its URL plus `.md` (`/toaster/docs.md`, `/toaster/docs/api/toaster.md`). */
export function markdownUrl(page: DocsPage): string {
  return `${page.url}.md`;
}

/** One page as Markdown: title, description, address of the page, then the content. */
export async function pageMarkdown(page: DocsPage): Promise<string> {
  const body = await renderPlaceholder(await page.data.getText('processed'), RENDERERS);
  const head = [`# ${page.data.title}`, page.data.description ? `> ${page.data.description}` : null, `Source: ${SITE_URL}${page.url}`];
  return `${head.filter(Boolean).join('\n\n')}\n\n${absoluteLinks(body).trim()}\n`;
}

/** The pages in sidebar order, grouped as in the sidebar (DOCS.md §4); links outside the docs are kept as they are. */
function sidebar() {
  return groupTree(source.getPageTree().children).map((group) => ({
    name: typeof group.name === 'string' ? group.name : null,
    links: group.links.map((link) => ({ link, page: link.url.startsWith(DOCS_PATH) ? source.getPages().find((page) => page.url === link.url) : undefined })),
  }));
}

/** `/llms.txt` (llmstxt.org): title, summary, then the pages by group, linking to their Markdown. */
export function llmsIndex(): string {
  const sections = sidebar().map(({ name, links }) => {
    const items = links.map(({ link, page }) => {
      if (!page) return `- [${String(link.name)}](${SITE_URL}${link.url})`;
      const description = page.data.description ? `: ${page.data.description}` : '';
      return `- [${page.data.title}](${SITE_URL}${markdownUrl(page)})${description}`;
    });
    return `## ${name ?? DOCS_UI.navLabel}\n\n${items.join('\n')}`;
  });
  const intro = `Every page is Markdown at its address plus \`.md\`; all of them in one file: ${SITE_URL}/llms-full.txt.`;
  return `# Cloudlet\n\n> ${LLMS_SUMMARY}\n\n${intro}\n\n${sections.join('\n\n')}\n`;
}

/** `/llms-full.txt`: every page in sidebar order, separated by rules. */
export async function llmsFull(): Promise<string> {
  const pages = sidebar().flatMap(({ links }) => links.flatMap(({ page }) => (page ? [page] : [])));
  const parts = await Promise.all(pages.map(pageMarkdown));
  return parts.map((part) => part.trim()).join('\n\n---\n\n') + '\n';
}
