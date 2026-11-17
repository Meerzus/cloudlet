import type { MetadataRoute } from 'next';
import { docsPages } from '@/lib/docs-markdown';
import { COLOR_PICKER_PATH, KIT_PATH, PLAYGROUND_PATH, SITE_URL, TOASTER_PATH } from '@/lib/site';

/** `/sitemap.xml`, a static file of the export: the kit's landing first, the components' landings, the Playground and every docs page in sidebar order. */
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [KIT_PATH, TOASTER_PATH, PLAYGROUND_PATH, COLOR_PICKER_PATH, ...docsPages().map((page) => page.url)];
  return paths.map((path) => ({ url: `${SITE_URL}${path}` }));
}
