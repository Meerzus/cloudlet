import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '@/lib/docs-source';

/**
 * The search index of the documentation (DOCS.md §8): headings and paragraphs of every page,
 * built once at build time and exported as the static file `out/api/search`. The search window
 * downloads it on the first query (`useStaticSearch`), so pages load without it.
 */
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);
