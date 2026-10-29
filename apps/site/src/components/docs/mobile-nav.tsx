'use client';

import type * as PageTree from 'fumadocs-core/page-tree';
import { Menu, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';
import { DOCS_UI } from '@/lib/docs-ui-strings';
import { findCurrent, groupTree } from './nav';
import { SearchButton } from './search';
import { SidebarNav } from './sidebar';

/**
 * Phones and tablets: a bar under the site header with the menu, the current page
 * and search; the menu opens the sidebar in a native `<dialog>` (focus trap, Escape and the
 * backdrop come from the platform, no dependency).
 */
export function MobileNav({ tree }: { tree: PageTree.Root }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  const current = useMemo(() => findCurrent(groupTree(tree.children), pathname), [tree, pathname]);
  const close = () => dialog.current?.close();

  // A route change (link in the drawer, back button) closes the drawer.
  useEffect(() => {
    dialog.current?.close();
  }, [pathname]);

  return (
    <div className="docs-mobile-bar lg:hidden">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-2 px-4 sm:px-6">
        <button type="button" className="docs-mobile-menu" onClick={() => dialog.current?.showModal()} aria-haspopup="dialog">
          <Menu className="size-4" aria-hidden="true" />
          {DOCS_UI.menu}
        </button>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" aria-hidden="true">
          {current?.name}
        </span>
        <SearchButton compact />
      </div>
      <dialog ref={dialog} className="docs-drawer" aria-label={DOCS_UI.navLabel} onClick={(event) => event.target === dialog.current && close()}>
        <div className="docs-drawer-panel">
          <div className="flex items-center justify-between gap-2">
            <SearchButton className="flex-1" onOpen={close} />
            <button type="button" className="docs-mobile-menu" onClick={close} aria-label={DOCS_UI.closeMenu}>
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <SidebarNav tree={tree} onNavigate={close} className="mt-4" />
        </div>
      </dialog>
    </div>
  );
}
