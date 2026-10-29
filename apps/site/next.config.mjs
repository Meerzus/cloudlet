import { createMDX } from 'fumadocs-mdx/next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/* Documentation content (DOCS.md §1): MDX under content/docs, options in source.config.ts. */
const withMDX = createMDX();

/**
 * Static export: the landing is plain files on any static host (LANDING §1).
 * `page.dev.tsx` routes (service stands such as /puppet-check) exist only under `next dev`
 * and in a service build for the checking scripts: `SITE_SERVICE_PAGES=1 npm run build:site`.
 */
export default function config(phase) {
  const servicePages = phase === PHASE_DEVELOPMENT_SERVER || process.env.SITE_SERVICE_PAGES === '1';
  return withMDX({
    output: 'export',
    reactStrictMode: true,
    poweredByHeader: false,
    images: { unoptimized: true },
    pageExtensions: servicePages ? ['dev.tsx', 'tsx', 'ts'] : ['tsx', 'ts'],
    // next dev otherwise writes apps/site/AGENTS.md on every start.
    agentRules: false,
  });
}
