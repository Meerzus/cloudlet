'use client';

import { AnchorProvider, TOCItem, type TOCItemType, useActiveAnchors } from 'fumadocs-core/toc';
import { ChevronDown } from 'lucide-react';
import { type MouseEvent, type ReactNode, type RefObject, useEffect, useRef } from 'react';
import { DOCS_UI } from '@/lib/docs-ui-strings';

/** Tracks which heading is on screen for every TOC on the page; wraps the article and the aside. */
export function TocProvider({ toc, children }: { toc: TOCItemType[]; children: ReactNode }) {
  return <AnchorProvider toc={toc}>{children}</AnchorProvider>;
}

/** Scrolls the heading into view instead of jumping, then records the hash like a plain anchor would. */
function scrollToHeading(event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const href = event.currentTarget.getAttribute('href');
  if (!href?.startsWith('#')) return;
  const target = document.getElementById(decodeURIComponent(href.slice(1)));
  if (!target) return;
  event.preventDefault();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
  history.pushState(null, '', href);
}

/** The bar on the list's left rule: it spans the active items and glides when they change. */
function TocThumb({ listRef }: { listRef: RefObject<HTMLUListElement | null> }) {
  const active = useActiveAnchors();
  const thumbRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const list = listRef.current;
    const thumb = thumbRef.current;
    if (!list || !thumb) return;

    const update = () => {
      let top = Number.MAX_VALUE;
      let bottom = 0;
      for (const id of active) {
        const item = list.querySelector<HTMLAnchorElement>(`a[href="#${CSS.escape(id)}"]`);
        if (!item) continue;
        top = Math.min(top, item.offsetTop);
        bottom = Math.max(bottom, item.offsetTop + item.offsetHeight);
      }
      const visible = bottom > top;
      thumb.style.setProperty('--docs-toc-thumb-top', `${visible ? top : 0}px`);
      thumb.style.setProperty('--docs-toc-thumb-height', `${visible ? bottom - top : 0}px`);
      thumb.dataset.visible = String(visible);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(list);
    return () => observer.disconnect();
  }, [active, listRef]);

  return <li ref={thumbRef} className="docs-toc-thumb" aria-hidden="true" />;
}

function TocList({ toc }: { toc: TOCItemType[] }) {
  const listRef = useRef<HTMLUListElement>(null);
  return (
    <ul ref={listRef} className="docs-toc-list">
      <TocThumb listRef={listRef} />
      {toc
        .filter((item) => item.depth >= 2 && item.depth <= 3)
        .map((item) => (
          <li key={item.url} data-depth={item.depth}>
            <TOCItem href={item.url} className="docs-toc-item" onClick={scrollToHeading}>
              {item.title}
            </TOCItem>
          </li>
        ))}
    </ul>
  );
}

/** The right column from `xl` up (DOCS.md §7). */
export function DesktopToc({ toc }: { toc: TOCItemType[] }) {
  if (toc.length === 0) return <div className="hidden xl:block" aria-hidden="true" />;
  return (
    <aside className="docs-toc hidden xl:block" aria-label={DOCS_UI.onThisPage}>
      <p className="docs-toc-title">{DOCS_UI.onThisPage}</p>
      <TocList toc={toc} />
    </aside>
  );
}

/** Below `xl`: a disclosure above the text instead of a column. */
export function MobileToc({ toc }: { toc: TOCItemType[] }) {
  if (toc.length === 0) return null;
  return (
    <details className="docs-toc-mobile xl:hidden">
      <summary>
        {DOCS_UI.onThisPage}
        <ChevronDown className="size-4" aria-hidden="true" />
      </summary>
      <TocList toc={toc} />
    </details>
  );
}
