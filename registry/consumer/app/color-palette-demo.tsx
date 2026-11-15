'use client';

import { useState } from 'react';
import { ColorPalette } from '@/components/ui/color-palette/color-palette';

export function ColorPaletteDemo() {
  const [colors, setColors] = useState(['#ff6a3d', '#2f8f9d']);
  return <section>
    <h2>Installed color palette</h2>
    <form aria-label="Palette form">
      <ColorPalette colors={colors} onChange={setColors} name="palette" labels={{ group: 'Accent palette', picker: { panel: 'Palette picker' } }} />
    </form>
    <output data-registry-palette>{colors.join(' ')}</output>
  </section>;
}
