'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { COMPONENTS, componentOf, docsPathOf, GITHUB_URL, PLAYGROUND_PATH } from '@/lib/site';
import { Button } from '@/components/ui/button';
import { ComponentSwitch } from './component-switch';
import { EdgeBlur } from './edge-blur';
import { ExternalLink } from './external-link';
import { CloudletIcon, GitHubMark } from './icons';
import { ThemeToggle } from './theme-toggle';

/**
 * No backdrop of its own: the page blurs progressively under the top edge (`.site-edge`, z-40,
 * with a faint background tint) and the header sits on it (z-50). The logo, Docs and Playground
 * follow the component of the page (Toaster or Color picker), which the switch next to the logo picks.
 * The kit's own pages keep the Toaster's logo, switch and Playground, but Docs leads to the docs of
 * the whole kit.
 */
export function Header() {
  const pathname = usePathname();
  const component = componentOf(pathname) ?? COMPONENTS[0]!;
  return (
    <>
      <EdgeBlur edge="top" height="min(7rem, 10svh)" className="site-edge z-40">
        <div className="site-edge-tint" />
      </EdgeBlur>
      <header className="site-header sticky top-0 z-50">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
          <Link
            href={component.path}
            className="flex items-center gap-2 rounded-full font-semibold tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 max-[379px]:hidden"
          >
            <CloudletIcon idPrefix="header-icon" className="size-7" />
            {/* Phones: the switch, Docs and the theme need the width; the icon carries the name, and below 380 px the switch does. */}
            <span className="max-md:sr-only">Cloudlet</span>
          </Link>
          <ComponentSwitch current={component} className="mr-auto" />
          <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={docsPathOf(pathname)}>Docs</Link>
            </Button>
            {component.id === 'toaster' ? (
              <Button asChild variant="ghost" size="sm" className="max-sm:hidden">
                <Link href={PLAYGROUND_PATH}>Playground</Link>
              </Button>
            ) : null}
            <ThemeToggle />
            <Button asChild variant="ghost" size="icon" className="max-sm:hidden">
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
