import { GITHUB_URL } from './site';

/** A file or a folder of the repository, on GitHub. */
export function repoUrl(path: string): string {
  return `${GITHUB_URL}/${path.endsWith('/') ? 'tree' : 'blob'}/main/${path.replace(/\/$/, '')}`;
}

export interface TestedClaim {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  /** Where the claim is kept: repository paths, a folder ends in `/`. */
  readonly proof: readonly { readonly label: string; readonly path: string }[];
}

/**
 * "Tested, not promised": every line is something the repository runs (tests/unit/site-kit-principles
 * checks each path and the words it rests on). No sizes.
 */
export const TESTED: readonly TestedClaim[] = [
  {
    id: 'clean-next',
    title: 'A clean Next.js app',
    text: 'Every item is added to a fresh Next.js app with the real shadcn CLI, then opened and used in a browser.',
    proof: [{ label: 'registry-check.mjs', path: 'scripts/registry-check.mjs' }],
  },
  {
    id: 'engines',
    title: 'Chromium, Firefox and WebKit',
    text: 'The Toaster’s browser suite, its npm package in fresh Next.js and Vite apps and the registry check run in all three engines.',
    proof: [
      { label: 'tests/e2e', path: 'tests/e2e/' },
      { label: 'playwright.config.ts', path: 'playwright.config.ts' },
      { label: 'fixtures/integration', path: 'fixtures/integration/' },
    ],
  },
  {
    id: 'axe',
    title: 'axe',
    text: 'axe checks the Toaster in the suite, and every color picker on the site with its panel open, in both themes.',
    proof: [
      { label: 'accessibility.spec.ts', path: 'tests/e2e/accessibility.spec.ts' },
      { label: 'audit-color-picker.mjs', path: 'apps/site/scripts/audit-color-picker.mjs' },
    ],
  },
  {
    id: 'voiceover',
    title: 'VoiceOver',
    text: 'A script walks real Safari with VoiceOver through the Toaster, the picker and the palette, and keeps what it says.',
    proof: [{ label: 'voiceover-safari-run.mjs', path: 'scripts/voiceover-safari-run.mjs' }],
  },
  {
    id: 'ci',
    title: 'On every pull request',
    text: 'The suite, the fresh apps and the registry check run in CI before anything reaches the main branch.',
    proof: [{ label: 'ci.yml', path: '.github/workflows/ci.yml' }],
  },
];
