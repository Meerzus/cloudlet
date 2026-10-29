import type { MetadataRoute } from 'next';
import { source } from '@/lib/docs-source';
import { PLAYGROUND_PATH, SITE_URL, TOASTER_PATH } from '@/lib/site';

/** `/sitemap.xml`, a static file of the export: the landing, the Playground and every docs page. */
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [TOASTER_PATH, PLAYGROUND_PATH, ...source.getPages().map((page) => page.url)];
  return paths.map((path) => ({ url: `${SITE_URL}${path}` }));
}
