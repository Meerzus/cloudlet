import type * as PageTree from 'fumadocs-core/page-tree';
import type { ReactNode } from 'react';
import { FooterSlim } from '@/components/site/footer-slim';
import { MobileNav } from './mobile-nav';
import { SearchButton, SearchProvider } from './search';
import { SidebarNav } from './sidebar';

/**
 * The quiet shell of `/docs/*`: no sky, no Lenis, no cloud footer. A sticky
 * sidebar on the left from `lg`, the page in the middle, its table of contents on the right
 * from `xl` (the page renders that column itself), and the one-line footer. Search and its
 * shortcuts belong to this shell only.
 */
export function DocsShell({ tree, children }: { tree: PageTree.Root; children: ReactNode }) {
  return (
    <SearchProvider>
      <div className="docs-shell">
        <MobileNav tree={tree} />
        <div className="docs-grid mx-auto max-w-6xl px-4 sm:px-6">
          <aside className="docs-sidebar hidden lg:block">
            <SearchButton className="mb-5" />
            <SidebarNav tree={tree} />
          </aside>
          {children}
        </div>
        <FooterSlim />
      </div>
    </SearchProvider>
  );
}
