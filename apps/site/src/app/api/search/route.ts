import { createSearchAPI } from 'fumadocs-core/search/server';
import { source } from '@/lib/docs-source';

/**
 * The search index of the documentation: headings and paragraphs of every page of the kit's
 * docs, built once at build time and exported as the static file
 * `out/api/search`. The search window downloads it on the first query (`useStaticSearch`), so
 * pages load without it.
 */
export const revalidate = false;
export const { staticGET: GET } = createSearchAPI('advanced', {
  indexes: source.getPages().map((page) => ({
    id: page.url,
    url: page.url,
    title: page.data.title,
    ...(page.data.description ? { description: page.data.description } : {}),
    structuredData: page.data.structuredData,
  })),
});
