'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useCopy, usePageNotifications } from '@/components/site/notifications';
import { findDemo, isCodeLabel, type Demo } from '@/lib/demos';
import { DOCS_UI } from '@/lib/docs-ui-strings';
import { cn } from '@/lib/utils';

/** A snippet longer than this many lines starts folded under Show code. */
export const DEMO_FOLD_LINES = 8;
/** The code area's height glides between snippets and when it unfolds. */
const RESIZE_MS = 280;
const RESIZE_EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

/** One runnable fence of a demo block: the catalog id and its highlighted code. */
export interface DemoItem {
  readonly id: string;
  /** The `<code>` Shiki rendered at build time for the fence. */
  readonly code: ReactNode;
  /** Shiki's classes on the `<pre>`. */
  readonly className?: string | undefined;
}

interface Entry extends DemoItem {
  readonly demo: Demo;
  readonly folds: boolean;
}

function entries(items: readonly DemoItem[]): Entry[] {
  return items.map((item) => {
    const demo = findDemo(item.id);
    // site-docs-demos.test.ts guards this too; failing the build beats a block without its button.
    if (!demo) throw new Error(`Unknown demo "${item.id}" in a documentation demo block`);
    return { ...item, demo, folds: demo.snippet.split('\n').length > DEMO_FOLD_LINES };
  });
}

/**
 * The documentation's runnable example, after shadcn's Sonner page: a stage with a
 * button per demo above the code. A button calls its catalog entry on the site's page-level
 * controller, so the notification lands in the page's own Toaster, and in a group it also
 * selects the snippet shown below. Copy reads the rendered text of the shown `<pre>`. A long
 * snippet starts folded under Show code. Height changes glide; reduced motion snaps.
 */
export function DemoBlock({ items, note = false }: { items: readonly DemoItem[]; note?: boolean }) {
  const list = entries(items);
  const controller = usePageNotifications();
  const copy = useCopy({ toast: false });
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const settle = useRef<() => void>(() => {});
  const group = list.length > 1;
  const current = list[selected] ?? list[0]!;
  const folded = current.folds && !expanded;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => () => settle.current(), []);

  /** Applies a state change and glides the code area from its height before to its height after. */
  const resize = (change: () => void) => {
    const wrap = area.current;
    if (!wrap) {
      change();
      return;
    }
    settle.current();
    const from = wrap.offsetHeight;
    // A glide in progress holds an inline height: release it before measuring the new content.
    wrap.style.transition = 'none';
    wrap.style.height = '';
    flushSync(change);
    const to = wrap.offsetHeight;
    if (from === to || !window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
      wrap.style.transition = '';
      return;
    }
    wrap.style.height = `${from}px`;
    void wrap.offsetHeight; // commit the start height before the transition
    wrap.style.transition = `height ${RESIZE_MS}ms ${RESIZE_EASE}`;
    wrap.style.height = `${to}px`;
    const done = () => {
      wrap.style.height = '';
      wrap.style.transition = '';
      wrap.removeEventListener('transitionend', done);
      window.clearTimeout(timer);
      settle.current = () => {};
    };
    const timer = window.setTimeout(done, RESIZE_MS + 80);
    wrap.addEventListener('transitionend', done);
    settle.current = done;
  };

  const onCopy = async () => {
    const text = area.current?.querySelector('pre')?.textContent ?? '';
    setCopied(await copy(text.replace(/\n$/u, '')));
  };

  // The accessible name starts with the visible word, Copy or Copied (WCAG 2.5.3).
  const copyLabel = `${copied ? DOCS_UI.copied : DOCS_UI.copy} ${current.id}`;
  const block = (
    <figure className="docs-demo" data-demo={current.id} data-group={group ? '' : undefined}>
      <div className="docs-demo-stage" {...(group ? { role: 'group', 'aria-label': DOCS_UI.demoGroup } : {})}>
        {list.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            className={cn('docs-demo-trigger', isCodeLabel(entry.demo) && 'docs-demo-trigger-code')}
            data-demo={entry.id}
            // Disabled until the page's controller exists (server render, before mount).
            disabled={!controller}
            aria-current={group && index === selected ? 'true' : undefined}
            onClick={() => {
              if (controller) entry.demo.run(controller);
              if (index !== selected) {
                resize(() => {
                  setSelected(index);
                  setExpanded(false);
                });
              }
            }}
          >
            {entry.demo.label}
          </button>
        ))}
      </div>
      <figcaption className="docs-code-bar">
        <span className="docs-code-title">{current.id}</span>
        <span className="docs-code-actions">
          <button type="button" className="docs-code-button" onClick={onCopy} aria-label={copyLabel}>
            {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
            {copied ? DOCS_UI.copied : DOCS_UI.copy}
          </button>
        </span>
      </figcaption>
      <div ref={area} className="docs-demo-code" data-folded={folded ? '' : undefined}>
        {/* Keyed by demo: a new snippet fades in. Focusable so keyboard users can scroll long lines. */}
        <pre key={current.id} tabIndex={0} className={cn('docs-code-pre', current.className)}>
          {current.code}
        </pre>
        {current.folds ? (
          <button
            type="button"
            className="docs-demo-fold"
            aria-expanded={expanded}
            onClick={() => resize(() => setExpanded((value) => !value))}
          >
            {expanded ? DOCS_UI.hideCode : DOCS_UI.showCode}
          </button>
        ) : null}
      </div>
    </figure>
  );

  if (!note) return block;
  return (
    <>
      <p className="docs-demo-note">
        {DOCS_UI.demoNoteBefore}
        <code>{DOCS_UI.demoNoteCode}</code>
        {DOCS_UI.demoNoteAfter}
      </p>
      {block}
    </>
  );
}
