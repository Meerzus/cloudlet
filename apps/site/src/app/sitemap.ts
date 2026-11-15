import type { MetadataRoute } from 'next';
import { source } from '@/lib/docs-source';
import { pickerSource } from '@/lib/picker-docs-source';
import { COLOR_PICKER_PATH, PLAYGROUND_PATH, SITE_URL, TOASTER_PATH } from '@/lib/site';

/** `/sitemap.xml`, a static file of the export: both landings, the Playground and every docs page. */
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [TOASTER_PATH, PLAYGROUND_PATH, ...source.getPages().map((page) => page.url), COLOR_PICKER_PATH, ...pickerSource.getPages().map((page) => page.url)];
  return paths.map((path) => ({ url: `${SITE_URL}${path}` }));
}
