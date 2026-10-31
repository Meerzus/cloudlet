'use client';

import { useSyncExternalStore } from 'react';
import { commandFor, isPackageManager, PACKAGE_MANAGERS, type PackageManager } from '@/lib/package-managers';
import { cn } from '@/lib/utils';
import { CopyCommand } from './copy-command';
import { SEGMENT_STYLE, useSegmentIndicator } from './use-segment-indicator';

const STORAGE_KEY = 'cloudlet-package-manager';
const CHANGE = 'cloudlet-package-manager-change';

function read(): PackageManager {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isPackageManager(stored) ? stored : 'npm';
  } catch {
    return 'npm';
  }
}

function subscribe(onChange: () => void) {
  // Other blocks on this page announce a change; other tabs change the storage.
  window.addEventListener(CHANGE, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * The reader's package manager, shared by every install command on the site and remembered in this
 * browser. The server and the first client render use npm, so hydration matches.
 */
export function usePackageManager(): readonly [PackageManager, (manager: PackageManager) => void] {
  const manager = useSyncExternalStore(subscribe, read, () => 'npm' as const);
  const choose = (next: PackageManager) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode or blocked storage: the choice still applies to this page.
    }
    window.dispatchEvent(new Event(CHANGE));
  };
  return [manager, choose];
}

/** npm / pnpm / yarn / bun as a small segmented switch with the site's sliding highlight. */
export function PackageManagerSwitch({ className }: { className?: string }) {
  const [manager, choose] = usePackageManager();
  const { group, indicator } = useSegmentIndicator(PACKAGE_MANAGERS.indexOf(manager));
  return (
    <div
      ref={group}
      role="group"
      aria-label="Package manager"
      style={SEGMENT_STYLE}
      className={cn('relative flex w-fit rounded-full border border-glass-border bg-background/40 p-0.5', className)}
    >
      <span ref={indicator} aria-hidden="true" className="segment-indicator inset-y-0.5 bg-foreground/10" />
      {PACKAGE_MANAGERS.map((item) => (
        <button
          key={item}
          type="button"
          data-segment=""
          aria-pressed={item === manager}
          onClick={() => choose(item)}
          className={cn(
            'relative h-7 rounded-full px-3 font-mono text-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60',
            item === manager ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

/** An npm-form command (`npm install …`, `npx …`) shown and copied in the reader's package manager. */
export function PackageManagerCommand({ command, className }: { command: string; className?: string }) {
  const [manager] = usePackageManager();
  return (
    <div className={cn('flex flex-col items-start gap-3', className)}>
      <PackageManagerSwitch />
      <CopyCommand command={commandFor(command, manager)} className="max-w-full" />
    </div>
  );
}
