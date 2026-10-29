'use client';

import { useHighlightQuery, useStaticSearch, type SearchResultItem, type SearchResultRecord } from 'fumadocs-core/search/client';
import { AlignLeft, FileText, Hash, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Fragment, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DOCS_UI } from '@/lib/docs-ui-strings';
import { cn } from '@/lib/utils';

interface Group {
  readonly page: SearchResultRecord;
  readonly entries: SearchResultRecord[];
}

/**
 * The engine returns each matching page followed by its matching headings and paragraphs (table
 * rows come as tables); the window shows them as groups "page → section". Every record is one
 * option of the list, in this order.
 */
function toGroups(items: readonly SearchResultItem[]): Group[] {
  const groups: Group[] = [];
  for (const item of items) {
    const records = 'type' in item && item.type === 'table' ? item.rows : [item as SearchResultRecord];
    for (const record of records) {
      if (record.type === 'page') groups.push({ page: record, entries: [] });
      else groups.at(-1)?.entries.push(record);
    }
  }
  return groups;
}

/** The part of a hast node the results read (the parsed Markdown of `hastContent`). */
interface HastNode {
  readonly type: string;
  readonly value?: string;
  readonly tagName?: string;
  readonly children?: readonly HastNode[];
}

/**
 * The record's content as inline text: code spans and emphasis stay, links and blocks do not.
 * A table row comes as a table with its header; only the row's cells are shown, joined by "·".
 */
function Inline({ nodes }: { nodes: readonly HastNode[] }): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === 'text') return node.value;
    if (node.type !== 'element' || node.tagName === 'thead') return null;
    if (node.tagName === 'tr') {
      const cells = (node.children ?? []).filter((cell) => cell.type === 'element');
      return (
        <Fragment key={index}>
          {cells.map((cell, at) => (
            <Fragment key={at}>
              {at > 0 ? ' · ' : null}
              <Inline nodes={cell.children ?? []} />
            </Fragment>
          ))}
        </Fragment>
      );
    }
    const children = <Inline nodes={node.children ?? []} />;
    if (node.tagName === 'code') return <code key={index}>{children}</code>;
    if (node.tagName === 'strong') return <strong key={index}>{children}</strong>;
    if (node.tagName === 'em') return <em key={index}>{children}</em>;
    return <Fragment key={index}>{children} </Fragment>;
  });
}

/** The sidebar group of a page ("Guides"); the tree's root name is the same for every page. */
function crumbs(record: SearchResultRecord): string {
  return (record.breadcrumbs ?? []).slice(1).join(' / ');
}

const ICONS = { page: FileText, heading: Hash, text: AlignLeft } as const;

export default function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { search, onSearchChange, isLoading, data, error } = useStaticSearch({ delayMs: 100 });
  const [active, setActive] = useState(0);
  const listId = useId();
  const optionId = (index: number) => `${listId}-${index}`;

  const query = search.trim();
  const groups = useMemo(() => (query && data ? toGroups(data.items) : []), [query, data]);
  const options = useMemo(() => groups.flatMap((group) => [group.page, ...group.entries]), [groups]);
  const highlight = useHighlightQuery(data?.query ?? '');
  const current = Math.min(active, Math.max(options.length - 1, 0));

  const choose = (record: SearchResultRecord | undefined) => {
    if (!record) return;
    onOpenChange(false);
    router.push(record.url);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (options.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = (current + step + options.length) % options.length;
      setActive(next);
      document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(options[current]);
    }
  };

  let status: ReactNode = null;
  if (!query) status = <p>{DOCS_UI.searchHint}</p>;
  else if (error) status = <p>{DOCS_UI.searchError}</p>;
  else if (!data || (isLoading && options.length === 0)) status = <p>{DOCS_UI.searchLoading}</p>;
  else if (options.length === 0)
    status = (
      <>
        <p>
          {DOCS_UI.searchNoResults} “<span className="text-foreground">{query}</span>”.
        </p>
        <p>{DOCS_UI.searchNoResultsHint}</p>
      </>
    );

  let index = -1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="docs-search-dialog">
        <DialogTitle className="sr-only">{DOCS_UI.searchTitle}</DialogTitle>
        <DialogDescription className="sr-only">{DOCS_UI.searchHint}</DialogDescription>
        <div className="docs-search-field">
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <input
            data-autofocus
            type="text"
            inputMode="search"
            role="combobox"
            aria-label={DOCS_UI.searchTitle}
            aria-autocomplete="list"
            aria-expanded={options.length > 0}
            aria-controls={listId}
            aria-activedescendant={options.length > 0 ? optionId(current) : undefined}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder={DOCS_UI.searchPlaceholder}
            value={search}
            onChange={(event) => {
              onSearchChange(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <button type="button" className="docs-search-close" aria-label={DOCS_UI.closeSearch} onClick={() => onOpenChange(false)}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="docs-search-body">
          {status ? <div className="docs-search-status">{status}</div> : null}
          <div key={data?.query} ref={highlight} id={listId} role="listbox" aria-label={DOCS_UI.searchResults} hidden={options.length === 0}>
            {groups.map((group) => {
              const pageIndex = ++index;
              const headingId = `${optionId(pageIndex)}-group`;
              return (
                <div key={group.page.id} role="group" aria-labelledby={headingId} className="docs-search-group">
                  <Option id={optionId(pageIndex)} record={group.page} active={pageIndex === current} onHover={() => setActive(pageIndex)} onChoose={choose}>
                    <span id={headingId} className="docs-search-page">
                      {group.page.content}
                    </span>
                    {crumbs(group.page) ? (
                      <span className="docs-search-crumbs" data-highlight-ignore>
                        {crumbs(group.page)}
                      </span>
                    ) : null}
                  </Option>
                  {group.entries.map((record) => {
                    const own = ++index;
                    return (
                      <Option key={record.id} id={optionId(own)} record={record} active={own === current} onHover={() => setActive(own)} onChoose={choose} nested>
                        <span className="docs-search-text">
                          <Inline nodes={record.hastContent.children} />
                        </span>
                      </Option>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {/* Polite count for screen readers; the list itself is announced through the combobox. */}
          <p role="status" className="sr-only">
            {query && data && !isLoading ? DOCS_UI.searchCount(options.length) : ''}
          </p>
        </div>
        <div className="docs-search-footer" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {DOCS_UI.searchKeys.move}
          </span>
          <span>
            <kbd>↵</kbd> {DOCS_UI.searchKeys.open}
          </span>
          <span>
            <kbd>Esc</kbd> {DOCS_UI.searchKeys.close}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Option({
  id,
  record,
  active,
  nested = false,
  onHover,
  onChoose,
  children,
}: {
  id: string;
  record: SearchResultRecord;
  active: boolean;
  nested?: boolean;
  onHover: () => void;
  onChoose: (record: SearchResultRecord) => void;
  children: ReactNode;
}) {
  const Icon = ICONS[record.type];
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-type={record.type}
      className={cn('docs-search-option', nested && 'docs-search-option-nested')}
      onPointerMove={onHover}
      onClick={() => onChoose(record)}
    >
      <Icon className="docs-search-icon" aria-hidden="true" />
      {children}
    </div>
  );
}
