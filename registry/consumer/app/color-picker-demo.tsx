'use client';

import { useState } from 'react';
import { ColorPicker, ColorPickerPanel } from '@/components/ui/color-picker/color-picker';

export function ColorPickerDemo() {
  const [color, setColor] = useState('#245cdb');
  return <section>
    <h2>Installed color picker</h2>
    <div><ColorPicker color={color} onChange={setColor} labels={{ open: 'Pick accent', panel: 'Accent picker' }} /> <output data-registry-color>{color}</output></div>
    <form aria-label="Inline picker form">
      <ColorPickerPanel defaultColor="oklch(70% 0.19 48)" defaultFormat="oklch" name="accent" alpha labels={{ area: 'Inline saturation and brightness', hue: 'Inline hue', alpha: 'Inline opacity', value: 'Inline color value', format: 'Inline format' }} />
    </form>
  </section>;
}
