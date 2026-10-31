'use client';

import { Check, Copy } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useCopy } from '@/components/site/notifications';
import { PackageManagerCommand } from '@/components/site/package-manager';
import { Tabs } from '@/components/site/tabs';
import { GET_STARTED, type GetStartedTab } from '@/lib/get-started';
import { highlight } from '@/lib/highlight';
import { DOCS_PATH } from '@/lib/site';

export function GetStarted() {
  return (
    <section id="get-started" aria-labelledby="get-started-title" className="relative px-4 sm:px-6">
      <div className="mx-auto max-w-6xl py-24 sm:py-32">
        <h2 id="get-started-title" className="text-balance text-4xl font-semibold tracking-[-0.03em] sm:text-6xl">
          Get started
        </h2>
        <p className="mt-4 max-w-2xl text-pretty text-lg text-muted-foreground sm:text-xl">
          Install the package, mount one Toaster, call show. Guides and the API reference are in the{' '}
          <Link
            href={DOCS_PATH}
            className="rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
          >
            docs
          </Link>
          .
        </p>
        <Tabs
          label="Install with"
          items={GET_STARTED.map((tab) => ({ id: tab.id, label: tab.label, content: <Steps tab={tab} /> }))}
          className="mt-10 flex flex-col gap-8"
        />
      </div>
    </section>
  );
}

function Steps({ tab }: { tab: GetStartedTab }) {
  return (
    <ol className="gs-steps">
      <li className="gs-step">
        <span className="gs-step-number" aria-hidden="true">1</span>
        <div className="min-w-0">
          <h3>Install</h3>
          <p>{tab.commandNote}</p>
          <PackageManagerCommand command={tab.command} className="mt-4" />
        </div>
      </li>
      <li className="gs-step">
        <span className="gs-step-number" aria-hidden="true">2</span>
        <div className="min-w-0">
          <h3>Mount it and call show</h3>
          <p>{tab.codeNote}</p>
          <CodeBlock file={tab.file} code={tab.code} />
        </div>
      </li>
    </ol>
  );
}

function CodeBlock({ file, code }: { file: string; code: string }) {
  const copy = useCopy();
  const [copied, setCopied] = useState(false);
  const tokens = useMemo(() => highlight(code), [code]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <figure className="code-block">
      <figcaption className="code-block-bar">
        <span className="font-mono text-xs text-muted-foreground">{file}</span>
        <button type="button" className="code-copy" onClick={async () => setCopied(await copy(code))} aria-label={`Copy ${file}`}>
          {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
          Copy
        </button>
      </figcaption>
      {/* Focusable so keyboard users can scroll long lines. */}
      <pre tabIndex={0} aria-label={`${file} example`}>
        <code>
          {tokens.map((token, index) =>
            token.kind === 'plain' ? token.text : (
              <span key={index} className={`tok-${token.kind}`}>
                {token.text}
              </span>
            ),
          )}
        </code>
      </pre>
    </figure>
  );
}
