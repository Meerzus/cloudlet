'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { SEGMENT_STYLE, useSegmentIndicator } from './use-segment-indicator';
import { COMPONENTS, type SiteComponent } from '@/lib/site';

/** The components with a landing of their own; the palette is a section of the color picker's. */
const LANDINGS = COMPONENTS.filter((component) => component.id !== 'color-palette');
/** The name on the narrowest phones, where the header has no room for the full one. */
const SHORT: Partial<Record<SiteComponent['id'], string>> = { 'color-picker': 'Picker' };

/**
 * Toaster · Color picker in the header (COLOR_PICKER §8.1): a link to each component's landing, the
 * current one marked with `aria-current` and the site's sliding highlight.
 */
export function ComponentSwitch({ current, className }: { current: SiteComponent; className?: string }) {
  const active = LANDINGS.findIndex((component) => component.id === current.id);
  const { group, indicator } = useSegmentIndicator<HTMLElement>(active);
  return (
    <nav
      ref={group}
      aria-label="Components"
      style={SEGMENT_STYLE}
      className={cn('relative flex rounded-full border border-glass-border bg-background/40 p-0.5', className)}
    >
      <span ref={indicator} aria-hidden="true" className="segment-indicator inset-y-0.5 bg-background shadow-sm dark:bg-white/15 dark:shadow-none" />
      {LANDINGS.map((component) => (
        <Link
          key={component.id}
          href={component.path}
          data-segment=""
          // The full name on every width; the short one on narrow phones is its visible end ("Picker" in "Color picker").
          aria-label={component.name}
          aria-current={component.id === current.id ? 'page' : undefined}
          className={cn(
            'relative whitespace-nowrap rounded-full px-3 py-1 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60 max-sm:px-2.5',
            component.id === current.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {/* Below 380 px the header cannot fit the full names next to Docs and the theme. */}
          <span className="max-[379px]:hidden">{component.name}</span>
          <span className="hidden max-[379px]:inline">{SHORT[component.id] ?? component.name}</span>
        </Link>
      ))}
    </nav>
  );
}
