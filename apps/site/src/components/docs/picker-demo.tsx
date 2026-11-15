'use client';

import { useState } from 'react';
import { ColorPicker, ColorPickerPanel } from '@/components/ui/color-picker/color-picker';

/** `<PickerDemo />`: the color picker docs' live example — the swatch and the inline panel on one color. */
export function PickerDemo() {
  const [color, setColor] = useState('#245cdb');
  return (
    <div className="docs-picker-demo">
      <div className="docs-picker-demo-swatch">
        <ColorPicker color={color} onChange={setColor} labels={{ open: 'Open the example picker', panel: 'Example picker' }} />
        <output className="font-mono text-sm" aria-live="off">{color}</output>
      </div>
      <ColorPickerPanel color={color} onChange={setColor} alpha />
    </div>
  );
}
