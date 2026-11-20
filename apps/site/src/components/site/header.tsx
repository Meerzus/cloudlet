'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ComponentProps } from 'react';
import { docsPathOf } from '@/lib/site';
import { BUILD_STARS } from '@/lib/stars';
import { Button } from '@/components/ui/button';
import { ComponentsMenu } from './components-menu';
import { EdgeBlur } from './edge-blur';
import { CloudletIcon } from './icons';
import { StarButton } from './star-button';
import { ThemeToggle } from './theme-toggle';

/**
 * A header link that prefetches its page when the visitor shows intent (pointer over it, focus,
 * touch) rather than as soon as it is on screen. The header is on screen on every page, and a
 * prefetch of another section's route makes Next preload that route's CSS: the kit's hero and the
 * color picker on the docs and the landings, where it then sits unused (Chrome warns about every
 * such preload a few seconds after load). On intent the page and its CSS are fetched while the
 * pointer travels to the click, so the move stays as quick.
 */
function IntentLink({ href, onPointerEnter, onFocus, onTouchStart, ...props }: Omit<ComponentProps<typeof Link>, 'href' | 'prefetch'> & { href: string }) {
  const router = useRouter();
  const prefetch = () => router.prefetch(href);
  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
      onPointerEnter={(event) => {
        prefetch();
        onPointerEnter?.(event);
      }}
      onFocus={(event) => {
        prefetch();
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        prefetch();
        onTouchStart?.(event);
      }}
    />
  );
}

/**
 * No backdrop of its own: the page blurs progressively under the top edge (`.site-edge`, z-40,
 * with a faint background tint) and the header sits on it (z-50). The logo leads to the kit's own
 * page, Components opens the list of the kit's components, and Docs leads to the docs of the page's
 * component, or of the whole kit from the kit's own pages; Star leads to the repository, with the
 * star count the build read from GitHub. The logo and Docs prefetch on intent (`IntentLink`).
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
          <IntentLink
            href="/"
            className="flex items-center gap-2 rounded-full font-semibold tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
          >
            <CloudletIcon idPrefix="header-icon" className="size-7" />
            {/* Phones: Components, Docs, the theme and Star need the width; the icon carries the name. */}
            <span className="max-md:sr-only">Cloudlet</span>
          </IntentLink>
          <ComponentsMenu className="mr-auto" />
          <nav aria-label="Primary" className="ml-auto flex items-center gap-1 max-[23.75rem]:gap-0.5 sm:gap-2">
            <Button asChild variant="ghost" size="sm" className="max-[23.75rem]:px-2">
              <IntentLink href={docsPathOf(pathname)}>Docs</IntentLink>
            </Button>
            <ThemeToggle />
            <StarButton stars={stars} />
          </nav>
        </div>
      </header>
    </>
  );
}
