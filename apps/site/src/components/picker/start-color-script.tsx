'use client';

import { useSyncExternalStore } from 'react';
import { START_SCRIPT } from '@/lib/picker-start';

const subscribe = () => () => {};

/**
 * START_SCRIPT in the server's HTML only. A full load runs it before the page paints, and React
 * hydrates the same element; after a client navigation (the header's switch) a script React creates
 * would never run, so none is rendered, and PickerColorProvider picks the start color itself.
 */
export function StartColorScript() {
  // The server snapshot (true) is what the server and hydration render; a client render reads false.
  const fromServer = useSyncExternalStore(subscribe, () => false, () => true);
  return fromServer ? <script dangerouslySetInnerHTML={{ __html: START_SCRIPT }} /> : null;
}
