import { isValidElement, type ReactNode } from 'react';
import { renderPlaceholder, type PlaceholderData } from 'fumadocs-core/mdx-plugins/remark-llms.runtime';
import { groupTree } from '@/components/docs/nav';
import { source, type DocsPage } from './docs-source';
import { findDemo } from './demos';
import { DOCS_UI } from './docs-ui-strings';
import { exampleMarkdown } from './example-source';
import { palettePreviewMarkdown, pickerPreviewMarkdown } from './picker-settings';
import { demoSections, runnableMarkdown } from './runnable-markdown';
import { GET_STARTED, type GetStartedTab } from './get-started';
import { COLOR_PICKER_DOCS_PATH, DOCS_PATH, isUnder, SITE_URL, TOASTER_DOCS_PATH } from './site';
import { AUTO_BREAKPOINT, codeText, DIRECTIONS, POSITIONS, toasterCode } from './toaster-settings';

/*
 * The documentation for agents, from the same MDX as the pages: `/llms.txt` lists
 * the pages by sidebar group, `/llms-full.txt` holds them all, `/docs/<slug>.md` is one page
 * (`/docs.md` for the Introduction). fumadocs-mdx keeps
 * the authored Markdown of each page (`includeProcessedMarkdown`); MDX components come as
 * placeholders and are expanded here into plain text and code, a `<Demos>` group is just its
 * fences, runnable fences become plain code or a link (`foldedDemos` decides which, with the
 * helpers of runnable-markdown.ts), and site links become absolute.
 */

/** One line about the kit at the top of `/llms.txt`; the site's own description lives in the root layout. */
export const LLMS_SUMMARY =
  'Cloudlet is a kit of React components on interruptible springs: engines such as the Toaster ship as npm packages (`@cloudlet/toast`), simple components such as the color picker and the color palette as source through the shadcn registry (`npx shadcn@latest add @cloudlet/<item>`).';

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
  /** Written once in npm form; pnpm add, yarn add and bun add install the same package. */
  InstallCommand: ({ attributes }) => fence('sh', text(attributes.command) ?? '', 'Terminal'),
  /** A demo block of several fences: the fences, plain code already. */
  Demos: ({ children }) => children.trim(),
  /** A live example: the code of its file, which is all of it away from the page. */
  Example: ({ attributes }) => exampleMarkdown(text(attributes.name)),
  /** The live Previews of the color picker and the color palette: their controls, as code and values. */
  PickerPreview: () => pickerPreviewMarkdown(`${SITE_URL}${COLOR_PICKER_DOCS_PATH}`),
  PalettePreview: () => palettePreviewMarkdown(`${SITE_URL}${COLOR_PICKER_DOCS_PATH}#palette`),
  /** The live Preview of the Toaster: what its controls set, as one line of code and its values. */
  ToasterPreview: () => {
    const values = (list: readonly string[]) => list.map((value) => `\`${value}\``).join(', ');
    const [auto, ...fixed] = POSITIONS;
    return [
      `Live preview at ${SITE_URL}${TOASTER_DOCS_PATH}#preview: one notification or five on the page's own Toaster, with controls for its position and direction. The code they make:`,
      fence('tsx', codeText(toasterCode({ position: 'top-right', dir: 'rtl' }))),
      [
        `- \`position\`: \`${auto}\` (the default: top centre from ${AUTO_BREAKPOINT} wide, bottom centre below), ${values(fixed)}.`,
        `- \`dir\`: ${values(DIRECTIONS.map((direction) => direction.value))}; by default the document's \`dir\`.`,
      ].join('\n'),
      'A prop at its default is left out; with every default the code is `<Toaster />`.',
    ].join('\n\n');
  },
  /** The shareable editor contract stays useful away from the interactive page. */
  StyleEditor: () => `Style editor at ${SITE_URL}${TOASTER_DOCS_PATH}/styling#style-editor: set the tokens on a live Toaster and copy the CSS. The query string carries the values — one parameter per token name without the \`--cloudlet-\` prefix (\`background\`, \`background-dark\`, \`pill-radius\`, \`font-family\`, …); dark-theme colors use the \`-dark\` suffix, and the preview follows the site theme.`,
};

/** The plain text of a heading as the TOC holds it (a string, or React nodes around one). */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/** A heading of the Markdown as text: no code marks, emphasis or links. */
const headingText = (heading: string) => heading.replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1').replace(/[`*_]/gu, '').trim();

/** The section of `page` titled `heading`, as a docs link with its anchor. */
function sectionUrl(page: DocsPage, heading: string): string {
  const item = page.data.toc.find((entry) => headingText(textOf(entry.title)) === headingText(heading));
  if (!item) throw new Error(`docs-markdown: no heading "${heading}" in the table of contents of ${page.url}`);
  return `${page.url}${item.url}`;
}

/** The Markdown body of a page with its MDX components expanded and runnable fences still marked. */
const bodies = new Map<string, Promise<string>>();
function body(page: DocsPage): Promise<string> {
  let text = bodies.get(page.url);
  if (!text) {
    text = page.data.getText('processed').then((processed) => renderPlaceholder(processed, RENDERERS));
    bodies.set(page.url, text);
  }
  return text;
}

/**
 * Demos of a page that a page under it shows too — the Examples of a component page whose guide
 * runs the same snippet — each as a line pointing to that guide's section. An agent reads the code
 * once, where the guide explains it; a demo only the component page has stays code there.
 */
async function foldedDemos(page: DocsPage): Promise<Map<string, string>> {
  const folded = new Map<string, string>();
  const below = source.getPages().filter((other) => other.url !== page.url && isUnder(other.url, page.url));
  for (const other of below) {
    for (const [id, heading] of demoSections(await body(other))) {
      if (folded.has(id) || !heading) continue;
      const label = findDemo(id)?.label;
      folded.set(id, `\`${id}\`${label ? ` (${label})` : ''}: code in [${other.data.title} › ${headingText(heading)}](${sectionUrl(other, heading)}).`);
    }
  }
  return folded;
}

/** `](/docs/…)` → `](https://…/docs/…)`: the Markdown is read away from the site. */
function absoluteLinks(markdown: string): string {
  return markdown.replace(/\]\((\/[^)\s]*)\)/gu, (_, path: string) => `](${SITE_URL}${path})`);
}

/** The Markdown address of a page: its URL plus `.md` (`/docs.md`, `/docs/components/toaster/api/toaster.md`). */
export function markdownUrl(page: DocsPage): string {
  return `${page.url}.md`;
}

/** One page as Markdown: title, description, address of the page, then the content. */
export async function pageMarkdown(page: DocsPage): Promise<string> {
  const content = runnableMarkdown(await body(page), await foldedDemos(page));
  const head = [`# ${page.data.title}`, page.data.description ? `> ${page.data.description}` : null, `Source: ${SITE_URL}${page.url}`];
  return `${head.filter(Boolean).join('\n\n')}\n\n${absoluteLinks(content).trim()}\n`;
}

/** The pages in sidebar order, grouped as in the sidebar; links outside the docs are kept as they are. */
function sidebar() {
  return groupTree(source.getPageTree().children).map((group) => ({
    name: typeof group.name === 'string' ? group.name : null,
    links: group.links.map((link) => ({ link, page: isUnder(link.url, DOCS_PATH) ? source.getPages().find((page) => page.url === link.url) : undefined })),
  }));
}

/** Every docs page in sidebar order. */
export function docsPages(): DocsPage[] {
  return sidebar().flatMap(({ links }) => links.flatMap(({ page }) => (page ? [page] : [])));
}

/** The Markdown of any documentation page by its `.md` address without the leading slash. */
export function markdownPages(): Map<string, DocsPage> {
  return new Map(source.getPages().map((page) => [markdownUrl(page).slice(1), page]));
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
  const parts = await Promise.all(docsPages().map(pageMarkdown));
  return parts.map((part) => part.trim()).join('\n\n---\n\n') + '\n';
}
