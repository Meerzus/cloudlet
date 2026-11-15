'use client';

import { useState } from 'react';
import { ColorPalette } from '@/components/ui/color-palette/color-palette';

/** `<PaletteDemo />`: the palette's live example on the color picker docs — the row and the colors it gives back. */
export function PaletteDemo() {
  const [colors, setColors] = useState<string[]>(['#245cdb', '#f2b84b', '#2f8f9d']);
  return (
    <div className="docs-picker-demo docs-palette-demo">
      <ColorPalette colors={colors} onChange={setColors} labels={{ group: 'Example palette' }} />
      <output className="font-mono text-sm" aria-live="off">{colors.join(', ')}</output>
    </div>
  );
}
