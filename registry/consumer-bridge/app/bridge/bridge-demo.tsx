'use client';

import { useEffect, useState } from 'react';
import { createAgent, type Agent } from '@cloudlet/agent';
import { ColorPicker } from '@/components/ui/color-picker/color-picker';
import { useColorPickerAgent } from '@/components/ui/color-picker/color-picker-agent';
import { ColorPalette } from '@/components/ui/color-palette/color-palette';
import { useColorPaletteAgent } from '@/components/ui/color-palette/color-palette-agent';

declare global { interface Window { cloudletAgent?: Agent } }

// The installed adapters connect the installed picker and palette to the bridge from its own archive;
// the page hands the agent to the test through window, as an app would hand it to a model.
export function BridgeDemo() {
  const [agent] = useState(createAgent);
  const [color, setColor] = useState('#245cdb');
  const [colors, setColors] = useState(['#ff6a3d', '#2f8f9d']);
  const picker = useColorPickerAgent(agent, { color, onChange: setColor, labels: { open: 'Bridge accent', panel: 'Bridge accent picker' } }, { name: 'accent', label: 'Accent color' });
  const palette = useColorPaletteAgent(agent, { colors, onChange: setColors, labels: { group: 'Bridge palette' } }, { name: 'palette' });
  useEffect(() => {
    window.cloudletAgent = agent;
    return () => { delete window.cloudletAgent; };
  }, [agent]);
  return <section>
    <div><ColorPicker {...picker} /> <output data-bridge-color>{color}</output></div>
    <ColorPalette {...palette} />
    <output data-bridge-palette>{colors.join(' ')}</output>
  </section>;
}
