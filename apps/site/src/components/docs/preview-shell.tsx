'use client';

import { Check, Copy } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { useCopied } from '@/components/site/use-copied';
import { DOCS_UI } from '@/lib/docs-ui-strings';
import { codeText, type CodeToken } from '@/lib/toaster-settings';
import { cn } from '@/lib/utils';

/**
 * The Preview of a component page, a relative of the demo block: a stage with the live component,
 * a row of the controls of its main props, and the code they make, with Copy. The shell knows
 * nothing about the component: the stage, the controls (`Segmented` groups, a link) and the code
 * come from the caller, the code as lines of tokens coloured the way Shiki colours it at build time.
 */
export function PreviewShell({
  stage,
  settings,
  controls,
  codeTitle,
  code,
  className,
}: {
  /** What stands on the stage. */
  stage: ReactNode;
  /** The accessible name of the group of controls. */
  settings: string;
  controls: ReactNode;
  /** The title of the code bar; Copy is named after it. */
  codeTitle: string;
  /** The code as lines of tokens. */
  code: readonly (readonly CodeToken[])[];
  className?: string;
}) {
  const [copied, copy] = useCopied();
  const text = code.map(codeText).join('\n');
  return (
    <figure className={cn('docs-demo docs-preview', className)}>
      <div className="docs-demo-stage">{stage}</div>
      <div role="group" aria-label={settings} className="docs-preview-controls">
        {controls}
      </div>
      <figcaption className="docs-code-bar">
        <span className="docs-code-title">{codeTitle}</span>
        <span className="docs-code-actions">
          <button
            type="button"
            className="docs-code-button"
            // The accessible name starts with the visible word, Copy or Copied (WCAG 2.5.3).
            aria-label={`${copied ? DOCS_UI.copied : DOCS_UI.copy} ${codeTitle}`}
            onClick={() => copy(text)}
          >
            {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
            {copied ? DOCS_UI.copied : DOCS_UI.copy}
          </button>
        </span>
      </figcaption>
      <div className="docs-demo-code">
        {/* Keyed by the code: new code fades in, as a new snippet does in a demo block. Focusable to scroll a long line. */}
        <pre key={text} tabIndex={0} className="docs-code-pre">
          <CodeLines code={code} />
        </pre>
      </div>
    </figure>
  );
}

/** Code as Shiki writes it into a `<pre>`: a `.line` per line of coloured tokens. */
export function CodeLines({ code }: { code: readonly (readonly CodeToken[])[] }) {
  return (
    <code>
      {code.map((line, row) => (
        // As in Shiki's markup, the line break sits between the lines, not inside one.
        <Fragment key={row}>
          <span className="line">
            {line.map((token, index) => (
              <span key={index} style={{ color: token.color }}>
                {token.content}
              </span>
            ))}
          </span>
          {row < code.length - 1 ? '\n' : null}
        </Fragment>
      ))}
    </code>
  );
}
