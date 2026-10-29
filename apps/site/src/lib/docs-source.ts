import { loader } from 'fumadocs-core/source';
import { defineDocs } from 'fumadocs-mdx/macro';
import { DOCS_PATH } from './site';

/**
 * The documentation's content source: MDX pages under
 * `content/docs/en`, English without a URL prefix. A future language adds a sibling folder
 * and a `[lang]` segment; the page tree, slugs and order come from `meta.json` files.
 *
 * `defineDocs` is a compile-time macro of fumadocs-mdx: the bundler turns it into imports of
 * the content files, so there is no generated `.source` folder to check in.
 */
const docs = defineDocs({
  dir: 'content/docs/en',
  docs: {
    // The Markdown of each page for agents, `page.data.getText('processed')`; the
    // MDX components stay placeholders that `docs-markdown.ts` expands into text and code.
    postprocess: {
      includeProcessedMarkdown: { headingIds: false, mdxAsPlaceholder: ['Callout', 'GetStartedTabs', 'GetStartedCode', 'Demos', 'StyleEditor'] },
    },
  },
});

export const source = loader({ baseUrl: DOCS_PATH, source: docs.toFumadocsSource() });

export type DocsPage = NonNullable<ReturnType<typeof source.getPage>>;
