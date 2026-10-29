import type * as PageTree from 'fumadocs-core/page-tree';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { DOCS_UI } from '@/lib/docs-ui-strings';

/** Previous / Next at the end of a page, in sidebar order. */
export function PageNav({ previous, next }: { previous?: PageTree.Item | undefined; next?: PageTree.Item | undefined }) {
  if (!previous && !next) return null;
  return (
    <nav className="docs-page-nav" aria-label={`${DOCS_UI.previous} / ${DOCS_UI.next}`}>
      {previous ? (
        <Link href={previous.url} rel="prev" className="docs-page-nav-link">
          <span className="docs-page-nav-label">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {DOCS_UI.previous}
          </span>
          <span className="docs-page-nav-name">{previous.name}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={next.url} rel="next" className="docs-page-nav-link docs-page-nav-next">
          <span className="docs-page-nav-label">
            {DOCS_UI.next}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </span>
          <span className="docs-page-nav-name">{next.name}</span>
        </Link>
      ) : null}
    </nav>
  );
}
