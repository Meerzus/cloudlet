'use client';

import { Check, Copy } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useCopy, usePageNotifications, useToasterSettings } from '@/components/site/notifications';
import { Segmented } from '@/components/site/segmented';
import { findDemo, type Demo } from '@/lib/demos';
import { DOCS_UI } from '@/lib/docs-ui-strings';
import { TOASTER_DOCS_PATH } from '@/lib/site';
import {
  codeText,
  DIRECTIONS,
  EDGES,
  positionOf,
  SIDES,
  sideEnabled,
  toasterCode,
  type Direction,
  type Edge,
  type Side,
} from '@/lib/toaster-settings';

/** The catalog entries behind the two buttons: one notification, and five that stack. */
function demo(id: string): Demo {
  const entry = findDemo(id);
  if (!entry) throw new Error(`Unknown demo "${id}" in the Toaster preview`);
  return entry;
}
const ONE = demo('success');
const FIVE = demo('burst');

const STRINGS = DOCS_UI.preview;

/**
 * The Preview of the Toaster's component page, a relative of the demo block: a stage with two
 * buttons, the controls of the page Toaster's main props, and the `<Toaster />` code they make,
 * with Copy. The controls move the page's own Toaster (`useToasterSettings`), so every Run of the
 * page's Examples lands where they put it; leaving the page puts it back. The theme is the site's.
 */
export function ToasterPreview() {
  const controller = usePageNotifications();
  const copy = useCopy({ toast: false });
  const [edge, setEdge] = useState<Edge>('auto');
  const [side, setSide] = useState<Side>('center');
  const [dir, setDir] = useState<Direction>('ltr');
  const [copied, setCopied] = useState(false);
  const position = positionOf(edge, side);
  // Auto lives in the centre: picking it moves Side to Center, and Left / Right wait for Top or Bottom.
  const pickEdge = (next: Edge) => {
    setEdge(next);
    if (!sideEnabled(next, side)) setSide('center');
  };
  const sides = SIDES.map((option) => ({ ...option, disabled: !sideEnabled(edge, option.value) }));
  useToasterSettings({ position, dir });
  const tokens = toasterCode({ position, dir });
  const text = codeText(tokens);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const trigger = (entry: Demo, label: string, name: string) => (
    <button
      type="button"
      className="docs-demo-trigger"
      data-preview={name}
      // Disabled until the page's controller exists (server render, before mount).
      disabled={!controller}
      onClick={() => {
        if (controller) entry.run(controller);
      }}
    >
      {label}
    </button>
  );

  return (
    <figure className="docs-demo docs-preview">
      <div className="docs-demo-stage">
        {trigger(ONE, STRINGS.showOne, 'one')}
        {trigger(FIVE, STRINGS.showFive, 'five')}
      </div>
      <div role="group" aria-label={STRINGS.settings} className="docs-preview-controls">
        <Segmented legend={STRINGS.position} options={EDGES} value={edge} onChange={pickEdge} />
        <Segmented legend={STRINGS.side} options={sides} value={side} onChange={setSide} />
        <Segmented legend={STRINGS.direction} options={DIRECTIONS} value={dir} onChange={setDir} />
        <Link href={`${TOASTER_DOCS_PATH}/styling`} className="docs-preview-link">
          {STRINGS.styling}
        </Link>
      </div>
      <figcaption className="docs-code-bar">
        <span className="docs-code-title">{STRINGS.codeTitle}</span>
        <span className="docs-code-actions">
          <button
            type="button"
            className="docs-code-button"
            // The accessible name starts with the visible word, Copy or Copied (WCAG 2.5.3).
            aria-label={`${copied ? DOCS_UI.copied : DOCS_UI.copy} ${STRINGS.codeTitle}`}
            onClick={async () => setCopied(await copy(text))}
          >
            {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
            {copied ? DOCS_UI.copied : DOCS_UI.copy}
          </button>
        </span>
      </figcaption>
      <div className="docs-demo-code">
        {/* Keyed by the code: a new line fades in, as a new snippet does in a demo block. Focusable to scroll a long line. */}
        <pre key={text} tabIndex={0} className="docs-code-pre">
          <code>
            <span className="line">
              {tokens.map((token, index) => (
                <span key={index} style={{ color: token.color }}>
                  {token.content}
                </span>
              ))}
            </span>
          </code>
        </pre>
      </div>
    </figure>
  );
}
