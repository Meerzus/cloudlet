import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/** `/robots.txt`, a static file of the export: everything is open, the sitemap lists the pages. */
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', allow: '/' }, sitemap: `${SITE_URL}/sitemap.xml` };
}
