'use client';

import { Search } from 'lucide-react';
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DOCS_UI } from '@/lib/docs-ui-strings';
import { cn } from '@/lib/utils';

/*
 * Search of the documentation. The provider lives in the docs shell only, so the
 * button and the shortcuts exist on `/docs/*` and nowhere else (not on the landing or the
 * Playground). The window is a separate chunk, loaded when it first opens (or when the pointer
 * or focus reaches the button); the index is downloaded by the window on the first query.
 */

const loadWindow = () => import('./search-dialog');
const SearchDialog = lazy(loadWindow);

const SearchContext = createContext<{ open: () => void } | null>(null);

/** Typing targets keep their `/`: the shortcut only works outside fields. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Mounted once opened, then kept: the index and the last query survive closing.
  const [mounted, setMounted] = useState(false);
  const show = useCallback(() => {
    setMounted(true);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setMounted(true);
        setOpen((value) => !value);
        return;
      }
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditable(event.target)) {
        event.preventDefault();
        show();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [show]);

  return (
    <SearchContext value={{ open: show }}>
      {children}
      {mounted ? (
        <Suspense fallback={null}>
          <SearchDialog open={open} onOpenChange={setOpen} />
        </Suspense>
      ) : null}
    </SearchContext>
  );
}

const noop = () => () => {};
const isApple = () => /mac|iphone|ipad|ipod/iu.test(navigator.platform || navigator.userAgent);

/** ⌘K on Apple platforms, Ctrl K elsewhere; the server and the first render say ⌘K. */
function useShortcutLabel(): string {
  const apple = useSyncExternalStore(noop, isApple, () => true);
  return apple ? DOCS_UI.searchShortcutMac : DOCS_UI.searchShortcutOther;
}

/** The search entry: on top of the sidebar, in the phone bar and in the drawer. */
export function SearchButton({ className, compact = false, onOpen }: { className?: string; compact?: boolean; onOpen?: () => void }) {
  const search = useContext(SearchContext);
  const shortcut = useShortcutLabel();
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={compact ? DOCS_UI.search : undefined}
      aria-keyshortcuts="Meta+K Control+K /"
      onPointerEnter={() => void loadWindow()}
      onFocus={() => void loadWindow()}
      onClick={() => {
        onOpen?.();
        search?.open();
      }}
      className={cn('docs-search', compact && 'docs-search-compact', className)}
    >
      <Search className="size-4" aria-hidden="true" />
      {compact ? null : (
        <>
          <span className="flex-1 text-left">{DOCS_UI.search}</span>
          <kbd aria-hidden="true">{shortcut}</kbd>
        </>
      )}
    </button>
  );
}
