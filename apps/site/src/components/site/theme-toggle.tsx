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

export function ThemeToggle({ className }: { className?: string }) {
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
          className="relative grid size-8 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60 aria-pressed:text-foreground max-sm:size-7"
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
