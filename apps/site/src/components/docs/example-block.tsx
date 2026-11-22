'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useCopied } from '@/components/site/use-copied';
import { DOCS_UI } from '@/lib/docs-ui-strings';
import { codeText, type CodeToken } from '@/lib/toaster-settings';
import { EXAMPLES } from './examples';
import { CodeLines } from './preview-shell';
import { DEMO_FOLD_LINES, useHeightGlide } from './use-height-glide';

/**
 * A live example of the docs, after shadcn's ComponentPreview: the component of an example file on
 * a stage, to work with in place, and under it the code of that same file with Copy. The server
 * half (`Example`, example.tsx) reads and colours the file at build time. Long code starts folded
 * under Show code, as in a demo block; Copy gives the whole file either way.
 */
export function ExampleBlock({ name, file, code }: { name: string; file: string; code: readonly (readonly CodeToken[])[] }) {
  const Component = EXAMPLES[name];
  // The server half found the file; a file the list does not know would be a block without its component.
  if (!Component) throw new Error(`Unknown example "${name}": add it to components/docs/examples/index.ts`);
  const [copied, copy] = useCopied();
  const [expanded, setExpanded] = useState(false);
  const { ref: area, resize } = useHeightGlide();
  const folds = code.length > DEMO_FOLD_LINES;
  return (
    <figure className="docs-demo docs-demo-open docs-example" data-example={name}>
      <div className="docs-demo-stage">
        <Component />
      </div>
      <figcaption className="docs-code-bar">
        <span className="docs-code-title">{file}</span>
        <span className="docs-code-actions">
          <button
            type="button"
            className="docs-code-button"
            // The accessible name starts with the visible word, Copy or Copied (WCAG 2.5.3).
            aria-label={`${copied ? DOCS_UI.copied : DOCS_UI.copy} ${file}`}
            onClick={() => copy(code.map(codeText).join('\n'))}
          >
            {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
            {copied ? DOCS_UI.copied : DOCS_UI.copy}
          </button>
        </span>
      </figcaption>
      <div ref={area} className="docs-demo-code" data-folded={folds && !expanded ? '' : undefined}>
        {/* Focusable so keyboard users can scroll long lines. */}
        <pre tabIndex={0} className="docs-code-pre">
          <CodeLines code={code} />
        </pre>
        {folds ? (
          <button type="button" className="docs-demo-fold" aria-expanded={expanded} onClick={() => resize(() => setExpanded((value) => !value))}>
            {expanded ? DOCS_UI.hideCode : DOCS_UI.showCode}
          </button>
        ) : null}
      </div>
    </figure>
  );
}
