import { useState } from 'react';
import { ColorPicker } from '@/components/ui/color-picker/color-picker';
import { useColorPickerAgent } from '@/components/ui/color-picker/color-picker-agent';
import type { AgentConnectorShape } from '@/components/ui/color-picker/color-picker-agent';
import { ColorPalette } from '@/components/ui/color-palette/color-palette';
import { useColorPaletteAgent } from '@/components/ui/color-palette/color-palette-agent';

const ACCENT = '#007aff';
const BRAND: readonly string[] = ['#ff6a3d', '#2f8f9d'];

/**
 * A controlled color picker and palette on the page's agent, the way an app would connect them.
 * The app's switch makes `onChange` keep nothing, so a step meets an app that does not take it.
 */
export function LabColors({ agent }: { agent: AgentConnectorShape }) {
  const [color, setColor] = useState(ACCENT);
  const [colors, setColors] = useState<readonly string[]>(BRAND);
  const [refuse, setRefuse] = useState(false);
  const accent = useColorPickerAgent(agent, {
    color,
    onChange: (next: string) => { if (!refuse) setColor(next); },
    labels: { open: 'Accent color', panel: 'Accent color picker' },
  }, { label: 'Accent color' });
  const palette = useColorPaletteAgent(agent, {
    colors,
    onChange: (next: string[]) => { if (!refuse) setColors(next); },
    max: 4,
    labels: { group: 'Brand palette' },
  }, { label: 'Brand palette' });
  return <section id="agent-colors" className="lab-colors" aria-labelledby="agent-colors-title" data-lab-keep-island="">
    <h2 id="agent-colors-title">Colors on the agent</h2>
    <p>A controlled color picker and palette, connected to the same agent as both Toasters. Change them by hand or by a step in the panel below; the readout is what the app holds.</p>
    <div className="lab-colors-row">
      <div className="lab-colors-stage">
        <span className="lab-colors-name">Accent color</span>
        <ColorPicker {...accent} />
      </div>
      <div className="lab-colors-stage">
        <span className="lab-colors-name">Brand palette</span>
        <ColorPalette {...palette} />
      </div>
    </div>
    <dl className="lab-colors-readout">
      <dt>App holds · accent</dt><dd data-testid="colors-accent">{color}</dd>
      <dt>App holds · palette</dt><dd data-testid="colors-palette">{JSON.stringify(colors)}</dd>
    </dl>
    <div className="lab-checks">
      <label><input type="checkbox" checked={refuse} onChange={event => setRefuse(event.target.checked)} />The app takes no changes</label>
    </div>
  </section>;
}
