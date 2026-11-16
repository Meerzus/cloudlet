import { createMDX } from 'fumadocs-mdx/next';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants.js';
import { fetchGitHubStars, GITHUB_API } from './scripts/github-stars.mjs';

/* Documentation content: MDX under content/docs, options in source.config.ts. */
const withMDX = createMDX();

/**
 * Static export: the landing is plain files on any static host.
 * `page.dev.tsx` routes (service stands such as /puppet-check) exist only under `next dev`
 * and in a service build for the checking scripts: `SITE_SERVICE_PAGES=1 npm run build:site`.
 */
/**
 * The header's star count, asked of GitHub once per `next build` (never by the browser) and inlined
 * as NEXT_PUBLIC_GITHUB_STARS; empty means no count. `SITE_GITHUB_STARS=128` sets it by hand (also
 * under `next dev`, where GitHub is not asked), `SITE_GITHUB_API` points the request elsewhere (a
 * dead host checks the offline build), `GITHUB_TOKEN` lifts the anonymous rate limit.
 */
async function githubStars(phase) {
  // The build loads this config more than once (its workers too); the first answer is kept.
  if (process.env.NEXT_PUBLIC_GITHUB_STARS !== undefined) return process.env.NEXT_PUBLIC_GITHUB_STARS;
  const manual = process.env.SITE_GITHUB_STARS;
  const stars = manual !== undefined
    ? (/^\d+$/.test(manual) ? Number(manual) : undefined)
    : phase === PHASE_PRODUCTION_BUILD
      ? await fetchGitHubStars({ api: process.env.SITE_GITHUB_API || GITHUB_API, token: process.env.GITHUB_TOKEN })
      : undefined;
  if (phase === PHASE_PRODUCTION_BUILD) console.log(`GitHub stars: ${stars ?? 'none'}`);
  process.env.NEXT_PUBLIC_GITHUB_STARS = stars === undefined ? '' : String(stars);
  return process.env.NEXT_PUBLIC_GITHUB_STARS;
}

export default async function config(phase) {
  const servicePages = phase === PHASE_DEVELOPMENT_SERVER || process.env.SITE_SERVICE_PAGES === '1';
  return withMDX({
    env: { NEXT_PUBLIC_GITHUB_STARS: await githubStars(phase) },
    output: 'export',
    reactStrictMode: true,
    poweredByHeader: false,
    images: { unoptimized: true },
    pageExtensions: servicePages ? ['dev.tsx', 'tsx', 'ts'] : ['tsx', 'ts'],
    // next dev otherwise writes apps/site/AGENTS.md on every start.
    agentRules: false,
  });
}
