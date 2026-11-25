'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePageNotifications, useToasterSettings } from '@/components/site/notifications';
import { Segmented } from '@/components/site/segmented';
import { findDemo, type Demo } from '@/lib/demos';
import { DOCS_UI } from '@/lib/docs-ui-strings';
import { TOASTER_DOCS_PATH } from '@/lib/site';
import {
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
import { PreviewShell } from './preview-shell';

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
 * The Preview of the Toaster's component page on the shared shell (preview-shell.tsx): a stage with
 * two buttons, the controls of the page Toaster's main props, and the `<Toaster />` code they make,
 * with Copy. The controls move the page's own Toaster (`useToasterSettings`), so every Run of the
 * page's Examples lands where they put it; leaving the page puts it back. The theme is the site's.
 */
export function ToasterPreview() {
  const controller = usePageNotifications();
  const [edge, setEdge] = useState<Edge>('auto');
  const [side, setSide] = useState<Side>('center');
  const [dir, setDir] = useState<Direction>('ltr');
  const position = positionOf(edge, side);
  // Auto lives in the centre: picking it moves Side to Center, and Left / Right wait for Top or Bottom.
  const pickEdge = (next: Edge) => {
    setEdge(next);
    if (!sideEnabled(next, side)) setSide('center');
  };
  const sides = SIDES.map((option) => ({ ...option, disabled: !sideEnabled(edge, option.value) }));
  useToasterSettings({ position, dir });
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
    <PreviewShell
      stage={
        <>
          {trigger(ONE, STRINGS.showOne, 'one')}
          {trigger(FIVE, STRINGS.showFive, 'five')}
        </>
      }
      settings={STRINGS.settings}
      controls={
        <>
          <Segmented legend={STRINGS.position} options={EDGES} value={edge} onChange={pickEdge} />
          <Segmented legend={STRINGS.side} options={sides} value={side} onChange={setSide} />
          <Segmented legend={STRINGS.direction} options={DIRECTIONS} value={dir} onChange={setDir} />
          <Link href={`${TOASTER_DOCS_PATH}/styling`} className="docs-preview-link">
            {STRINGS.styling}
          </Link>
        </>
      }
      codeTitle={STRINGS.codeTitle}
      code={[toasterCode({ position, dir })]}
    />
  );
}
