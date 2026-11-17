'use client';

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { PickerColorProvider, usePickerColor } from '@/components/picker/picker-color';
import { usePageNotifications } from '@/components/site/notifications';
import { createColorReport, type ColorChangeKind } from '@/lib/color-report';

/**
 * The color the kit's landing starts with: the hero and the color picker's chapter paint in it, and
 * the server renders it too, so the first screen does not change color as it hydrates. Warm against
 * the sky the hero's paint runs into.
 */
export const KIT_START_COLOR = '#ff6a3d';

const NoteContext = createContext<((kind: ColorChangeKind) => void) | null>(null);

/** The page's Island answers a change of the visitor's once it has settled; loading and scrolling say nothing. */
function Reports({ children }: { children: ReactNode }) {
  const controller = usePageNotifications();
  const { hex, paletteHex } = usePickerColor();
  const latest = useRef({ controller, hex, count: paletteHex.length });
  useEffect(() => {
    latest.current = { controller, hex, count: paletteHex.length };
  });
  const report = useMemo(() => createColorReport({ controller: () => latest.current.controller, read: () => latest.current }), []);
  useEffect(() => () => report.cancel(), [report]);
  return <NoteContext.Provider value={report.note}>{children}</NoteContext.Provider>;
}

/**
 * One color for the whole kit's landing ("change one color and the whole kit answers"): the hero's
 * picker and palette and the chapter's comparisons read and set the same state, both paints show it,
 * and one notification in the Island reports the visitor's changes, updated in place while it is on
 * screen. The address is never written (`page={false}`); `?c=` still sets the start (the audits).
 */
export function KitColor({ children }: { children: ReactNode }) {
  return (
    <PickerColorProvider page={false} start={KIT_START_COLOR}>
      <Reports>{children}</Reports>
    </PickerColorProvider>
  );
}

/** Notes a change the visitor made (the page color or the palette): the Island reports it once it settles. */
export function useColorNote(): (kind: ColorChangeKind) => void {
  const note = useContext(NoteContext);
  if (!note) throw new Error('useColorNote needs KitColor');
  return note;
}
