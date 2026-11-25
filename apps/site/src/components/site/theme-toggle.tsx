'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ThemePreference } from '@/lib/theme';
import { useTheme } from './theme';
import { SEGMENT_STYLE, useSegmentIndicator } from './use-segment-indicator';

const OPTIONS: readonly { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'system', label: 'System theme', Icon: Monitor },
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
];

/** Below 640 px the three segments don't fit beside Components, Docs and Star: one button cycles them. */
export function ThemeToggle({ className }: { className?: string }) {
  return (
    <>
      <ThemeCycle className={cn('sm:hidden', className)} />
      <ThemeSegments className={cn('max-sm:hidden', className)} />
    </>
  );
}

/**
 * System → Light → Dark → System. The icon follows `<html data-theme>`, which the head script sets
 * before first paint, so the server-rendered button already shows the stored theme; the label says
 * the current theme and the next one.
 */
function ThemeCycle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  const index = OPTIONS.findIndex(({ value }) => value === preference);
  const current = OPTIONS[index]!;
  const next = OPTIONS[(index + 1) % OPTIONS.length]!;
  return (
    <button
      type="button"
      aria-label={`${current.label}, switch to ${next.label.toLowerCase()}`}
      onClick={() => setPreference(next.value)}
      className={cn(
        'theme-cycle relative grid size-9 place-items-center rounded-full border border-glass-border bg-background/40 text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/60',
        className,
      )}
    >
      {OPTIONS.map(({ value, Icon }) => (
        <Icon key={value} data-theme-icon={value} className="size-4" aria-hidden="true" />
      ))}
    </button>
  );
}

function ThemeSegments({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  const { group, indicator } = useSegmentIndicator(OPTIONS.findIndex(({ value }) => value === preference));
  return (
    <div
      ref={group}
      role="group"
      aria-label="Theme"
      style={SEGMENT_STYLE}
      className={cn('relative flex items-center rounded-full border border-glass-border bg-background/40 p-0.5', className)}
    >
      {/* Light: a white pill on the glass. Dark: the background colour would vanish, so a moonlit tint. */}
      <span
        ref={indicator}
        aria-hidden="true"
        className="segment-indicator inset-y-0.5 bg-background shadow-sm dark:bg-white/15 dark:shadow-none dark:ring-1 dark:ring-white/10"
      />
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          data-segment=""
          aria-label={label}
          aria-pressed={preference === value}
          onClick={() => setPreference(value)}
          className="relative grid size-8 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60 aria-pressed:text-foreground"
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
