'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { useCopy } from '@/components/site/notifications';
import { DOCS_UI } from '@/lib/docs-ui-strings';
import { cn } from '@/lib/utils';
import { DemoBlock } from './demo-block';

/** Props the fence meta puts on `<pre>` (source.config.ts): ```tsx title="app.tsx" demo="success" */
export interface CodeBlockProps extends ComponentProps<'pre'> {
  readonly title?: string | undefined;
  /** `"false"` for a ```noCopy fence. */
  readonly allowCopy?: string | undefined;
  /** The demo catalog id of a runnable example (DOCS.md §6): rendered as a demo block. */
  readonly 'data-demo'?: string | undefined;
  /** Set on the first runnable example of a page (remark-demo-note.ts). */
  readonly 'data-demo-note'?: string | undefined;
}

/**
 * The documentation's code block (DOCS.md §6, §7): the highlighted `<pre>` from Shiki inside a
 * figure with the file name and Copy → Copied. Copy reads the rendered text, so there is no
 * second copy of the source to keep in sync. A fence with `demo="<id>"` is a runnable example
 * and renders as a demo block of one entry instead; `<Demos>` groups several (mdx-components.tsx).
 */
export function CodeBlock({
  title,
  allowCopy,
  'data-demo': demoId,
  'data-demo-note': demoNote,
  className,
  children,
  ...rest
}: CodeBlockProps) {
  const figure = useRef<HTMLElement>(null);
  const copy = useCopy({ toast: false });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (demoId !== undefined) {
    return <DemoBlock items={[{ id: demoId, code: children, className }]} note={demoNote !== undefined} />;
  }

  const onCopy = async () => {
    const text = figure.current?.querySelector('pre')?.textContent ?? '';
    setCopied(await copy(text.replace(/\n$/u, '')));
  };

  // The accessible name starts with the visible word, Copy or Copied (WCAG 2.5.3).
  const copyLabel = copied ? (title ? `${DOCS_UI.copied} ${title}` : DOCS_UI.copiedCode) : title ? `${DOCS_UI.copy} ${title}` : DOCS_UI.copyCode;
  return (
    <figure ref={figure} className="docs-code">
      <figcaption className="docs-code-bar">
        <span className="docs-code-title">{title}</span>
        <span className="docs-code-actions">
          {allowCopy === 'false' ? null : (
            <button type="button" className="docs-code-button" onClick={onCopy} aria-label={copyLabel}>
              {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
              {copied ? DOCS_UI.copied : DOCS_UI.copy}
            </button>
          )}
        </span>
      </figcaption>
      {/* Focusable so keyboard users can scroll long lines. */}
      <pre {...rest} tabIndex={0} className={cn('docs-code-pre', className)}>
        {children}
      </pre>
    </figure>
  );
}
