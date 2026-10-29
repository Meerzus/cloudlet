'use client';

import type * as PageTree from 'fumadocs-core/page-tree';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { DOCS_UI } from '@/lib/docs-ui-strings';
import { DOCS_PATH } from '@/lib/site';
import { cn } from '@/lib/utils';
import { groupTree, normalizePath } from './nav';

/**
 * Sidebar links from the page tree: groups by separator, the current page marked
 * with `aria-current`. The same list renders in the desktop column and in the phone drawer.
 */
export function SidebarNav({ tree, onNavigate, className }: { tree: PageTree.Root; onNavigate?: () => void; className?: string }) {
  const pathname = normalizePath(usePathname());
  const groups = useMemo(() => groupTree(tree.children), [tree]);
  return (
    <nav aria-label={DOCS_UI.navLabel} className={cn('docs-nav', className)}>
      {groups.map((group, index) => (
        <div key={index} className="docs-nav-group">
          {group.name ? <p className="docs-nav-heading">{group.name}</p> : null}
          <ul>
            {group.links.map((link) => {
              const active = link.url === pathname;
              return (
                <li key={link.url}>
                  <Link
                    href={link.url}
                    aria-current={active ? 'page' : undefined}
                    {...(onNavigate ? { onClick: onNavigate } : {})}
                    className={cn('docs-nav-link', active && 'docs-nav-link-active')}
                  >
                    <span>{link.name}</span>
                    {link.external || !link.url.startsWith(DOCS_PATH) ? (
                      <ArrowUpRight className="size-3.5 opacity-60" aria-hidden="true" />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
