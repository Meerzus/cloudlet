import Link from 'next/link';
import { DOCS_PATH, GITHUB_URL, PLAYGROUND_PATH, TOASTER_PATH } from '@/lib/site';
import { Button } from '@/components/ui/button';
import { EdgeBlur } from './edge-blur';
import { ExternalLink } from './external-link';
import { CloudletIcon, GitHubMark } from './icons';
import { ThemeToggle } from './theme-toggle';

/**
 * No backdrop of its own: the page blurs progressively under the top edge (`.site-edge`, z-40,
 * with a faint background tint) and the header sits on it (z-50).
 */
export function Header() {
  return (
    <>
      <EdgeBlur edge="top" height="min(7rem, 10svh)" className="site-edge z-40">
        <div className="site-edge-tint" />
      </EdgeBlur>
      <header className="site-header sticky top-0 z-50">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Link
            href={TOASTER_PATH}
            className="mr-auto flex items-center gap-2 rounded-full font-semibold tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
          >
            <CloudletIcon idPrefix="header-icon" className="size-7" />
            {/* Phones: Docs, Playground, the theme and GitHub need the width; the icon carries the name. */}
            <span className="max-sm:sr-only">Cloudlet</span>
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={DOCS_PATH}>Docs</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={PLAYGROUND_PATH}>Playground</Link>
            </Button>
            <ThemeToggle />
            <Button asChild variant="ghost" size="icon">
              <ExternalLink href={GITHUB_URL} aria-label="Cloudlet on GitHub">
                <GitHubMark className="size-5" />
              </ExternalLink>
            </Button>
          </nav>
        </div>
      </header>
    </>
  );
}
