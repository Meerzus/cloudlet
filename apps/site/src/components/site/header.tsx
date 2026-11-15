'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { docsPathOf } from '@/lib/site';
import { BUILD_STARS } from '@/lib/stars';
import { Button } from '@/components/ui/button';
import { ComponentsMenu } from './components-menu';
import { EdgeBlur } from './edge-blur';
import { CloudletIcon } from './icons';
import { StarButton } from './star-button';
import { ThemeToggle } from './theme-toggle';

/**
 * No backdrop of its own: the page blurs progressively under the top edge (`.site-edge`, z-40,
 * with a faint background tint) and the header sits on it (z-50). The logo leads to the kit's own
 * page, Components opens the list of the kit's components, and Docs leads to the docs of the page's
 * component, or of the whole kit from the kit's own pages; Star leads to the repository, with the
 * star count the build read from GitHub.
 */
export function Header({ stars = BUILD_STARS }: { stars?: number | undefined } = {}) {
  const pathname = usePathname();
  return (
    <>
      <EdgeBlur edge="top" height="min(7rem, 10svh)" className="site-edge z-40">
        <div className="site-edge-tint" />
      </EdgeBlur>
      <header className="site-header sticky top-0 z-50">
        {/*
          Below 23.75rem (380 px at the default text size, wider under a larger system font, since
          rem media queries follow it) the gaps tighten. Text too large for one line wraps the
          nav onto a second line instead of pushing it off the screen.
        */}
        <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center gap-x-2 px-4 max-[23.75rem]:gap-x-1 max-[23.75rem]:px-3 sm:gap-x-3 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-full font-semibold tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
          >
            <CloudletIcon idPrefix="header-icon" className="size-7" />
            {/* Phones: Components, Docs, the theme and Star need the width; the icon carries the name. */}
            <span className="max-md:sr-only">Cloudlet</span>
          </Link>
          <ComponentsMenu className="mr-auto" />
          <nav aria-label="Primary" className="ml-auto flex items-center gap-1 sm:gap-2">
            <Button asChild variant="ghost" size="sm" className="max-[23.75rem]:px-2">
              <Link href={docsPathOf(pathname)}>Docs</Link>
            </Button>
            <ThemeToggle />
            <StarButton stars={stars} />
          </nav>
        </div>
      </header>
    </>
  );
}
